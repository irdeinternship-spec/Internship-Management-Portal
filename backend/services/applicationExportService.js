const ExcelJS = require("exceljs");
const Student = require("../models/Student");

function formatExportDate(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return "-";
  const day = String(dt.getDate()).padStart(2, "0");
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}-${month}-${year}`;
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

  worksheet.columns = [
    { header: "Application ID", key: "referenceId", width: 22 },
    { header: "Student Name", key: "name", width: 26 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "College", key: "college", width: 35 },
    { header: "Branch", key: "branch", width: 24 },
    { header: "Branch Code", key: "branchCode", width: 14 },
    { header: "Division Allotted", key: "division", width: 24 },
    { header: "Seat Number", key: "seatNumber", width: 16 },
    // numFmt + a real Number below: written as a NUMBER, so Excel can sort and
    // average it. A string here would sort lexically ("10" before "9").
    { header: "CGPA", key: "cgpa", width: 10, style: { numFmt: "0.00" } },
    { header: "Status", key: "status", width: 15 },
    { header: "Submitted Date", key: "submittedDate", width: 18 },
    { header: "Approval Date", key: "approvalDate", width: 18 },
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

  for (const student of students) {
    const row = worksheet.addRow({
      referenceId: student.referenceId || String(student._id || "-"),
      name: student.name || "-",
      email: student.email || "-",
      phone: student.phone || "-",
      college: student.collegeName || "-",
      branch: student.branch || "-",
      branchCode: student.branchCode || "-",
      division:
        student.trainingManagement?.division ||
        student.recommendedBy ||
        student.division ||
        "-",
      seatNumber:
        student.serialNumber ||
        student.trainingManagement?.seatNumber ||
        student.seatNumber ||
        "-",
      // Number, not a formatted string. null (not "-") when absent, so the cell
      // is genuinely empty rather than text that would break the column's type.
      cgpa: Number.isFinite(student.cgpa) ? student.cgpa : null,
      status: student.status || "Pending",
      submittedDate: formatExportDate(student.submittedAt || student.createdAt),
      approvalDate: formatExportDate(student.approvedDate),
    });
    row.alignment = { vertical: "middle" };
  }

  return { workbook, count: students.length, label: filter.label };
}

module.exports = {
  generateApplicationsWorkbook,
  resolveStatusFilter,
};
