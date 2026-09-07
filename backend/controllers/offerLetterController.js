const Student = require("../models/Student");
const {
  buildTemplateData,
  defaultLetterNumber,
  generateOfferLetterHtml,
} = require("../services/templateService");
const { generatePdfFromHtml } = require("../services/pdfService");
const { sendOfferLetterEmail } = require("../services/emailService");
const { logActivity } = require("../utils/activityLogger");

function syncLegacyOfferLetterFields(
  student,
  result,
  uploadType,
  sent = false,
) {
  student.offerLetterUrl = result?.url || student.offerLetter?.url || "";
  student.offerLetterPublicId =
    result?.filename || student.offerLetter?.publicId || "";

  if (uploadType === "Uploaded") {
    student.offerLetterUploadedDate = new Date();
  }

  if (sent) {
    student.offerLetterSentDate = new Date();
  }

  student.offerLetterStatus = sent ? "Sent" : uploadType;
}

function currentOfferLetter(student) {
  return student.offerLetter?.toObject?.() || student.offerLetter || {};
}

async function findApprovedStudent(studentId) {
  const student = await Student.findById(studentId);

  if (!student) {
    const error = new Error("Student not found.");
    error.statusCode = 404;
    throw error;
  }

  if (student.status !== "Approved") {
    const error = new Error(
      "Offer Letter can only be generated after approval.",
    );
    error.statusCode = 400;
    throw error;
  }

  return student;
}

function buildEditableFields(student) {
  const data = buildTemplateData(student);

  return {
    studentName: data.studentName,
    collegeName: data.collegeName,
    collegeLocation: data.collegeLocation,
    course: data.course,
    year: data.year,
    branch: data.branch,
    internshipDuration: data.internshipDuration,
    issueDate: student.offerLetter?.issueDate
      ? new Date(student.offerLetter.issueDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    letterNumber: data.letterNumber,
  };
}

function sendError(res, error, fallbackMessage) {
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallbackMessage,
  });
}

function serializeStudent(student) {
  const value = student.toObject ? student.toObject() : student;

  if (value.offerLetter?.pdfBuffer) {
    delete value.offerLetter.pdfBuffer;
  }

  return value;
}

async function generateOfferLetter(req, res) {
  try {
    const student = await findApprovedStudent(req.params.studentId);
    const issueDate = new Date();
    const letterNumber =
      student.offerLetter?.letterNumber || defaultLetterNumber(student);
    const html = await generateOfferLetterHtml(student, {
      issueDate,
      letterNumber,
    });

    student.offerLetter = {
      ...currentOfferLetter(student),
      generatedBy: req.admin.email,
      issueDate,
      uploadType: "Generated",
      letterNumber,
      status: "Generated",
      html,
      sent: false,
    };
    student.offerLetterStatus = "Generated";

    await student.save();

    await logActivity({
      req,
      module: "Offer Letter",
      action: "Generated Offer Letter",
      description: `Generated offer letter for ${student.name}.`,
      status: "Success",
    });

    return res.status(200).json({
      success: true,
      html,
      student: serializeStudent(student),
      editable: buildEditableFields(student),
      message: "Offer Letter generated successfully.",
    });
  } catch (error) {
    await logActivity({
      req,
      module: "Offer Letter",
      action: "Generated Offer Letter",
      description: `Failed to generate offer letter. Error: ${error.message}`,
      status: "Failed",
    });

    return sendError(res, error, "Unable to generate Offer Letter.");
  }
}

async function getOfferLetterPreview(req, res) {
  try {
    const student = await findApprovedStudent(req.params.studentId);

    let html = "";

    if (student.offerLetter?.uploadType === "Uploaded") {
      html = "";
    } else {
      html = await generateOfferLetterHtml(student);
    }

    return res.status(200).json({
      success: true,
      student: serializeStudent(student),
      html,
      pdfUrl: student.offerLetter?.url || student.offerLetterUrl || "",
      uploadType: student.offerLetter?.uploadType || "",
      editable: buildEditableFields(student),
    });
  } catch (error) {
    return sendError(res, error, "Unable to load Offer Letter preview.");
  }
}

