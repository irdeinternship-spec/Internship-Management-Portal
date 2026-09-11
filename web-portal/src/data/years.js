// The ONE year list. pages/StudentDetails.jsx used to define its own 4-value
// copy that omitted "Final Year" - three live student records hold exactly
// that value, so their Year select rendered blank and a save could write the
// blank back.
//
// Deliberately local rather than served from /api/reference like
// branches/courses/durations: there is no `years` collection and there
// shouldn't be. This is a fixed vocabulary, not something an admin configures.
//
// NEXT: which of these an applicant may pick is about to be driven by the
// course's level (Course.level, already in the schema and on the public
// reference endpoint) - undergraduate courses offer only "Final Year",
// postgraduate ones 1st and 2nd year. This list then becomes the union that
// rule selects from, so every value below must stay present.
export const years = ["1st Year", "2nd Year", "3rd Year", "4th Year", "Final Year"];
