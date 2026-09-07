const express = require("express");
const { getPresignedUrl } = require("../controllers/fileController");

const router = express.Router();

// No router-level protectAdmin/protectStudent - authorizeFileKey (called by
// the controller) dispatches on role internally, since either role can
// request a presigned URL depending on which file it is.
router.get("/presign", getPresignedUrl);

module.exports = router;
