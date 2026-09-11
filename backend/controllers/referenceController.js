const referenceService = require("../services/referenceService");

// Thin by design, matching controllers/collegeController.js's listColleges:
// every decision lives in the service. Errors propagate to server.js's global
// handler rather than degrading to an empty list - an empty dropdown reads to
// an applicant as "there are no branches", which is worse than a clear error
// (same reasoning managementItemService's header gives for dropping its old
// fall-back-to-hardcoded-defaults behaviour).
async function listReferenceData(req, res, next) {
  try {
    res.json(await referenceService.readReferenceData());
  } catch (error) {
    next(error);
  }
}

module.exports = { listReferenceData };
