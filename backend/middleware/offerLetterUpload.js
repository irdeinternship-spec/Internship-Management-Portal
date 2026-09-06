const multer = require("multer");
const path = require("path");

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Offer Letter must be a PDF file."));
    }
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext !== ".pdf") {
      return cb(new Error("Offer Letter must have a .pdf extension."));
    }
    cb(null, true);
  },
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
}).single("offerLetter");

function validatePdfSignature(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const hex = buffer.slice(0, 4).toString("hex").toUpperCase();
  return hex === "25504446"; // %PDF
}

function uploadOfferLetter(req, res, next) {
  upload(req, res, async (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Offer Letter PDF is required.",
      });
    }

    // Verify PDF Magic Bytes
    if (!validatePdfSignature(req.file.buffer)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file contents. Must be a valid PDF document.",
      });
    }

    try {
      const Student = require("../models/Student");
      const student = await Student.findById(req.params.studentId);
      if (!student) {
        return res.status(404).json({ success: false, message: "Student not found." });
      }

      const cleanName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9.-]/g, "_");
      const extension = path.extname(cleanName) || ".pdf";
      const crypto = require("crypto");
      const filename = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${extension.toLowerCase()}`;
      const s3Key = `students/${student.referenceId}/offer-letters/${filename}`;

      const { uploadFile } = require("../services/s3StorageService");
      const result = await uploadFile(req.file.buffer, s3Key, req.file.mimetype);

      req.uploadedOfferLetter = {
        url: result.url,
        publicId: s3Key,
        filename: result.filename,
      };

      next();
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.statusCode === 503 ? err.message : "Offer Letter upload failed.",
      });
    }
  });
}

module.exports = { uploadOfferLetter };
