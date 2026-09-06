const Gyapan = require("../models/Gyapan");
const Student = require("../models/Student");
const { generatePdfFromHtml } = require("../services/pdfService");
const { logActivity } = require("../utils/activityLogger");
const {
  generateGyapanHtml,
  studentToRow,
} = require("../services/gyapanService");

const { indiaDayRange } = require("../utils/dateRange");

async function getGyapanStudents(req, res) {
  try {
    const filter = {
      $and: [
        { status: "Approved" },
      ],
    };

    if (req.query.date) {
      const range = indiaDayRange(req.query.date);

      if (!range) {
        return res.status(400).json({
          success: false,
          message: "Select a valid joining date.",
        });
      }

      filter.$and.push({
        approvedDate: range,
      });
    }
    if (req.query.search?.trim()) {
      filter.$and.push({ name: { $regex: req.query.search.trim(), $options: "i" } });
    }

    const students = await Student.find(filter)
      .sort({ name: 1 })
      .lean();

    return res.json({
      success: true,
      students,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch approved students.",
    });
  }
}

async function removeGyapanBufferStudents(req, res) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ success: false, message: "Select at least one student to remove." });
  await Promise.all(ids.map((id) => Student.findByIdAndUpdate(id, { gyapanBufferRemoved: true })));
  return res.json({ success: true, message: "Selected students removed from the Joining ISM buffer." });
}

async function selectedRows(ids) {
  const uniqueIds = [...new Set(Array.isArray(ids) ? ids : [])];
  if (!uniqueIds.length) {
    const error = new Error("Select at least one student.");
    error.statusCode = 400;
    throw error;
  }
  const students = await Student.find({
    _id: { $in: uniqueIds },
    status: "Approved",
  }).lean();
  if (students.length !== uniqueIds.length) {
    const error = new Error(
      "Only approved students can be added.",
    );
    error.statusCode = 400;
    throw error;
  }
  return students.map(studentToRow);
}

async function createPreview(req, res) {
  try {
    const deleteAfterDownload = req.bufferMode !== true;
    const rows = await selectedRows(req.body.ids);
    const issueDate = req.body.issueDate
      ? new Date(req.body.issueDate)
      : new Date();
    if (Number.isNaN(issueDate.getTime()))
      return res
        .status(400)
        .json({ success: false, message: "Select a valid issue date." });
    const letterNumber = String(
      req.body.letterNumber ||
        `DRDO/GYAPAN/${new Date().getFullYear()}/${Date.now()}`,
    ).trim();
    const html = await generateGyapanHtml({ rows, letterNumber, issueDate, division: rows[0]?.division || "" });
    const gyapan = await Gyapan.create({
      letterNumber,
      issueDate,
      selectedStudents: rows.map((row) => row.studentId),
      studentRows: rows,
      html,
      generatedBy: req.admin.email,
      bufferMode: !deleteAfterDownload,
    });

    await logActivity({
      req,
      module: "Joining ISM",
      action: "Generated ISM",
      description: `Generated Joining ISM preview for ${rows.length} trainee(s) in division '${rows[0]?.division || "N/A"}'.`,
      status: "Success",
    });

    return res
      .status(201)
      .json({
        success: true,
        gyapan,
        html,
        editable: {
          letterNumber,
          issueDate: issueDate.toISOString().slice(0, 10),
          studentRows: rows,
        },
      });
  } catch (error) {
    await logActivity({
      req,
      module: "Joining ISM",
      action: "Generated ISM",
      description: `Failed to generate Joining ISM preview. Error: ${error.message}`,
      status: "Failed",
    });

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Unable to create Gyapan preview.",
      });
  }
}