async function updateOfferLetter(req, res) {
  try {
    const student = await findApprovedStudent(req.params.studentId);
    const allowed = [
      "studentName",
      "collegeName",
      "collegeLocation",
      "course",
      "year",
      "branch",
      "internshipDuration",
      "issueDate",
      "letterNumber",
    ];

    const updates = allowed.reduce((acc, key) => {
      if (req.body[key] !== undefined) acc[key] = req.body[key];
      return acc;
    }, {});

    if (!updates.studentName || !updates.collegeName || !updates.course) {
      return res.status(400).json({
        success: false,
        message: "Student name, college name, and course are required.",
      });
    }

    const issueDate = updates.issueDate
      ? new Date(updates.issueDate)
      : new Date();

    if (Number.isNaN(issueDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Select a valid issue date.",
      });
    }

    const html = await generateOfferLetterHtml(student, {
      ...updates,
      issueDate,
    });
    await generatePdfFromHtml(html);
    // ===== Sync main Student fields =====

    student.name = updates.studentName || student.name;
    student.course = updates.course || student.course;
    student.year = updates.year || student.year;
    student.branch = updates.branch || student.branch;

    student.collegeName = updates.collegeName || student.collegeName;

    student.location = updates.collegeLocation || student.location;

    student.internshipDuration =
      updates.internshipDuration || student.internshipDuration;

    // Keep the legacy training-management mirror aligned, while the root
    // Student fields remain the canonical values used by every document.
    if (student.trainingManagement) {
      student.trainingManagement.studentName = student.name;
      student.trainingManagement.courseName = student.course;
      student.trainingManagement.courseYear = student.year;
      student.trainingManagement.branch = student.branch;
      student.trainingManagement.collegeName = student.collegeName;
      student.trainingManagement.collegeLocation = student.location;
      student.trainingManagement.trainingDuration = student.internshipDuration;
    }

    student.offerLetter = {
      ...currentOfferLetter(student),

      generatedBy: req.admin.email,
      issueDate,

      uploadType: "Generated",
      status: "Generated",
      edited: true,
      sent: false,

      html,

      letterNumber: updates.letterNumber || defaultLetterNumber(student),

      studentName: updates.studentName,
      collegeName: updates.collegeName,
      collegeLocation: updates.collegeLocation,
      collegeAddress: updates.collegeAddress,

      course: updates.course,
      year: updates.year,
      branch: updates.branch,

      internshipDuration: updates.internshipDuration,

    };
    student.offerLetterStatus = "Generated";

    await student.save();

    return res.status(200).json({
      success: true,
      html,
      student: serializeStudent(student),
      editable: buildEditableFields(student),
      message: "Offer Letter changes saved.",
    });
  } catch (error) {
    return sendError(res, error, "Unable to update Offer Letter.");
  }
}

