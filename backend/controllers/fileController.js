const path = require("path");
const { authorizeFileKey } = require("../middleware/fileAuth");
const { getPresignedDownloadUrl } = require("../services/s3StorageService");
const { logActivity } = require("../utils/activityLogger");

// GET /api/files/presign?key=<stored .url value>&download=0|1
// Returns a 15-minute presigned R2 URL, or a JSON error - never bytes
// itself. See middleware/fileAuth.js's authorizeFileKey for the
// authorization rules (admin: any file that resolves to a real record;
// student: owns it).
async function getPresignedUrl(req, res) {
  const rawKey = req.query.key;
  if (!rawKey || typeof rawKey !== "string") {
    return res.status(400).json({ success: false, message: "A file key is required." });
  }
  const key = decodeURIComponent(rawKey);

  try {
    const { role, field } = await authorizeFileKey(req, key);

    // Audit trail for third-party access to a student's Aadhaar scan
    // specifically - a student viewing their own document isn't logged (not
    // third-party PII access), and this is deliberately scoped to just
    // aadhaarCard rather than every document type, so routine photo/resume
    // views don't flood the log.
    if (role === "admin" && field === "aadhaarCard") {
      await logActivity({
        req,
        module: "Student Module",
        action: "Accessed Aadhaar Document",
        description: `Requested a presigned download URL for Aadhaar scan: ${key}`,
        status: "Success",
      });
    }

    const download = req.query.download === "1";
    const { url, expiresAt } = await getPresignedDownloadUrl(key, {
      filename: path.basename(key),
      disposition: download ? "attachment" : "inline",
    });

    return res.status(200).json({ success: true, url, expiresAt });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Unable to generate a download link.",
    });
  }
}

module.exports = { getPresignedUrl };
