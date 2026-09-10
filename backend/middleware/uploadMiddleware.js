const multer = require("multer");
const path = require("path");
const { uploadFile } = require("../services/s3StorageService");
const Student = require("../models/Student");
const crypto = require("crypto");

function generateReferenceId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 7 }, () => {
    const index = crypto.randomInt(0, chars.length);
    return chars[index];
  }).join("");
}

async function createUniqueReferenceId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const referenceId = generateReferenceId();
    const exists = await Student.exists({ referenceId });
    if (!exists) return referenceId;
  }
  throw new Error("Unable to generate a unique Application ID.");
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PHOTO_MAX_FILE_SIZE = 1 * 1024 * 1024;

const uploadFolders = {
  resume: "resumes",
  result: "results",
  photo: "photos",
  permissionLetter: "permissionLetters",
  aadhaarCard: "aadhaarCards",
};

const allowedTypes = {
  resume: ["application/pdf"],
  result: ["application/pdf", "image/jpeg", "image/jpg"],
  photo: ["image/png", "image/jpeg", "image/jpg"],
  permissionLetter: [
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
  ],
  aadhaarCard: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
};

const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png"];

// Check magic bytes / signatures for PDFs & common Images
function validateFileSignature(buffer, fieldname) {
  if (!buffer || buffer.length < 4) return false;
  const hex = buffer.slice(0, 8).toString("hex").toUpperCase();
  
  const isPdf = hex.startsWith("25504446"); // %PDF
  const isJpeg = hex.startsWith("FFD8FF");
  const isPng = hex.startsWith("89504E47");

  if (fieldname === "resume" || fieldname === "completedDocuments") {
    return isPdf;
  }
  if (fieldname === "photo") {
    return isJpeg || isPng;
  }
  if (["result", "permissionLetter", "aadhaarCard"].includes(fieldname)) {
    return isPdf || isJpeg || isPng;
  }
  return false;
}

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  const allowed = allowedTypes[file.fieldname];

  if (!allowed) {
    return cb(new Error("Unexpected file field."));
  }

  if (!allowed.includes(file.mimetype)) {
    if (file.fieldname === "aadhaarCard") {
      return cb(new Error("Only PDF, JPG, JPEG and PNG files are allowed."));
    }
    const displayName = file.fieldname === "resume" ? "Curriculum Vitae" : file.fieldname === "result" ? "Marksheet" : file.fieldname;
    return cb(new Error(`${displayName} has an invalid file type.`));
  }

  // Check extension sanity
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error("File extension not allowed."));
  }

  cb(null, true);
}

function validatePerFieldSize(req, file, cb) {
  const maxSize = file.fieldname === "photo" ? PHOTO_MAX_FILE_SIZE : MAX_FILE_SIZE;

  if (file.size > maxSize) {
    let displayName = file.fieldname;
    if (file.fieldname === "resume") displayName = "Curriculum Vitae";
    if (file.fieldname === "result") displayName = "Marksheet";
    if (file.fieldname === "permissionLetter") displayName = "College Referral Letter";

    return cb(
      new Error(
        file.fieldname === "aadhaarCard"
          ? "Maximum allowed file size is 10 MB."
          : file.fieldname === "photo"
          ? "Photo size should not exceed 1 MB."
          : `${displayName} size should not exceed 10 MB.`
      )
    );
  }

  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter(req, file, cb) {
    fileFilter(req, file, (error) => {
      if (error) return cb(error);
      validatePerFieldSize(req, file, cb);
    });
  },
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
}).fields([
  { name: "resume", maxCount: 1 },
  { name: "result", maxCount: 1 },
  { name: "photo", maxCount: 1 },
  { name: "permissionLetter", maxCount: 1 },
  { name: "aadhaarCard", maxCount: 1 },
]);

function uploadStudentDocuments(req, res, next) {
  upload(req, res, async (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    try {
      const uploadedFiles = {};

      if (req.files) {
        // Pre-validate sizes & magic signatures first
        for (const fieldName of Object.keys(req.files)) {
          const file = req.files[fieldName][0];
          
          // Magic bytes validation
          if (!validateFileSignature(file.buffer, fieldName)) {
            return res.status(400).json({
              success: false,
              message: `File contents for ${fieldName} do not match the expected file signature.`,
            });
          }

          if (fieldName === "photo" && file.size > PHOTO_MAX_FILE_SIZE) {
            return res.status(400).json({
              success: false,
              message: "Photo size should not exceed 1 MB.",
            });
          }
        }

        const referenceId = await createUniqueReferenceId();
        req.referenceId = referenceId;

        const uploadPromises = Object.keys(req.files).map(async (fieldName) => {
          const file = req.files[fieldName][0];
          const cleanName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, "_");
          const extension = path.extname(cleanName) || ".pdf";
          const filename = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${extension.toLowerCase()}`;
          
          let folderName = fieldName;
          if (fieldName === "permissionLetter") folderName = "permission-letter";
          if (fieldName === "aadhaarCard") folderName = "aadhaar";
          
          const s3Key = `students/${referenceId}/${folderName}/${filename}`;
          const result = await uploadFile(file.buffer, s3Key, file.mimetype);
          return {
            fieldName,
            data: {
              url: result.url,
              public_id: s3Key,
              originalName: cleanName,
            },
          };
        });

        const results = await Promise.all(uploadPromises);
        for (const uploadRes of results) {
          uploadedFiles[uploadRes.fieldName] = uploadRes.data;
        }
      }

      req.uploadedFiles = uploadedFiles;
      next();
    }
    catch (err) {
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.statusCode === 503 ? err.message : "File upload failed.",
        error: err.message,
      });
    }
  });
}

const completedDocumentsUpload = multer({
  storage,
  fileFilter(req, file, cb) {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Completed documents must be uploaded as a single PDF."));
    }
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext !== ".pdf") {
      return cb(new Error("Completed documents must be a PDF file."));
    }
    cb(null, true);
  },
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
}).single("completedDocuments");

function uploadCompletedDocuments(req, res, next) {
  completedDocumentsUpload(req, res, async (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Upload Form 1 and Form 2 as a single PDF file.",
      });
    }

    // Verify PDF Magic Bytes
    if (!validateFileSignature(req.file.buffer, "completedDocuments")) {
      return res.status(400).json({
        success: false,
        message: "Invalid file content signature. Must be a valid PDF document.",
      });
    }

    try {
      const referenceId = req.student.referenceId;
      const cleanName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9.-]/g, "_");
      const extension = path.extname(cleanName) || ".pdf";
      const filename = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${extension.toLowerCase()}`;
      const s3Key = `students/${referenceId}/completed-documents/${filename}`;
      
      const result = await uploadFile(req.file.buffer, s3Key, req.file.mimetype);

      req.uploadedCompletedDocuments = {
        url: result.url,
        publicId: s3Key,
      };

      next();
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        success: false,
        message: err.statusCode === 503 ? err.message : "File upload failed.",
        error: err.message,
      });
    }
  });
}

module.exports = { uploadCompletedDocuments, uploadStudentDocuments };