async function generateOfferLetterPdf(req, res) {
  try {
    const student = await findApprovedStudent(req.params.studentId);
    const html =
      student.offerLetter?.html || (await generateOfferLetterHtml(student));
    const pdfBuffer = await generatePdfFromHtml(html);

    student.offerLetter = {
      ...currentOfferLetter(student),
      generatedBy: student.offerLetter?.generatedBy || req.admin.email,
      issueDate: student.offerLetter?.issueDate || new Date(),
      uploadType: "Generated",
      letterNumber:
        student.offerLetter?.letterNumber || defaultLetterNumber(student),
      status: "Generated",
      html,
    };
    student.offerLetterStatus = "Generated";

    await student.save();

    await logActivity({
      req,
      module: "Offer Letter",
      action: "Printed Offer Letter",
      description: `Printed offer letter for ${student.name}.`,
      status: "Success",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="DRDO-Internship-Offer-Letter.pdf"',
    );
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    await logActivity({
      req,
      module: "Offer Letter",
      action: "Printed Offer Letter",
      description: `Failed to print offer letter. Error: ${error.message}`,
      status: "Failed",
    });

    return sendError(res, error, "PDF generation failed.");
  }
}

async function uploadOfferLetterPdf(req, res) {
  try {
    const student = await findApprovedStudent(req.params.studentId);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Offer Letter PDF is required.",
      });
    }

    const path = require("path");
    const crypto = require("crypto");
    const cleanName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9.-]/g, "_");
    const extension = path.extname(cleanName) || ".pdf";
    const filename = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${extension.toLowerCase()}`;
    const s3Key = `students/${student.referenceId}/offer-letters/${filename}`;

    const { uploadFile } = require("../services/s3StorageService");
    const result = await uploadFile(req.file.buffer, s3Key, req.file.mimetype);

    student.offerLetter = {
      ...currentOfferLetter(student),
      generatedBy: req.admin.email,
      url: result.url,
      publicId: result.filename,
      issueDate: new Date(),
      uploadType: "Uploaded",
      status: "Uploaded",
      sent: false,
    };
    syncLegacyOfferLetterFields(student, result, "Uploaded");

    await student.save();

    return res.status(200).json({
      success: true,
      student: serializeStudent(student),
      pdfUrl: result.url,
      message: "Offer Letter uploaded successfully.",
    });
  } catch (error) {
    return sendError(res, error, "Offer Letter upload failed.");
  }
}

async function sendOfferLetter(req, res) {
  try {
    const student = await findApprovedStudent(req.params.studentId);
    let pdfBuffer = null;
    let uploadResult = null;
    let emailResult = null;

    if (
      student.offerLetter?.uploadType === "Uploaded" &&
      student.offerLetter?.url
    ) {
      emailResult = await sendOfferLetterEmail(student, {
        url: student.offerLetter.url,
      });
    } else {
      const html =
        student.offerLetter?.html || (await generateOfferLetterHtml(student));
      pdfBuffer = await generatePdfFromHtml(html);

      const { uploadFile } = require("../services/s3StorageService");
      const filename = `DRDO-Internship-Offer-Letter-${Date.now()}.pdf`;
      const s3Key = `students/${student.referenceId}/offer-letters/${filename}`;
      uploadResult = await uploadFile(pdfBuffer, s3Key, "application/pdf");

      student.offerLetter = {
        ...currentOfferLetter(student),
        url: uploadResult.url,
        publicId: s3Key,
        uploadType: "Generated",
        status: "Generated",
        html,
      };

      emailResult = await sendOfferLetterEmail(student, { buffer: pdfBuffer });
      syncLegacyOfferLetterFields(student, uploadResult, "Generated", true);
    }

    if (emailResult?.skipped) {
      const error = new Error(
        emailResult.reason || "Email configuration missing.",
      );
      error.statusCode = 500;
      throw error;
    }

    student.offerLetter = {
      ...currentOfferLetter(student),
      sent: true,
      sentAt: new Date(),
      status: "Sent",
    };
    student.offerLetterStatus = "Sent";
    student.offerLetterSentDate = new Date();
    student.offerLetterSentBy = req.admin.email;

    await student.save();

    await logActivity({
      req,
      module: "Offer Letter",
      action: "Sent Offer Letter",
      description: `Sent offer letter to ${student.name}.`,
      status: "Success",
    });

    return res.status(200).json({
      success: true,
      student: serializeStudent(student),
      message: "Offer Letter sent successfully.",
    });
  } catch (error) {
    await logActivity({
      req,
      module: "Offer Letter",
      action: "Sent Offer Letter",
      description: `Failed to send offer letter. Error: ${error.message}`,
      status: "Failed",
    });

    try {
      // Must be wrapped in $set: the mongoStore shim's applyUpdate() only
      // walks dotted paths (like "offerLetter.status") when they're under
      // $set - without it, "offerLetter.status" was being merged as a
      // literal top-level key containing a dot, which Object.assign onto the
      // document as an ad-hoc property that Mongoose's .save() never looks
      // at. Silently did nothing, regardless of what the schema declares.
      await Student.findByIdAndUpdate(req.params.studentId, {
        $set: {
          offerLetterStatus: "Email Failed",
          "offerLetter.status": "Email Failed",
        },
      });
    } catch {
      // Preserve the original error response.
    }

    return sendError(res, error, "Unable to send Offer Letter.");
  }
}

module.exports = {
  generateOfferLetter,
  generateOfferLetterPdf,
  getOfferLetterPreview,
  sendOfferLetter,
  updateOfferLetter,
  uploadOfferLetterPdf,
};
