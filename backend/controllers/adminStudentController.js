const Student = require("../models/Student");
const { generatePdfsFromHtml } = require("../services/pdfService");
const { logActivity } = require("../utils/activityLogger");
const {
  certificateFileName,
  generateCertificateHtml,
} = require("../services/certificateService");
const { removeLocalFile } = require("../services/localStorageService");
const {
  sendOfferLetterEmail,
  sendRejectionEmail,
} = require("../services/emailService");
const { indiaDayRange } = require("../utils/dateRange");
const {
  validateDivisionCapacity,
  validateBranchHasAvailableDivision,
  withDivisionAllocationLock,
} = require("../services/divisionCapacityService");
const { indianStatesAndUnionTerritories } = require("../data/indianStates");

const reviewFields = ["status", "remark", "referenceBy", "recommendedBy"];

const allowedStatuses = ["Pending", "Approved", "Rejected"];

const recommendedByOptions = [
  "Servo System",
  "ABS",
  "SS & ST",
  "NS (Naval System)",
  "OD (Optical Design)",
  "CS & S",
  "ALTDS",
  "LI",
  "LS",
  "LPF",
  "Photonics",
  "EAD",
  "LIDAR",
  "FTIR",
  "HR",
  "MS",
  "ISO",
  "AI",
  "VI",
  "IRST",
  "OME",
  "LIC",
  "ENV",
  "Reprography",
  "MT",
  "P & C",
  "AV",
  "CMD",
  "DIR",
  "HRD",
  "WORKS",
  "MI",
  "SECURITY",
];

function buildStudentFilter(query) {
  const filter = {};
  const conditions = [];

  if (query.isQuarterlyReport === "true") {
    filter.status = "Approved";
    filter.internshipType = "Paid";
    if (query.fromDate && query.toDate) {
      filter["trainingManagement.fromDate"] = {
        $gte: query.fromDate,
        $lte: query.toDate,
      };
    }
    return filter;
  }

  if (query.internshipType) {
    if (query.internshipType === "Unpaid") {
      conditions.push({
        $or: [
          { internshipType: "Unpaid" },
          { internshipType: { $exists: false } }
        ]
      });
    } else {
      filter.internshipType = query.internshipType;
    }
  }

  if (query.search) {
    const expression = { $regex: query.search, $options: "i" };
    conditions.push({
      $or: [
        { name: expression },
        { referenceId: expression },
        { email: expression },
        { phone: expression },
        { collegeName: expression },
      ],
    });
  }

  if (query.collegeName) filter.collegeName = query.collegeName;
  if (query.branch) filter.branch = query.branch;
  if (query.year) filter.year = query.year;

  if (query.resignation === "Yes") {
    filter.resignationStatus = "Yes";
  } else if (query.resignation === "No") {
    conditions.push({
      $or: [{ resignationStatus: "No" }, { resignationStatus: { $exists: false } }],
    });
  }

  const isApprovedView = query.isApprovedView === "true";

  if (isApprovedView) {
    filter.status = "Approved";
    if (query.status === "Completed") {
      filter.completedStatus = "Yes";
    } else if (query.status === "Not Completed") {
      filter.completedStatus = { $ne: "Yes" };
    }
  } else {
    if (query.status === "Pending") {
      conditions.push({
        $or: [{ status: "Pending" }, { status: { $exists: false } }],
      });
    } else if (query.status === "Approved") {
      filter.status = "Approved";
    } else if (query.status === "Completed") {
      filter.completedStatus = "Yes";
    } else if (query.status === "Not Completed") {
      filter.completedStatus = { $ne: "Yes" };
    } else if (query.status) {
      filter.status = query.status;
    }
  }

  if (conditions.length) filter.$and = conditions;

  if (query.registrationDate) {
    const start = new Date(query.registrationDate);
    const end = new Date(query.registrationDate);
    end.setDate(end.getDate() + 1);

    filter.submittedAt = {
      $gte: start,
      $lt: end,
    };
  }

  return filter;
}

function buildSort(sortBy, sortOrder) {
  const map = {
    collegeName: "collegeName",
    branch: "branch",
    year: "year",
    cgpa: "cgpa",
    submittedAt: "submittedAt",
  };

  if (!map[sortBy]) return { submittedAt: -1 };

  return {
    [map[sortBy]]: sortOrder === "asc" ? 1 : -1,
  };
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function addDurationToDate(fromDate, duration) {
  if (!fromDate) return "";

  const date = new Date(fromDate);
  if (Number.isNaN(date.getTime())) return "";

  const monthMatch = String(duration || "").match(/(\d+)\s*month/i);
  const weekMatch = String(duration || "").match(/(\d+)\s*week/i);

  if (monthMatch) { date.setMonth(date.getMonth() + Number(monthMatch[1])); date.setDate(date.getDate() - 1); }
  else if (weekMatch) date.setDate(date.getDate() + Number(weekMatch[1]) * 7 - 1);
  else return "";

  return date.toISOString().slice(0, 10);
}

function normalizePaidDuration(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*(?:months?)?$/i);
  const months = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(months) && months > 0 ? `${months} Months` : "";
}

