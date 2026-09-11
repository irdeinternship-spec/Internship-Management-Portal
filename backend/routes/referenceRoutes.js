const express = require("express");
const { listReferenceData } = require("../controllers/referenceController");

// Public and unauthenticated, mounted at /api/reference - deliberately its own
// router outside the admin tree, exactly like routes/collegeRoutes.js, rather
// than an auth exception carved into adminRoutes.js. The public registration
// form cannot reach /api/admin/management/:type, which is protectAdmin-gated.
const router = express.Router();

router.get("/", listReferenceData);

module.exports = router;
