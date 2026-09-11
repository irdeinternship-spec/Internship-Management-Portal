// Read-only reference data for the PUBLIC registration form.
//
// Deliberately a thin composition over what already exists rather than new
// data access: branches/courses/durations come straight from
// managementItemService.list() - the same function the admin Management
// screen reads through - so the admin panel and the application form can no
// longer disagree about what exists. That divergence is the bug this file was
// written to close: the collections were admin-editable but nothing displayed
// them, because every dropdown read a hardcoded file in web-portal/src/data/.
//
// States are the exception: there is no `states` collection and there
// shouldn't be (a fixed vocabulary nobody should be editing). They're served
// from backend/data/indianStates.js - the SAME constant
// controllers/studentController.js validates a submitted collegeState
// against - so the list the form offers and the list the server accepts are
// one array. web-portal/src/data/states.js was a second copy of it and is
// deleted as part of this change.
//
// Shape mirrors collegeService.readColleges(): { id, name } per item, built
// explicitly. Courses additionally carry `level`.

const managementItemService = require("./managementItemService");
const { indianStatesAndUnionTerritories } = require("../data/indianStates");

// States have no id of their own. Their index is used purely as a stable
// React key on the client - it is never persisted and never sent back, the
// same way a college's numeric id is only ever a URL parameter.
function statesAsReferenceItems() {
  return indianStatesAndUnionTerritories.map((name, index) => ({ id: index + 1, name }));
}

async function readReferenceData() {
  const [branches, courses, durations] = await Promise.all([
    managementItemService.list("branches"),
    managementItemService.list("courses"),
    managementItemService.list("durations"),
  ]);

  return { branches, courses, durations, states: statesAsReferenceItems() };
}

module.exports = { readReferenceData };