async function removeStudentAssets(student) {
  await Promise.allSettled([
    removeLocalFile(student.resume),
    removeLocalFile(student.result),
    removeLocalFile(student.photo),
    removeLocalFile(student.permissionLetter),
    removeLocalFile(student.aadhaarCard),
    removeLocalFile(student.completedDocuments),
    removeLocalFile(student.offerLetter),
    removeLocalFile(student.offerLetterUrl),
  ]);
}

async function getStudents(req, res) {
  try {
    const filter = buildStudentFilter(req.query);
    const sort = buildSort(req.query.sortBy, req.query.sortOrder);
    const projection =
      "_id referenceId name gender dob course collegeName location email phone branch year cgpa submittedAt status recommendedBy trainingManagement offerLetterStatus approvedDate certificateGenerated gyapanGenerated internshipType completedStatus bankDetails paidInternshipProjectDetails firstQuarterReport secondQuarterReport";

    const [
      students,
      totalStudents,
      pendingApplications,
      approvedStudents,
      rejectedStudents,
      offerLettersSent,
    ] = await Promise.all([
      Student.find(filter).select(projection).sort(sort).lean(),
      Student.countDocuments({}),
      Student.countDocuments({
        $or: [{ status: "Pending" }, { status: { $exists: false } }],
      }),
      Student.countDocuments({ status: "Approved" }),
      Student.countDocuments({ status: "Rejected" }),
      Student.countDocuments({ offerLetterStatus: "Sent" }),
    ]);

    const summary = {
      totalStudents,
      pendingApplications,
      approvedStudents,
      rejectedStudents,
      offerLettersSent,
    };

    return res.status(200).json({
      success: true,
      students,
      summary,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to fetch students.",
      error: error.message,
    });
  }
}

async function getCertificateStudents(req, res) {
  try {
    const filter = {
      $and: [
        { status: "Approved" },
      ],
    };
    if (req.query.search?.trim()) {
      filter.$and.push({
        name: { $regex: req.query.search.trim(), $options: "i" },
      });
    }
    if (req.query.date) {
      const range = indiaDayRange(req.query.date);
      if (!range) {
        return res
          .status(400)
          .json({ success: false, message: "Select a valid date." });
      }
      filter.$and.push({
        approvedDate: range,
      });
    }
    const students = await Student.find(
      filter,
      "name referenceId collegeName course branch year location internshipDuration trainingManagement",
    )
      .sort({ "trainingManagement.toDate": -1, name: 1 })
      .lean();

    return res.status(200).json({ success: true, students });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to fetch approved students.",
    });
  }
}

async function removeCertificateBufferStudents(req, res) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ success: false, message: "Select at least one student to remove." });
  try {
    await Promise.all(ids.map((id) => Student.findByIdAndUpdate(id, { certificateBufferRemoved: true })));
    return res.json({ success: true, message: "Selected students removed from the certificate buffer." });
  } catch (error) {
    // This route had no try/catch at all until a real StrictModeError here
    // (see mongoStore.js's findByIdAndUpdate) came back as an unhandled
    // promise rejection and crashed the whole process instead of just
    // failing this one request - Express 4 doesn't auto-catch a rejected
    // async handler.
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Unable to update the certificate buffer." });
  }
}

