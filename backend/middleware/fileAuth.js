const jwt = require("jsonwebtoken");
const Student = require("../models/Student");
const Admin = require("../models/Admin");
const Gyapan = require("../models/Gyapan");

// authorizeFileKey applies the same two rules the retired protectFileAccess
// middleware used (admin: any file; student: owns it), with one addition:
// an admin's key must resolve to a real Student or Gyapan record too, not
// just "you're an admin, here's whatever key you asked for." Today's
// uploads/download files (student documents,
// including Aadhaar scans, and Gyapan/ISM PDFs) are the only records that
// matter here, but this bucket is also about to hold a backups/ prefix - an
// unconditional admin presign would let any admin (including a
// newly-created sub-admin) presign the backup dump containing every
// Aadhaar number and bank detail in the system. "Any authenticated admin,
// any key" was only ever safe while the key was implicit in a URL the
// server itself constructed; the moment it's a client-supplied query
// parameter, it's an enumeration surface over the whole bucket unless every
// key is checked against something real.
//
// Equality match, not regex: uploadFile() (services/s3StorageService.js)
// always writes the exact, deterministic string `/uploads/${s3Key}` into
// these fields, and they're plain Mongoose String paths with no transforms
// - there's no substring/prefix matching need anywhere in this system, so
// an exact-equality $or is strictly safer (no regex-metacharacter injection
// surface) and indexable (see the index:true additions on these same
// fields in models/mongo/Student.js and Gyapan.js).
const STUDENT_FILE_FIELDS = [
  "resume",
  "result",
  "photo",
  "permissionLetter",
  "aadhaarCard",
  "completedDocuments",
];

function studentOwnerQuery(key) {
  return {
    $or: [
      { "resume.url": key },
      { "result.url": key },
      { "photo.url": key },
      { "permissionLetter.url": key },
      { "aadhaarCard.url": key },
      { "completedDocuments.url": key },
      { "offerLetter.url": key },
      { offerLetterUrl: key },
    ],
  };
}

// Which of the owner's own fields this key actually is - derived from the
// already-loaded document in JS (no extra query), used only for the
// Aadhaar-access audit log in controllers/fileController.js.
function matchOwnerField(owner, key) {
  for (const field of STUDENT_FILE_FIELDS) {
    if (owner[field]?.url === key) return field;
  }
  if (owner.offerLetter?.url === key || owner.offerLetterUrl === key) return "offerLetter";
  return null;
}

async function authenticateFileRequest(req) {
  let token = req.cookies?.token;
  if (!token) {
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }
  }

  if (!token) {
    const error = new Error("Authentication required to access uploaded files.");
    error.statusCode = 401;
    throw error;
  }

  if (!process.env.JWT_SECRET) {
    const error = new Error("JWT_SECRET is not configured.");
    error.statusCode = 500;
    throw error;
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    const error = new Error("Invalid or expired token for file access.");
    error.statusCode = 401;
    throw error;
  }

  if (decoded.role === "admin" || decoded.role === "MAIN_ADMIN" || decoded.role === "SUB_ADMIN") {
    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      const error = new Error("Invalid admin session.");
      error.statusCode = 401;
      throw error;
    }
    return { role: "admin", admin };
  }

  if (decoded.role === "student") {
    const student = await Student.findById(decoded.id);
    if (!student) {
      const error = new Error("Invalid student session.");
      error.statusCode = 401;
      throw error;
    }
    return { role: "student", student };
  }

  const error = new Error("Access denied. Invalid role.");
  error.statusCode = 403;
  throw error;
}

// Authorizes a presigned-URL request for `key` (the stored .url value, e.g.
// "/uploads/students/ABC123/photo/xyz.jpg" or "/uploads/gyapan/xyz.pdf").
// Sets req.admin/req.student for the audit log in fileController.js and
// returns { role, field }. Throws (with .statusCode) on any failure -
// fileController.js is responsible for turning that into a response.
async function authorizeFileKey(req, key) {
  const auth = await authenticateFileRequest(req);

  if (auth.role === "admin") {
    req.admin = auth.admin;

    const owner = await Student.findOne(studentOwnerQuery(key));
    if (owner) {
      return { role: "admin", field: matchOwnerField(owner, key) };
    }

    const gyapan = await Gyapan.findOne({ $or: [{ pdfUrl: key }, { gyapanUrl: key }] });
    if (gyapan) {
      return { role: "admin", field: null };
    }

    const error = new Error("This file does not exist.");
    error.statusCode = 404;
    throw error;
  }

  // auth.role === "student"
  req.student = auth.student;
  const owner = await Student.findOne(studentOwnerQuery(key));
  if (!owner || String(owner._id) !== String(auth.student._id)) {
    const error = new Error("Access denied. You can only access your own files.");
    error.statusCode = 403;
    throw error;
  }

  return { role: "student", field: matchOwnerField(owner, key) };
}

module.exports = { authorizeFileKey };