async function getPreview(req, res) {
  try {
    const gyapan = await Gyapan.findById(req.params.id).lean();
    if (!gyapan)
      return res
        .status(404)
        .json({ success: false, message: "Gyapan not found." });
    return res.json({
      success: true,
      gyapan,
      html: gyapan.html,
      editable: {
        letterNumber: gyapan.letterNumber,
        issueDate: gyapan.issueDate
          ? new Date(gyapan.issueDate).toISOString().slice(0, 10)
          : "",
        studentRows: gyapan.studentRows,
      },
    });
  } catch {
    return res
      .status(500)
      .json({ success: false, message: "Unable to load Gyapan preview." });
  }
}

async function editPreview(req, res) {
  try {
    const gyapan = await Gyapan.findById(req.params.id);
    if (!gyapan)
      return res
        .status(404)
        .json({ success: false, message: "Gyapan not found." });
    const rows = Array.isArray(req.body.studentRows)
      ? req.body.studentRows
      : [];
    if (
      !rows.length ||
      !rows.every((row) => row.studentName && row.course && row.collegeName)
    )
      return res
        .status(400)
        .json({
          success: false,
          message: "Every row needs student name, course, and college name.",
        });
    const issueDate = new Date(req.body.issueDate);
    if (Number.isNaN(issueDate.getTime()))
      return res
        .status(400)
        .json({ success: false, message: "Select a valid issue date." });
    gyapan.letterNumber = String(req.body.letterNumber || "").trim();
    if (!gyapan.letterNumber)
      return res
        .status(400)
        .json({ success: false, message: "Letter number is required." });
    gyapan.issueDate = issueDate;
    gyapan.studentRows = rows;
    gyapan.selectedStudents = rows.map((row) => row.studentId).filter(Boolean);
    gyapan.html = await generateGyapanHtml({
      rows,
      letterNumber: gyapan.letterNumber,
      issueDate,
      division: rows[0]?.division || ""
    });
    await gyapan.save();
    return res.json({
      success: true,
      gyapan,
      html: gyapan.html,
      message: "Gyapan preview updated.",
    });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: error.message || "Unable to save Gyapan changes.",
      });
  }
}

async function generateFinalPdf(req, res) {
  try {
    const gyapan = await Gyapan.findById(req.params.id);
    if (!gyapan)
      return res
        .status(404)
        .json({ success: false, message: "Gyapan not found." });
    if (gyapan.generated)
      return res.json({
        success: true,
        gyapan,
        pdfUrl: gyapan.pdfUrl,
        message: "Gyapan PDF has already been generated.",
      });
    const pdf = await generatePdfFromHtml(gyapan.html);
    const { uploadFile } = require("../services/s3StorageService");
    const filename = `Gyapan-${gyapan._id}-${Date.now()}.pdf`;
    const s3Key = `gyapan/${filename}`;
    const upload = await uploadFile(pdf, s3Key, "application/pdf");
    gyapan.generated = true;
    gyapan.generatedDate = new Date();
    gyapan.generatedBy = req.admin.email;
    gyapan.pdfUrl = upload.url;
    gyapan.gyapanUrl = upload.url;
    gyapan.publicId = s3Key;
    await gyapan.save();
    if (!gyapan.bufferMode) {
      for (const studentId of gyapan.selectedStudents) {
        await Student.findByIdAndUpdate(studentId, { $set: { gyapanGenerated: true } });
      }
    }

    await logActivity({
      req,
      module: "Joining ISM",
      action: "Printed ISM",
      description: `Printed final Joining ISM PDF for letter number '${gyapan.letterNumber}'.`,
      status: "Success",
    });

    return res.json({
      success: true,
      gyapan,
      pdfUrl: gyapan.pdfUrl,
      message: "Gyapan PDF generated and uploaded successfully.",
    });
  } catch (error) {
    await logActivity({
      req,
      module: "Joining ISM",
      action: "Printed ISM",
      description: `Failed to print Joining ISM PDF. Error: ${error.message}`,
      status: "Failed",
    });

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Gyapan PDF generation failed.",
      });
  }
}

module.exports = {
  createPreview,
  editPreview,
  generateFinalPdf,
  getGyapanStudents,
  removeGyapanBufferStudents,
  getPreview,
};