async function downloadCertificates(req, res) {
  try {
    const deleteAfterDownload = req.bufferMode !== true;
    const renderMode = req.body.renderMode === "template" ? "template" : "full";
    const ids = [
      ...new Set(
        Array.isArray(req.body.ids)
          ? req.body.ids
          : [req.body.id].filter(Boolean),
      ),
    ];
    if (!ids.length) {
      return res
        .status(400)
        .json({ success: false, message: "Select a student." });
    }
    if (deleteAfterDownload && ids.length > 1) {
      return res.status(400).json({
        success: false,
        message:
          "Certificates are downloaded individually. Generate one certificate at a time.",
      });
    }

    const students = await Student.find({
      _id: { $in: ids },
      status: "Approved",
    }).lean();
    if (students.length !== ids.length) {
      return res.status(400).json({
        success: false,
        message:
          "Certificates are available only for approved students.",
      });
    }

    const signatureName = req.body.signatureName || "VAIBHAV GUPTA";
    const signatureDesignation = req.body.signatureDesignation || "TECHNICAL OFFICER 'C'";

    const student = students[0];
    const { reserveNextCertificateNumber } = require("../services/administrationService");
    let certNo = student.certificateNumber;
    if (deleteAfterDownload) {
      certNo = await reserveNextCertificateNumber(student._id);
      student.certificateNumber = certNo;
    }

    const [pdf] = await generatePdfsFromHtml([
      generateCertificateHtml(student, renderMode, signatureName, signatureDesignation, certNo),
    ]);
    if (deleteAfterDownload) {
      await Student.findByIdAndUpdate(student._id, {
        certificateGenerated: true,
      });
    }

    await logActivity({
      req,
      module: "Certificate",
      action: "Printed Certificate",
      description: `Printed certificate for ${student.name}.`,
      status: "Success",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${certificateFileName(student)}"`,
    );
    return res.status(200).send(pdf);
  } catch (error) {
    console.error("Certificate generation failed:", error.message);
    await logActivity({
      req,
      module: "Certificate",
      action: "Printed Certificate",
      description: `Failed to print certificate. Error: ${error.message}`,
      status: "Failed",
    });

    if (!res.headersSent) {
      const body = { success: false, message: "Certificate generation failed." };
      if (process.env.NODE_ENV !== "production") body.error = error.message;
      return res.status(500).json(body);
    }
    res.destroy(error);
  }
}

async function getStudentById(req, res) {
  try {
    const student = await Student.findById(req.params.id);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    return res.status(200).json({
      success: true,
      student,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to fetch student details.",
      error: error.message,
    });
  }
}

async function updateStudentReview(req, res) {
  try {
    const student = await Student.findById(req.params.id);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    if (student.internshipType === "Paid" && req.body.internshipDuration !== undefined) {
      const rawDuration = req.body.internshipDuration || student.internshipDuration || "6 Months";
      const duration = normalizePaidDuration(rawDuration);
      if (!duration) {
        return res.status(400).json({ success: false, message: "Enter a whole number of months for a paid internship." });
      }
      req.body.internshipDuration = duration;
    }

    if (req.body.status !== undefined && !allowedStatuses.includes(req.body.status)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid status.",
      });
    }

    const wasRejected = student.status === "Rejected";
    const oldStatus = student.status;

    reviewFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        student[field] = req.body[field];
      }
    });

    if (req.body.name !== undefined) student.name = req.body.name;
    if (req.body.gender !== undefined) student.gender = req.body.gender;
    if (req.body.course !== undefined) student.course = req.body.course;
    if (req.body.branch !== undefined) student.branch = req.body.branch;
    if (req.body.dob !== undefined) student.dob = req.body.dob;
    
    if (req.body.internshipDuration !== undefined) student.internshipDuration = req.body.internshipDuration;
    if (req.body.permissionLetterNumber !== undefined) student.permissionLetterNumber = req.body.permissionLetterNumber;
    if (req.body.permissionLetterDate !== undefined) student.permissionLetterDate = req.body.permissionLetterDate;
    if (req.body.internshipJoiningMonth !== undefined) student.internshipJoiningMonth = req.body.internshipJoiningMonth;

    if (req.body.resignationStatus !== undefined) student.resignationStatus = req.body.resignationStatus;
    if (req.body.resignationDate !== undefined) student.resignationDate = req.body.resignationDate;
    if (req.body.paidInternshipProjectDetails !== undefined) {
      student.paidInternshipProjectDetails = {
        ...student.paidInternshipProjectDetails,
        ...req.body.paidInternshipProjectDetails
      };
    }
    if (req.body.bankDetails !== undefined) {
      student.bankDetails = {
        ...student.bankDetails,
        ...req.body.bankDetails
      };
    }
    if (req.body.firstQuarterReport !== undefined) {
      student.firstQuarterReport = {
        ...student.firstQuarterReport,
        ...req.body.firstQuarterReport
      };
    }
    if (req.body.secondQuarterReport !== undefined) {
      student.secondQuarterReport = {
        ...student.secondQuarterReport,
        ...req.body.secondQuarterReport
      };
    }
    if (req.body.trainingManagement !== undefined) {
      student.trainingManagement = {
        ...student.trainingManagement,
        ...req.body.trainingManagement
      };
    }

    student.reviewedBy = req.admin.email;
    student.reviewedAt = new Date();

    if (student.status === "Approved" && !student.approvedDate) {
      student.approvedDate = new Date();
    }

    if (student.trainingManagement) {
      student.trainingManagement.studentName = student.name;
      student.trainingManagement.courseName = student.course;
      student.trainingManagement.courseYear = student.year;
      student.trainingManagement.branch = student.branch;
      student.trainingManagement.collegeName = student.collegeName;
      student.trainingManagement.collegeLocation = student.location;
      student.trainingManagement.trainingDuration = student.internshipDuration;
      student.trainingManagement.collegeAddress = student.collegeAddress;
    }

    if (student.offerLetter) {
      student.offerLetter.studentName = student.name;
      student.offerLetter.course = student.course;
      student.offerLetter.year = student.year;
      student.offerLetter.branch = student.branch;
      student.offerLetter.collegeName = student.collegeName;
      student.offerLetter.collegeLocation = student.location;
      student.offerLetter.internshipDuration = student.internshipDuration;
      student.offerLetter.collegeAddress = student.collegeAddress;
    }

    await student.save();

    let emailResult = null;

    if (student.status === "Rejected" && !wasRejected) {
      emailResult = await sendRejectionEmail(student);
    }

    let logAction = "Edited Student Details";
    let logDescription = `Edited student details for ${student.name}.`;
    if (oldStatus !== student.status) {
      if (student.status === "Approved") {
        logAction = "Approved Student";
        logDescription = `Approved student ${student.name}.`;
      } else if (student.status === "Rejected") {
        logAction = "Rejected Student";
        logDescription = `Rejected student ${student.name}.`;
      }
    }

    await logActivity({
      req,
      module: "Student Module",
      action: logAction,
      description: logDescription,
      status: "Success",
    });

    return res.status(200).json({
      success: true,
      student,
      email: emailResult,
      message: "Review updated successfully.",
    });
  } catch (error) {
    await logActivity({
      req,
      module: "Student Module",
      action: req.body?.status === "Approved" ? "Approved Student" : (req.body?.status === "Rejected" ? "Rejected Student" : "Edited Student Details"),
      description: `Failed to update student review/details. Error: ${error.message}`,
      status: "Failed",
    });

    return res.status(500).json({
      success: false,
      message: "Unable to update review.",
      error: error.message,
    });
  }
}

