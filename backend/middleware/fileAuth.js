const jwt = require("jsonwebtoken");
const Student = require("../models/Student");
const Admin = require("../models/Admin");

async function protectFileAccess(req, res, next) {
  try {
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers.authorization || "";
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required to access uploaded files.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "JWT_SECRET is not configured.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // If it's an admin, they can access any file
    if (decoded.role === "admin" || decoded.role === "MAIN_ADMIN" || decoded.role === "SUB_ADMIN") {
      const admin = await Admin.findById(decoded.id);
      if (!admin) {
        return res.status(401).json({
          success: false,
          message: "Invalid admin session.",
        });
      }
      return next();
    }

    // If it's a student, they can only access their own files
    if (decoded.role === "student") {
      const student = await Student.findById(decoded.id);
      if (!student) {
        return res.status(401).json({
          success: false,
          message: "Invalid student session.",
        });
      }

      // Identify the file path (ignoring query parameters)
      const relativePath = decodeURIComponent(req.originalUrl.split("?")[0]);
      
      // Find the student owner of this file path
      const owner = await Student.findOne({
        $or: [
          { "resume.url": { $regex: relativePath } },
          { "result.url": { $regex: relativePath } },
          { "photo.url": { $regex: relativePath } },
          { "permissionLetter.url": { $regex: relativePath } },
          { "aadhaarCard.url": { $regex: relativePath } },
          { "completedDocuments.url": { $regex: relativePath } },
          { "offerLetter.url": { $regex: relativePath } },
          { "offerLetterUrl": { $regex: relativePath } }
        ]
      });

      if (!owner || String(owner._id) !== String(student._id)) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You can only access your own files.",
        });
      }

      req.student = student;
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "Access denied. Invalid role.",
    });

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token for file access.",
    });
  }
}

module.exports = { protectFileAccess };
