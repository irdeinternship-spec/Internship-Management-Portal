const jwt = require("jsonwebtoken");
const Student = require("../models/Student");

async function protectStudent(req, res, next) {
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
        message: "Student authentication required.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "JWT_SECRET is not configured.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "student") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Student access only.",
      });
    }

    const student = await Student.findById(decoded.id);
    if (!student) {
      return res.status(401).json({
        success: false,
        message: "Invalid student session.",
      });
    }

    req.student = student;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired student token.",
    });
  }
}

module.exports = { protectStudent };