async function deleteStudents(req, res) {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

    if (!ids.length) {
      return res.status(400).json({
        success: false,
        message: "Select at least one registration to delete.",
      });
    }

    const students = await Student.find({ _id: { $in: ids } });
    await Promise.all(students.map(removeStudentAssets));
    await Student.deleteMany({
      _id: { $in: students.map((student) => student._id) },
    });

    await logActivity({
      req,
      module: "Student Module",
      action: "Deleted Student",
      description: `Deleted ${students.length} student registrations: ${students.map((student) => student.name).join(", ")}.`,
      status: "Success",
    });

    return res.status(200).json({
      success: true,
      deletedCount: students.length,
      message: "Selected registrations deleted successfully.",
    });
  } catch (error) {
    await logActivity({
      req,
      module: "Student Module",
      action: "Deleted Student",
      description: `Failed to delete student registrations. Error: ${error.message}`,
      status: "Failed",
    });

    return res.status(500).json({
      success: false,
      message: "Unable to delete selected registrations.",
      error: error.message,
    });
  }
}

async function saveTrainingManagement(req, res) {
  return withDivisionAllocationLock(async () => {
   try {
    const student = await Student.findById(req.params.id);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const oldDiv = student.trainingManagement?.division;
    const oldJoined = student.joinedStatus;
    const oldCompleted = student.completedStatus;
    const oldFromDate = student.trainingManagement?.fromDate;
    const oldToDate = student.trainingManagement?.toDate;

    const division = String(req.body.division || "").trim();
    if (division) {
      const capacityError = await validateDivisionCapacity({
        Student,
        studentId: student._id,
        division,
        branch: req.body.branch || student.branch,
        internshipType: student.internshipType,
      });
      if (capacityError) return res.status(400).json({ success: false, message: capacityError });
    }

    if (req.body.completed === "Yes") {
      const required = [
        "joined",
        "fromDate",
        "toDate",
        "trainingDuration",
        "projectTitle",
        "projectGuide",
        "designation",
        "leaveAvailed"
      ];
      const missing = required.some(key => !String(req.body[key] || "").trim());
      if (missing) {
        return res.status(400).json({
          success: false,
          message: "Please complete all Student Joining Details before marking Completion Status as Yes.",
        });
      }
    }

    const isPaidInternship = student.internshipType === "Paid";
    const paidTrainingDuration = isPaidInternship && req.body.trainingDuration !== undefined && req.body.trainingDuration !== ""
      ? normalizePaidDuration(req.body.trainingDuration)
      : "";
    if (isPaidInternship && req.body.trainingDuration !== undefined && req.body.trainingDuration !== "" && !paidTrainingDuration) {
      return res.status(400).json({ success: false, message: "Enter a whole number of months for a paid internship." });
    }
    const resignationStatus = isPaidInternship && req.body.resignationStatus === "Yes" ? "Yes" : "No";
    const resignationDateValue = String(req.body.resignationDate || "").trim();
    if (isPaidInternship && resignationStatus === "Yes") {
      const parsedDate = new Date(`${resignationDateValue}T12:00:00`);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(resignationDateValue) &&
        !Number.isNaN(parsedDate.getTime()) &&
        parsedDate.toISOString().slice(0, 10) === resignationDateValue;
      if (!validDate) {
        return res.status(400).json({ success: false, message: "Resignation date is required when resignation is Yes." });
      }
    }

    // Merge onto the existing subdocument rather than replacing it outright -
    // student.trainingManagement = training below used to be a full replace,
    // which silently wiped any field this function doesn't explicitly
    // recompute (collegeAddress was the one that got lost; the next field
    // anyone adds to trainingManagement without also adding it here would go
    // the same way). Spreading the current value first means a field only
    // ever gets lost if something deliberately overwrites it, not by omission.
    const currentTraining = student.trainingManagement?.toObject?.() || student.trainingManagement || {};

    const training = {
      ...currentTraining,
      studentName: req.body.studentName || student.name,
      courseName: req.body.courseName || student.course,
      courseYear: req.body.courseYear || student.year,
      branch: req.body.branch || student.branch,
      collegeName: req.body.collegeName || student.collegeName,
      collegeLocation: req.body.collegeLocation || student.location,
      trainingDuration: paidTrainingDuration || req.body.trainingDuration || student.internshipDuration || (student.internshipType === "Paid" ? "6 Months" : ""),
      fromDate: req.body.fromDate || "",
      toDate:
        req.body.toDate ||
        addDurationToDate(
          req.body.fromDate,
          paidTrainingDuration || req.body.trainingDuration || student.internshipDuration || (student.internshipType === "Paid" ? "6 Months" : ""),
        ),
      joined: req.body.joined || "",
      division,
      joinedDate:
        req.body.joined === "Yes"
          ? (student.trainingManagement?.joined === "Yes" &&
            student.trainingManagement?.joinedDate) ||
          new Date()
          : null,
      projectTitle: req.body.projectTitle || "",
      projectGuide: req.body.projectGuide || "",
      designation: req.body.designation || "",
      leaveAvailed: req.body.leaveAvailed || "",
      completed: req.body.completed || "",
      completionDate:
        req.body.completed === "Yes"
          ? (student.trainingManagement?.completed === "Yes" &&
            student.trainingManagement?.completionDate) ||
          new Date(`${new Date().toLocaleDateString("en-CA")}T12:00:00`)
          : null,
      updatedBy: req.admin.email,
      updatedAt: new Date(),
    };

    // ===== Sync main Student document =====

    student.name = training.studentName;
    student.course = training.courseName;
    student.year = training.courseYear;
    student.branch = training.branch;

    student.collegeName = training.collegeName;
    student.location = training.collegeLocation;

    student.internshipDuration = training.trainingDuration;

    student.trainingManagement = training;
    // Keep Offer Letter data in sync

    if (student.offerLetter) {
      student.offerLetter.studentName = training.studentName;
      student.offerLetter.course = training.courseName;
      student.offerLetter.year = training.courseYear;
      student.offerLetter.branch = training.branch;

      student.offerLetter.collegeName = training.collegeName;
      student.offerLetter.collegeLocation = training.collegeLocation;

      student.offerLetter.internshipDuration = training.trainingDuration;
    }
    student.joinedStatus = training.joined;
    student.joinedDate = training.joinedDate || undefined;
    student.completedStatus = training.completed;
    student.completedDate = training.completionDate || undefined;
    if (isPaidInternship) {
      student.resignationStatus = resignationStatus;
      student.resignationDate = resignationStatus === "Yes" ? new Date(`${resignationDateValue}T12:00:00`) : null;
    }

    await student.save();

    let logAction = "Updated Training Details";
    let logDescription = `Updated training details for ${student.name}.`;

    if (oldDiv !== division) {
      logAction = "Changed Division";
      logDescription = `Changed division for ${student.name} from '${oldDiv || "None"}' to '${division || "None"}'.`;
    } else if (oldJoined !== req.body.joined) {
      logAction = "Updated Joined Status";
      logDescription = `Updated joined status for ${student.name} to '${req.body.joined}'.`;
    } else if (oldCompleted !== req.body.completed) {
      logAction = "Updated Completion Status";
      logDescription = `Updated completion status for ${student.name} to '${req.body.completed}'.`;
    } else if (oldFromDate !== req.body.fromDate || oldToDate !== training.toDate) {
      logAction = "Updated Dates";
      logDescription = `Updated training dates for ${student.name}.`;
    }

    await logActivity({
      req,
      module: "Training Management",
      action: logAction,
      description: logDescription,
      status: "Success",
    });

    return res.status(200).json({
      success: true,
      student,
      message: "Training details saved successfully.",
    });
   } catch (error) {
    await logActivity({
      req,
      module: "Training Management",
      action: "Updated Training Details",
      description: `Failed to update training details. Error: ${error.message}`,
      status: "Failed",
    });

    return res.status(500).json({
      success: false,
      message: "Unable to save Training Management details.",
      error: error.message,
    });
   }
  });
}

