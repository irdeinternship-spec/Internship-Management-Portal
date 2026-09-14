const ExcelJS = require("exceljs");
const Student = require("../models/Student");

// Every column renders a genuinely empty cell when the value is missing -
// null, not "-". ExcelJS writes null as an empty cell; "-" was the old
// convention and made the sheet un-filterable (a "-" is a value, so Excel's
// "Blanks" filter never matched and COUNTA counted placeholders as data).
//
// The typeof guard is what stops "[object Object]" ever reaching a cell: every
// one of the 14 data columns maps to a scalar path on the student document,
// but a future schema change that turns one into a subdocument would otherwise
// stringify silently instead of failing visibly.
function cellText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

// A real Date, never a string: the cell is written as an Excel date serial so
// it sorts and filters chronologically, with DD/MM/YYYY applied as a display
// format on the column (see the DOB column's numFmt below). A formatted string
// would sort lexically - every 01/xx before every 02/xx, regardless of year.
//
// Rebuilt from the stored value's UTC components rather than passed through
// directly. Mongo stores these at UTC midnight and ExcelJS converts a Date to
// its serial via getTime(), so passing the raw value through is correct only
// while that holds; normalising here pins the cell to an integer serial - the
// calendar day the registrar typed - regardless of the stored time component
// or the exporting server's timezone.
function excelDate(value) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  if (isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

// The three status values Student.status actually holds. Read from the live
// collection rather than assumed - the stored strings are capitalised
// ("Approved"/"Rejected"/"Pending"), not lowercase, and the schema declares no
// enum (models/mongo/Student.js only sets default:"Pending"), so these are the
// values the data uses, not a contract it enforces.
const STATUS_FILTERS = {
  approved: { label: "approved", query: { status: "Approved" } },
  rejected: { label: "rejected", query: { status: "Rejected" } },
  all: { label: "all", query: {} },
};

function resolveStatusFilter(scope) {
  return STATUS_FILTERS[String(scope || "all").toLowerCase()] || null;
}

/**
 * Builds and returns the standardized ExcelJS workbook for student applications.
 *
 * `scope` is one of "approved" | "rejected" | "all" (default "all").
 */
async function generateApplicationsWorkbook(scope = "all") {
  const filter = resolveStatusFilter(scope);
  if (!filter) {
    const error = new Error(`Unknown export scope "${scope}". Choose approved, rejected, or all.`);
    error.statusCode = 400;
    throw error;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DRDO Admin Portal";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Applications", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // Exactly these 15 columns, in this order. "Application ID" is a label only -
  // the underlying field is still referenceId and nothing was renamed in code.
  worksheet.columns = [
    { header: "S.No.", key: "serial", width: 8, style: { numFmt: "0" } },
    { header: "Name", key: "name", width: 26 },
    { header: "Application ID", key: "referenceId", width: 22 },
    { header: "Course", key: "course", width: 18 },
    { header: "Branch", key: "branch", width: 24 },
    { header: "Branch Code", key: "branchCode", width: 14 },
    { header: "Year", key: "year", width: 12 },
    { header: "College Name", key: "collegeName", width: 35 },
    { header: "College Location", key: "collegeLocation", width: 22 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Gender", key: "gender", width: 12 },
    // Written as a real Date, not text - see excelDate() above.
    { header: "DOB", key: "dob", width: 14, style: { numFmt: "dd/mm/yyyy" } },
    // numFmt + a real Number below: written as a NUMBER, so Excel can sort and
    // average it. A string here would sort lexically ("10" before "9").
    { header: "CGPA", key: "cgpa", width: 10, style: { numFmt: "0.00" } },
    { header: "Duration", key: "duration", width: 16 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A8A" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 26;

  const students = await Student.find(filter.query).sort({ submittedAt: -1, createdAt: -1 });

  students.forEach((student, index) => {
    const row = worksheet.addRow({
      // Generated at export time: the row's position in this exported set,
      // starting at 1. Deliberately NOT student.serialNumber - that's a
      // separate database field with its own meaning and its own gaps.
      serial: index + 1,
      name: cellText(student.name),
      referenceId: cellText(student.referenceId),
      course: cellText(student.course),
      branch: cellText(student.branch),
      // Empty for every record that predates the field. Renders as a blank
      // cell, not "-", so "no code recorded" reads as absent rather than as a
      // value - see cellText() above.
      branchCode: cellText(student.branchCode),
      year: cellText(student.year),
      collegeName: cellText(student.collegeName),
      // The registration form's "College Location (City)" input is persisted
      // to the top-level `location` field, not to a `collegeLocation` one -
      // see studentController.js's create (location: req.body.collegeLocation)
      // and its read-back at collegeLocation: student.location. The
      // collegeLocation paths that do exist are nested copies under
      // trainingManagement/offerLetter, written from this field.
      collegeLocation: cellText(student.location),
      email: cellText(student.email),
      phone: cellText(student.phone),
      gender: cellText(student.gender),
      dob: excelDate(student.dob),
      // Number, not a formatted string. null (not "-") when absent, so the cell
      // is genuinely empty rather than text that would break the column's type.
      cgpa: Number.isFinite(student.cgpa) ? student.cgpa : null,
      duration: cellText(student.internshipDuration),
    });
    row.alignment = { vertical: "middle" };
  });

  return { workbook, count: students.length, label: filter.label };
}

module.exports = {
  generateApplicationsWorkbook,
  resolveStatusFilter,
};
