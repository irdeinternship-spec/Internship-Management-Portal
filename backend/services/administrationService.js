// Re-points this file at the real Administration model (models/mongo/
// Administration.js) instead of raw pool.query calls - this was one of the
// "bucket C" files found during the step-4 survey that bypassed
// postgresStore.js entirely and would have hit db.js's tripwire the moment
// the Administration screen, a division-capacity check, or certificate
// generation was used.
//
// getAdministration/saveAdministration/reserveNextCertificateNumber are
// already implemented as statics on the Administration model - the
// normalization/defaulting logic that used to live here (sorting divisions,
// defaulting seat limits, pruning stale divisionConfigurations keys, etc.)
// was ported there verbatim during schema design, and
// reserveNextCertificateNumber was already simplified to an atomic $inc
// (no transaction) in step 3. This file is now a thin re-export so its
// three live callers (administrationController.js, divisionCapacityService.js,
// adminStudentController.js) need no change.
//
// Wrapped in arrow functions rather than destructured directly, so `this`
// inside each static still resolves to the Administration model when
// called (destructuring `{ getAdministration } = Administration` would lose
// that binding).
//
// (The `require("path")` this file used to have at the top was already
// unused in the original code - dropped as an incidental cleanup, unrelated
// to the migration itself.)

const Administration = require("../models/mongo/Administration");

module.exports = {
  getAdministration: (...args) => Administration.getAdministration(...args),
  saveAdministration: (...args) => Administration.saveAdministration(...args),
  reserveNextCertificateNumber: (...args) => Administration.reserveNextCertificateNumber(...args),
};