async function uploadOfferLetter(req, res) {
  try {
    const student = await Student.findById(req.params.id);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    if (student.status !== "Approved") {
      return res.status(400).json({
        success: false,
        message: "Offer Letter can only be sent after approval.",
      });
    }

    // Save Offer Letter details
    student.offerLetterUrl = req.uploadedOfferLetter.url;
    student.offerLetterPublicId = req.uploadedOfferLetter.publicId;
    student.offerLetterUploadedDate = new Date();
    student.offerLetterSentBy = req.admin.email;

    let emailResult = null;

    try {
      // Try sending email
      emailResult = await sendOfferLetterEmail(student);

      if (emailResult?.skipped) {
        student.offerLetterStatus = "Not Sent";
        student.offerLetterSentDate = undefined;
      } else {
        student.offerLetterStatus = "Sent";
        student.offerLetterSentDate = new Date();
      }
    } catch (emailError) {
      console.error("Email Error:", emailError);

      // Don't fail the entire request if email sending fails
      student.offerLetterStatus = "Email Failed";
      student.offerLetterSentDate = undefined;
    }

    await student.save();

    await logActivity({
      req,
      module: "Offer Letter",
      action: "Sent Offer Letter",
      description: `Uploaded and sent offer letter to ${student.name}.`,
      status: "Success",
    });

    return res.status(200).json({
      success: true,
      student,
      email: emailResult,
      message:
        student.offerLetterStatus === "Sent"
          ? "Offer Letter uploaded and emailed successfully."
          : "Offer Letter uploaded successfully, but email could not be sent.",
    });
  } catch (error) {
    console.error(error);

    await logActivity({
      req,
      module: "Offer Letter",
      action: "Sent Offer Letter",
      description: `Failed to upload and send offer letter. Error: ${error.message}`,
      status: "Failed",
    });

    return res.status(500).json({
      success: false,
      message: "Unable to upload Offer Letter.",
      error: error.message,
    });
  }
}

