require("dotenv").config();

// Storage (Cloudflare R2) is deliberately NOT in this list, even in
// production: it's an optional subsystem and must never stop the app from
// booting. See the isStorageConfigured() check below - upload/download
// routes respond 503 instead.
const requiredEnv = ["JWT_SECRET", "MONGODB_URI", "MAIN_ADMIN_EMAIL", "ENCRYPTION_KEY"];
if (process.env.NODE_ENV === "production") {
  requiredEnv.push("CORS_ORIGINS");
}
if (process.env.EMAIL_ENABLED === "true") {
  requiredEnv.push("EMAIL_USER", "MAIL_FROM", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN");
}
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`❌ Startup Error: Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

// Must run before any model file is required (transitively, that's every
// route/controller require below) - it registers a global mongoose.plugin()
// that only takes effect on schemas compiled after registration.
require("./config/mongoosePlugins");

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");

const adminRoutes = require("./routes/adminRoutes");
const offerLetterRoutes = require("./routes/offerLetterRoutes");
const studentRoutes = require("./routes/studentRoutes");
const collegeRoutes = require("./routes/collegeRoutes");
const { protectFileAccess } = require("./middleware/fileAuth");
const { getFileStream, verifyR2Connection, isStorageConfigured, getMissingStorageEnv } = require("./services/s3StorageService");
const { connectDB, disconnectDB } = require("./config/mongo");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5000;

if (!isStorageConfigured()) {
  console.warn(
    `⚠️  File storage is not configured (missing: ${getMissingStorageEnv().join(", ")}). ` +
    "Upload/download routes will respond 503 until R2 credentials are set."
  );
}

// Index creation is handled by Mongoose itself: each schema's index:true/
// unique:true declarations (models/mongo/*.js) are queued the moment those
// files are require()'d and built automatically once connected (Mongoose's
// default autoIndex behavior) - no manual CREATE INDEX step needed here,
// unlike the Postgres setup this replaces.
connectDB()
  .then(() => {
    console.log("✅ MongoDB connection successful");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  });
// ========================
// Security Middleware & CORS
// ========================
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many attempts. Please try again after 15 minutes." }
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: "Too many requests. Please try again after 15 minutes." }
});

app.use("/api/", generalLimiter);
app.use("/api/admin/auth", authLimiter);
app.use("/api/students/login", authLimiter);
app.use("/api/students", (req, res, next) => {
  if (req.method === "POST" && req.path === "/") {
    return authLimiter(req, res, next);
  }
  next();
});

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Any Vercel preview deployment (project-hash-team.vercel.app) is allowed in
// addition to the explicit CORS_ORIGINS allowlist, since preview URLs are
// generated per-branch/PR and can't be enumerated ahead of time.
const vercelPreviewOrigin = /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/;

app.use(
  cors({
    // Origin is echoed back per-request (never "*") because credentials:
    // true requires a specific origin - the two can't be combined.
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || vercelPreviewOrigin.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // Authorization must be explicitly allowed: it's what makes our own
    // requests preflighted, and without it here the OPTIONS preflight is
    // rejected and the real GET/POST never fires.
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ========================
// Body Parser
// ========================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Admin responses can contain sensitive registration data. Prevent browsers
// and intermediary caches from restoring an authenticated view after logout.
app.use(["/api/admin", "/api/offer-letter"], (req, res, next) => {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  next();
});

// ========================
// R2-backed upload proxy
// ========================
app.use("/uploads", protectFileAccess, async (req, res, next) => {
  const relativePath = req.path.replace(/^\/+/, "");
  try {
    const stream = await getFileStream(relativePath);
    const ext = path.extname(relativePath).toLowerCase();
    const mimeTypes = {
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg"
    };
    if (mimeTypes[ext]) {
      res.setHeader("Content-Type", mimeTypes[ext]);
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox;");
    stream.pipe(res);
  } catch (error) {
    if (error.statusCode === 503) {
      return res.status(503).json({
        success: false,
        message: error.message,
      });
    }
    next();
  }
});

// ========================
// Health Check
// ========================
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Student Registration Backend is running",
  });
});

// ========================
// Routes
// ========================
app.use("/api/students", studentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/offer-letter", offerLetterRoutes);
app.use("/api/colleges", collegeRoutes);

// ========================
// Frontend Static & SPA Fallback
// ========================
// Off by default - the frontend deploys separately to Vercel. Only needed
// for a same-origin deployment shape or local end-to-end testing of a built
// frontend served by this same process.
if (process.env.SERVE_FRONTEND === "true") {
  const frontendDistPath = path.resolve(__dirname, process.env.FRONTEND_DIST_PATH || "../web-portal/dist");
  app.use(express.static(frontendDistPath));

  app.use((req, res, next) => {
    // Every /api/* route is already registered above and would have
    // responded by now if matched - this guard just keeps an unmatched
    // /api/* request falling through to the JSON 404 handler below instead
    // of getting index.html back.
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      return res.sendFile(path.join(frontendDistPath, "index.html"));
    }
    next();
  });
}

// ========================
// 404 Handler
// ========================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// ========================
// Global Error Handler
// ========================
app.use((err, req, res, next) => {
  // StrictModeError (an undeclared Mongoose schema field was assigned) is
  // always logged, even in production - this is the exact class of error
  // meant to be diagnosable from the Render log alone, and most controllers
  // catch it locally and never reach this handler at all, so this branch is
  // mostly a backstop (config/mongoosePlugins.js already logs at the throw
  // site, which is where the vast majority of these are actually caught).
  if (err.name === "StrictModeError") {
    console.error(`❌ StrictModeError (reached global handler): ${err.message}`);
  } else if (process.env.NODE_ENV !== "production") {
    console.error(err);
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});


// ========================
// Start Server
// ========================
const server = app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (isStorageConfigured()) {
    try {
      await verifyR2Connection();
    } catch (error) {
      // Non-fatal warning at startup; it will fail on demand if bucket is needed
      console.error("❌ R2 startup check failed:", error.message);
    }
  }
  try {
    const { checkChromiumPath } = require("./services/pdfService");
    await checkChromiumPath();
  } catch (error) {
    console.error("❌ Chromium check failed:", error.message);
  }
  console.log(`📧 Email service: ${process.env.EMAIL_ENABLED === "true" ? "ENABLED (live delivery)" : "DISABLED (mock mode - logs to ActivityLog)"}`);
});

// ========================
// Graceful Shutdown
// ========================
// Render sends SIGTERM on every deploy (and on scale-down). Without this,
// in-flight requests get dropped mid-response instead of finishing, and the
// Mongo connection is torn down uncleanly.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received: closing server...`);
  server.close(async (closeError) => {
    if (closeError) {
      console.error("Error while closing HTTP server:", closeError);
    }
    try {
      await disconnectDB();
      console.log("MongoDB connection closed.");
    } catch (dbError) {
      console.error("Error while closing MongoDB connection:", dbError);
    }
    process.exit(closeError ? 1 : 0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Last-resort net, not a substitute for fixing missing try/catch in route
// handlers: an unhandled rejection inside an async Express handler (Express 4
// doesn't auto-catch those) otherwise crashes the entire process by default
// in modern Node - taking down every in-flight request, not just the one
// that errored. Found this the hard way: a StrictModeError inside an
// unguarded handler (adminStudentController.js's removeCertificateBufferStudents,
// now fixed) killed the whole server mid-smoke-run. This just logs loudly
// and keeps the process alive; the one bad request will hang/time out
// instead of getting a clean response, which is still far better than every
// other request going down with it.
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled promise rejection (a route handler is missing a try/catch):", reason);
});
