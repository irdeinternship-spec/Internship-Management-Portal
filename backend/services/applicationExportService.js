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

/**
 * Builds and returns the standardized ExcelJS workbook for student applications.
 */
async function generateApplicationsWorkbook() {
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
    { header: "Division Allotted", key: "division", width: 24 },
    { header: "Seat Number", key: "seatNumber", width: 16 },
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

  const students = await Student.find({}).sort({ submittedAt: -1, createdAt: -1 });

  for (const student of students) {
    const row = worksheet.addRow({
      referenceId: student.referenceId || String(student._id || "-"),
      name: student.name || "-",
      email: student.email || "-",
      phone: student.phone || "-",
      college: student.collegeName || "-",
      branch: student.branch || "-",
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
      status: student.status || "Pending",
      submittedDate: formatExportDate(student.submittedAt || student.createdAt),
      approvalDate: formatExportDate(student.approvedDate),
    });
    row.alignment = { vertical: "middle" };
  }

  return { workbook, count: students.length };
}

module.exports = {
  generateApplicationsWorkbook,
};