async function updateStudentDetails(req, res) {
  return withDivisionAllocationLock(async () => {
   try {
    const student = await Student.findById(req.params.id);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const body = req.body;

    if (student.internshipType === "Paid" && body.internshipDuration !== undefined) {
      const rawDuration = body.internshipDuration || student.internshipDuration || "6 Months";
      const duration = normalizePaidDuration(rawDuration);
      if (!duration) {
        return res.status(400).json({ success: false, message: "Enter a whole number of months for a paid internship." });
      }
      body.internshipDuration = duration;
    }

    const nextBranch = String(body.branch !== undefined ? body.branch : student.branch).trim();
    const branchChanged = body.branch !== undefined && nextBranch !== student.branch;
    let targetDivision = student.trainingManagement?.division || "";
    if (branchChanged && student.status === "Approved") {
      const { getAdministration } = require("../services/administrationService");
      const currentDivision = student.trainingManagement?.division;
      let capacityError = "";
      
      if (currentDivision) {
        capacityError = await validateDivisionCapacity({
          Student,
          studentId: student._id,
          division: currentDivision,
          branch: nextBranch,
          internshipType: student.internshipType,
        });
      } else {
        capacityError = "No division assigned.";
      }
      
      if (capacityError) {
        let foundDivision = null;
        const administration = await getAdministration();
        for (const div of administration.divisions) {
          const divError = await validateDivisionCapacity({
            Student,
            studentId: student._id,
            division: div,
            branch: nextBranch,
            internshipType: student.internshipType,
          });
          if (!divError) {
            foundDivision = div;
            break;
          }
        }
        
        if (foundDivision) {
          targetDivision = foundDivision;
        } else {
          return res.status(400).json({
            success: false,
            code: "COURSE_BRANCH_CAPACITY_UNAVAILABLE",
            message: `No available division/seat is currently available for ${nextBranch}.`,
          });
        }
      }
    }

    // Validate using the existing validation rules before saving.
    if (body.name !== undefined && !body.name.trim()) {
      return res.status(400).json({ success: false, message: "Name cannot be empty." });
    }

    if (body.gender !== undefined && body.gender && !["Male", "Female", "Other"].includes(body.gender)) {
      return res.status(400).json({ success: false, message: "Select a valid gender." });
    }

    if (body.phone && !/^\d{10}$/.test(body.phone)) {
      return res.status(400).json({ success: false, message: "Phone number must be exactly 10 digits." });
    }

    if (body.fatherPhone && !/^\d{10}$/.test(body.fatherPhone)) {
      return res.status(400).json({ success: false, message: "Father contact number must be exactly 10 digits." });
    }

    if (body.aadhaarNumber && !/^\d{12}$/.test(body.aadhaarNumber)) {
      return res.status(400).json({ success: false, message: "Aadhaar Number must contain exactly 12 digits." });
    }

    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }

    if (body.dob && new Date(body.dob) > new Date()) {
      return res.status(400).json({ success: false, message: "Date of birth cannot be in the future." });
    }

    if (student.internshipType !== "Paid" && body.internshipJoiningMonth && !/^\d{4}-\d{2}$/.test(body.internshipJoiningMonth)) {
      return res.status(400).json({ success: false, message: "Select a valid internship joining month." });
    }

    if (body.permissionLetterDate && !isValidDateValue(body.permissionLetterDate)) {
      return res.status(400).json({ success: false, message: "Select a valid college referral letter date." });
    }

    if (body.cgpa) {
      const cgpa = Number(body.cgpa);
      if (Number.isNaN(cgpa) || cgpa < 0 || cgpa > 10) {
        return res.status(400).json({ success: false, message: "CGPA must be between 0 and 10." });
      }
    }

    if (body.collegeState && !indianStatesAndUnionTerritories.includes(body.collegeState)) {
      return res.status(400).json({ success: false, message: "Select a valid college state or union territory." });
    }

    if (body.collegeAddress !== undefined && !String(body.collegeAddress || "").trim()) {
      return res.status(400).json({ success: false, message: "College Address is mandatory." });
    }

    // Update text fields
    if (body.name !== undefined) student.name = body.name;
    if (body.gender !== undefined) student.gender = body.gender;
    if (body.phone !== undefined) student.phone = body.phone;
    if (body.email !== undefined) student.email = body.email.trim().toLowerCase();
    if (body.aadhaarNumber !== undefined) student.aadhaarNumber = body.aadhaarNumber;
    if (body.dob !== undefined) student.dob = body.dob;

    if (body.collegeName !== undefined) student.collegeName = body.collegeName;
    if (body.collegeAddress !== undefined) student.collegeAddress = body.collegeAddress;
    if (body.collegeLocation !== undefined) student.location = body.collegeLocation;
    if (body.collegeState !== undefined) student.collegeState = body.collegeState;

    if (body.course !== undefined) student.course = body.course;
    if (body.branch !== undefined) student.branch = body.branch;
    if (body.year !== undefined) student.year = body.year;
    if (body.cgpa !== undefined) student.cgpa = Number(body.cgpa);
    if (body.collegeId !== undefined) student.collegeId = body.collegeId;

    if (body.currentAddress !== undefined) student.currentAddress = body.currentAddress;
    if (body.permanentAddress !== undefined) student.permanentAddress = body.permanentAddress;

    if (body.fatherName !== undefined) student.fatherName = body.fatherName;
    if (body.fatherPhone !== undefined) student.fatherPhone = body.fatherPhone;
    if (body.fatherOccupation !== undefined) student.fatherOccupation = body.fatherOccupation;

    if (body.internshipDuration !== undefined) student.internshipDuration = body.internshipDuration;
    if (body.permissionLetterNumber !== undefined) student.permissionLetterNumber = body.permissionLetterNumber;
    if (body.permissionLetterDate !== undefined) student.permissionLetterDate = body.permissionLetterDate;
    if (body.internshipJoiningMonth !== undefined) student.internshipJoiningMonth = body.internshipJoiningMonth;

    if (body.resignationStatus !== undefined) student.resignationStatus = body.resignationStatus;
    if (body.resignationDate !== undefined) student.resignationDate = body.resignationDate;
    if (body.paidInternshipProjectDetails !== undefined) {
      student.paidInternshipProjectDetails = {
        ...student.paidInternshipProjectDetails,
        ...body.paidInternshipProjectDetails
      };
    }
    if (body.bankDetails !== undefined) {
      student.bankDetails = {
        ...student.bankDetails,
        ...body.bankDetails
      };
    }
    if (body.firstQuarterReport !== undefined) {
      student.firstQuarterReport = {
        ...student.firstQuarterReport,
        ...body.firstQuarterReport
      };
    }
    if (body.secondQuarterReport !== undefined) {
      student.secondQuarterReport = {
        ...student.secondQuarterReport,
        ...body.secondQuarterReport
      };
    }
    if (body.trainingManagement !== undefined) {
      student.trainingManagement = {
        ...student.trainingManagement,
        ...body.trainingManagement
      };
    }

    // Handle document file replacements
    const filesToReplace = ["resume", "result", "photo", "permissionLetter"];
    for (const fieldName of filesToReplace) {
      if (req.uploadedFiles && req.uploadedFiles[fieldName]) {
        if (student[fieldName]) {
          await removeLocalFile(student[fieldName]);
        }
        student[fieldName] = {
          url: req.uploadedFiles[fieldName].url,
          publicId: req.uploadedFiles[fieldName].public_id,
        };
      }
    }

    // Sync with sub-documents
    if (student.trainingManagement) {
      student.trainingManagement.studentName = student.name;
      student.trainingManagement.courseName = student.course;
      student.trainingManagement.courseYear = student.year;
      student.trainingManagement.branch = student.branch;
      student.trainingManagement.collegeName = student.collegeName;
      student.trainingManagement.collegeLocation = student.location;
      student.trainingManagement.trainingDuration = student.internshipDuration;
      student.trainingManagement.collegeAddress = student.collegeAddress;
      if (branchChanged && student.status === "Approved") {
        student.trainingManagement.division = targetDivision;
      }
    }

    if (student.offerLetter) {
      student.offerLetter.studentName = student.name;
      student.offerLetter.course = student.course;
      student.offerLetter.year = student.year;
      student.offerLetter.branch = student.branch;
      student.offerLetter.collegeName = student.collegeName;
      student.offerLetter.collegeLocation = student.location;
      student.offerLetter.internshipDuration = student.internshipDuration;
      student.offerLetter.collegeAddress = student.collegeAddress;
    }

    await student.save();

    await logActivity({
      req,
      module: "Student Module",
      action: "Edited Student Details",
      description: `Edited student details for ${student.name}.`,
      status: "Success",
    });

    return res.status(200).json({
      success: true,
      student,
      message: "Student details updated successfully.",
    });
   } catch (error) {
    await logActivity({
      req,
      module: "Student Module",
      action: "Edited Student Details",
      description: `Failed to edit student details. Error: ${error.message}`,
      status: "Failed",
    });

    return res.status(500).json({
      success: false,
      message: "Unable to update student details.",
      error: error.message,
    });
   }
  });
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function isValidDateValue(value) {
  if (!datePattern.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

module.exports = {
  deleteStudents,
  downloadCertificates,
  getCertificateStudents,
  removeCertificateBufferStudents,
  getStudents,
  getStudentById,
  updateStudentReview,
  uploadOfferLetter,
  saveTrainingManagement,
  updateStudentDetails,
  recommendedByOptions,
  generateReportPdf,
  exportApplications,
};

async function exportApplications(req, res) {
  try {
    const { generateApplicationsWorkbook } = require("../services/applicationExportService");
    const today = new Date().toISOString().slice(0, 10);
    const filename = `applications-${today}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    const { workbook, count } = await generateApplicationsWorkbook();

    await logActivity({
      req,
      module: "Student Module",
      action: "Exported Applications",
      description: `Exported ${count} student application(s) as Excel (.xlsx).`,
      status: "Success",
    });

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Export applications error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to export applications.",
      });
    }
  }
}

async function generateReportPdf(req, res) {
  try {
    const { html } = req.body;
    if (!html) {
      return res.status(400).json({ success: false, message: "HTML content is required." });
    }
    const { generatePdfFromHtml } = require("../services/pdfService");
    const pdfBuffer = await generatePdfFromHtml(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Attendance-Report.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to generate PDF.", error: error.message });
  }
}

