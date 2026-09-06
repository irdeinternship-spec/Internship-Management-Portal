require("dotenv").config();

const requiredEnv = ["JWT_SECRET", "MONGODB_URI", "MAIN_ADMIN_EMAIL", "ENCRYPTION_KEY"];
if (process.env.NODE_ENV === "production") {
  requiredEnv.push("CORS_ORIGINS", "MINIO_ENDPOINT", "MINIO_PORT", "MINIO_REGION", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET");
}
if (process.env.EMAIL_ENABLED === "true") {
  requiredEnv.push("EMAIL_USER", "MAIL_FROM", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN");
}
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`❌ Startup Error: Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

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
const { getFileStream, verifyMinioConnection } = require("./services/s3StorageService");
const { connectDB } = require("./config/mongo");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5000;

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

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
// MinIO-backed upload proxy
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
const frontendDistPath = path.resolve(__dirname, process.env.FRONTEND_DIST_PATH || "../web-portal/dist");
app.use(express.static(frontendDistPath));

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api")) {
    return res.sendFile(path.join(frontendDistPath, "index.html"));
  }
  next();
});

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
  if (process.env.NODE_ENV !== "production") {
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
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  try {
    await verifyMinioConnection();
  } catch (error) {
    // Non-fatal warning at startup; it will fail on demand if bucket is needed
    console.error("❌ MinIO startup check failed:", error.message);
  }
  try {
    const { checkChromiumPath } = require("./services/pdfService");
    await checkChromiumPath();
  } catch (error) {
    console.error("❌ Chromium check failed:", error.message);
  }
  console.log(`📧 Email service: ${process.env.EMAIL_ENABLED === "true" ? "ENABLED (live delivery)" : "DISABLED (mock mode - logs to ActivityLog)"}`);
  try {
    const { initScheduledExport } = require("./services/applicationExportService");
    initScheduledExport();
  } catch (error) {
    console.error("❌ Scheduled export init failed:", error.message);
  }
});
