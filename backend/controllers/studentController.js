const Student = require("../models/Student");
const fs = require("fs/promises");
const path = require("path");
const jwt = require("jsonwebtoken");
const { getCookieOptions } = require("../utils/cookieOptions");
const { generatePdfFromHtml } = require("../services/pdfService");
const { removeLocalFile } = require("../services/localStorageService");
const { sendRegistrationConfirmationEmail } = require("../services/emailService");
const {
  indianStatesAndUnionTerritories,
} = require("../data/indianStates");


const requiredFields = [
  "name",
  "gender",
  "course",
  "branch",
  "branchCode",
  "currentYear",
  "phone",
  "email",
  "dob",
  "aadhaarNumber",
  "collegeName",
  "collegeAddress",
  "collegeState",
  "collegeLocation",
  "currentAddress",
  "permanentAddress",
  "fatherName",
  "fatherPhone",
  "fatherOccupation",
  "cgpa",
  "collegeId",
  "internshipDuration",
  "internshipJoiningMonth",
  "permissionLetterNumber",
  "permissionLetterDate",
];

const BRANCH_CODES = ["EE", "ME", "CS", "PH"];
const MAX_AGE_YEARS = 28;
const MIN_CGPA = 7.5;

// Whole years completed as of `asOf`, by calendar date - not a millisecond
// division, which drifts across leap years. Age is measured on the application
// date, so `asOf` defaults to now.
function ageInYears(dateOfBirth, asOf = new Date()) {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return NaN;
  let age = asOf.getFullYear() - dob.getFullYear();
  const monthDelta = asOf.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < dob.getDate())) age -= 1;
  return age;
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

function validateRequest(body, files) {
  if (body.internshipType === "Paid" && body.internshipDuration && body.internshipDuration !== "6 Months") {
    return "Paid internship duration is fixed at 6 Months.";
  }
  const fields = requiredFields.filter(f => !(body.internshipType === "Paid" && (f === "internshipDuration" || f === "internshipJoiningMonth")));
  const missingFields = fields.filter(
    (field) => !String(body[field] || "").trim()
  );

  const missingFiles = [
    "resume",
    "result",
    "photo",
    "permissionLetter",
    "aadhaarCard",
  ].filter((field) => !files?.[field]?.[0]);

  if (missingFiles.includes("aadhaarCard")) {
    return "Please upload your Aadhaar Card.";
  }

  if (missingFields.length || missingFiles.length) {
    const displayNames = {
      resume: "Curriculum Vitae",
      result: "Marksheet",
      collegeLocation: "College Location (City)",
      collegeState: "College State",
      collegeAddress: "College Address",
      collegeId: "College ID Card Number",
      currentAddress: "Current Address",
      permanentAddress: "Permanent Address",
      fatherName: "Father's Name",
      fatherPhone: "Father's Phone Number",
      fatherOccupation: "Parent's Occupation",
      internshipJoiningMonth: "Internship Joining Month",
      permissionLetterNumber: "Permission Letter Number",
      permissionLetterDate: "Permission Letter Date",
      permissionLetter: "Permission Letter",
      aadhaarNumber: "Aadhaar Number",
      aadhaarCard: "Aadhaar Card",
      dob: "Date of Birth",
      currentYear: "Current Year",
      name: "Student Name",
      course: "Course",
      branch: "Branch",
      branchCode: "Branch Code",
      phone: "Phone Number",
      email: "Email Address",
      dob: "Date of Birth",
      cgpa: "CGPA",
    };
    const allMissing = [...missingFields, ...missingFiles].map(f => displayNames[f] || f);
    return `Missing required fields: ${allMissing.join(", ")}`;
  }

  if (!/^\d{10}$/.test(body.phone)) {
    return "Phone number must be exactly 10 digits.";
  }

  if (!/^\d{10}$/.test(body.fatherPhone)) {
    return "Father contact number must be exactly 10 digits.";
  }

  if (!/^\d{12}$/.test(body.aadhaarNumber)) {
    return "Aadhaar Number must contain exactly 12 digits.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return "Enter a valid email address.";
  }

  if (!['Male', 'Female', 'Other'].includes(body.gender)) {
    return "Select a valid gender.";
  }

  if (new Date(body.dob) > new Date()) {
    return "Date of birth cannot be in the future.";
  }

  if (ageInYears(body.dob) > MAX_AGE_YEARS) {
    return `Applicants must be ${MAX_AGE_YEARS} years or younger.`;
  }

  if (body.internshipType !== "Paid" && !/^\d{4}-\d{2}$/.test(body.internshipJoiningMonth || "")) {
    return "Select a valid internship joining month.";
  }

  if (!isValidDateValue(body.permissionLetterDate)) {
    return "Select a valid college referral letter date.";
  }

  const cgpa = Number(body.cgpa);

  if (Number.isNaN(cgpa) || cgpa < 0 || cgpa > 10) {
    return "CGPA must be between 0 and 10.";
  }

  if (cgpa < MIN_CGPA) {
    return `Minimum required CGPA is ${MIN_CGPA}.`;
  }

  if (!BRANCH_CODES.includes(body.branchCode)) {
    return `Select a valid branch code (${BRANCH_CODES.join(", ")}).`;
  }

  if (!indianStatesAndUnionTerritories.includes(body.collegeState)) {
    return "Select a valid college state or union territory.";
  }

  return "";
}

function generateReferenceId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const crypto = require("crypto");
  return Array.from({ length: 7 }, () => {
    const index = crypto.randomInt(0, chars.length);
    return chars[index];
  }).join("");
}

async function createUniqueReferenceId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const referenceId = generateReferenceId();
    const exists = await Student.exists({ referenceId });
    if (!exists) return referenceId;
  }

  throw new Error("Unable to generate a unique Application ID.");
}

async function getNextSerialNumber() {
  const lastStudent = await Student.findOne({ serialNumber: { $exists: true } })
    .sort({ serialNumber: -1 })
    .select("serialNumber");

  return (lastStudent?.serialNumber || 0) + 1;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN");
}

function buildStudentTemplateData(student) {
  return {
    studentName: student.name,
    fatherName: student.fatherName,
    parentOccupation: student.fatherOccupation,
    temporaryAddress: student.currentAddress,
    permanentAddress: student.permanentAddress,
    collegeName: student.collegeName,
    collegeLocation: student.location,
    course: student.course,
    year: student.year,
    branch: student.branch,
    mobileNumber: student.phone,
    residencePhone: student.fatherPhone,
    email: student.email,
    dateOfBirth: formatDate(student.dob),
    nationality: "Indian",
    collegeIdNumber: student.collegeId,
    issueDate: "",
    place: "",
    sponsoringAuthorityName: "",
    sponsoringAuthorityDesignation: "",
    policePlace: "",
    policeDate: "",
    policeAuthorityName: "",
    policeAuthorityDesignation: "",
  };
}

async function renderTemplate(templateName, data) {
  const templatePath = path.join(__dirname, "..", "templates", templateName);
  const template = await fs.readFile(templatePath, "utf8");

  return template.replace(/{{(\w+)}}/g, (match, key) => escapeHtml(data[key] ?? ""));
}

function publicStudent(student) {
  const value = student.toObject ? student.toObject() : student;
  delete value.aadhaarNumber;
  delete value.offerLetter?.pdfBuffer;
  return value;
}

async function findStudentForPortal(email, referenceId) {
  return Student.findOne({
    email: String(email || "").trim().toLowerCase(),
    referenceId: String(referenceId || "").trim().toUpperCase(),
  });
}

async function createStudent(req, res) {
  try {
    const validationError = validateRequest(req.body, req.files);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const referenceId = req.referenceId || (await createUniqueReferenceId());
    const serialNumber = await getNextSerialNumber();

    const student = new Student({
      referenceId,
      serialNumber,
      internshipType: req.body.internshipType || "Unpaid",
      name: req.body.name,
      gender: req.body.gender,
      course: req.body.course,
      branch: req.body.branch,
      branchCode: req.body.branchCode,
      year: req.body.currentYear,

      phone: req.body.phone,
      email: req.body.email.trim().toLowerCase(),
      dob: req.body.dob,

      aadhaarNumber: req.body.aadhaarNumber,

      collegeName: req.body.collegeName,
      collegeAddress: req.body.collegeAddress,
      collegeState: req.body.collegeState,
      location: req.body.collegeLocation,

      currentAddress: req.body.currentAddress,
      permanentAddress: req.body.permanentAddress,

      fatherName: req.body.fatherName,
      fatherPhone: req.body.fatherPhone,
      fatherOccupation: req.body.fatherOccupation,

      cgpa: Number(req.body.cgpa),

      collegeId: req.body.collegeId,

      // Registration for the paid programme is always six months. This is
      // intentionally enforced server-side, independently of the form UI.
      internshipDuration: req.body.internshipType === "Paid" ? "6 Months" : req.body.internshipDuration,
      internshipJoiningDate: req.body.internshipJoiningDate || "",
      internshipJoiningMonth: req.body.internshipJoiningMonth,

      permissionLetterNumber: req.body.permissionLetterNumber,
      permissionLetterDate: req.body.permissionLetterDate,

      resume: {
        url: req.uploadedFiles.resume.url,
        publicId: req.uploadedFiles.resume.public_id,
      },

      result: {
        url: req.uploadedFiles.result.url,
        publicId: req.uploadedFiles.result.public_id,
      },

      photo: {
        url: req.uploadedFiles.photo.url,
        publicId: req.uploadedFiles.photo.public_id,
      },

      permissionLetter: {
        url: req.uploadedFiles.permissionLetter.url,
        publicId: req.uploadedFiles.permissionLetter.public_id,
      },
      aadhaarCard: {
        url: req.uploadedFiles.aadhaarCard.url,
        publicId: req.uploadedFiles.aadhaarCard.public_id,
      },

      submittedAt: new Date(),
    });

    // Saving the registration is the transaction boundary for this endpoint.
    // A confirmation email is useful, but it must never turn a completed
    // registration into a failed request.
    const savedStudent = await student.save();
    let emailResult;
    let emailWarning;

    try {
      emailResult = await sendRegistrationConfirmationEmail(savedStudent);
    } catch (emailError) {
      console.error(
        `Registration email failed for ${savedStudent.referenceId}:`,
        emailError
      );
      emailWarning = "Registration successful, but the confirmation email could not be sent.";
    }

    return res.status(201).json({
      success: true,
      message: "Student registered successfully.",
      referenceId: savedStudent.referenceId,
      serialNumber: savedStudent.serialNumber,
      ...(emailResult ? { email: emailResult } : {}),
      ...(emailWarning ? { warning: emailWarning } : {}),
      student: publicStudent(savedStudent),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Unable to register student. Please try again.",
      error: error.message,
    });
  }
}

async function deleteStudent(req, res) {
  try {
    // Find student
    const student = await Student.findById(req.params.id);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    await Promise.allSettled([student.resume, student.result, student.photo, student.permissionLetter, student.aadhaarCard, student.completedDocuments, student.offerLetter].map(removeLocalFile));
    await Student.deleteMany({ _id: req.params.id });

    return res.status(200).json({
      success: true,
      message: "Student and all uploaded files deleted successfully.",
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Unable to delete student.",
      error: error.message,
    });
  }
}

async function loginStudent(req, res) {
  try {
    const { email, referenceId } = req.body;

    if (!email || !referenceId) {
      return res.status(400).json({
        success: false,
        message: "Registered email address and Application ID are required.",
      });
    }

    const student = await findStudentForPortal(email, referenceId);

    if (!student) {
      return res.status(401).json({
        success: false,
        message: "Email address and Application ID do not match any registration.",
      });
    }

    const token = jwt.sign(
      { id: student._id, role: "student" },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    res.cookie("token", token, getCookieOptions({
      maxAge: 8 * 60 * 60 * 1000 // 8 hours, matches JWT_EXPIRES_IN
    }));

    return res.status(200).json({
      success: true,
      message: "Student login successful.",
      student: publicStudent(student),
      token,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to login student.",
      error: error.message,
    });
  }
}

async function getStudentDashboard(req, res) {
  try {
    const student = req.student;

    if (!student) {
      return res.status(401).json({
        success: false,
        message: "Student not found or unauthenticated.",
      });
    }

    return res.status(200).json({
      success: true,
      student: publicStudent(student),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to fetch student dashboard.",
      error: error.message,
    });
  }
}

async function savePaidInternshipProjectDetails(req, res) {
  try {
    const student = req.student;

    if (!student) {
      return res.status(401).json({ success: false, message: "Student not found or unauthenticated." });
    }
    if (student.status !== "Approved" || student.internshipType !== "Paid") {
      return res.status(403).json({ success: false, message: "Project details are available only to approved paid-internship students." });
    }

    // Save project details if provided or preserve existing
    if (req.body.projectName !== undefined || req.body.designationTitle !== undefined || req.body.supervisorName !== undefined || req.body.projectNameAndPdc !== undefined || req.body.achievements !== undefined) {
      const fields = ["projectName", "designationTitle", "supervisorName", "projectNameAndPdc", "achievements"];
      const details = {};
      for (const field of fields) {
        if (req.body[field] !== undefined) {
          details[field] = String(req.body[field] || "").trim();
        } else {
          details[field] = student.paidInternshipProjectDetails?.[field] || "";
        }
      }
      student.paidInternshipProjectDetails = details;
    }

    // Save Bank Details
    if (req.body.bankDetails) {
      const { bankName, savingAccountNumber, ifsc } = req.body.bankDetails;
      if (savingAccountNumber && !/^\d+$/.test(savingAccountNumber)) {
        return res.status(400).json({ success: false, message: "Saving Account Number must contain digits only." });
      }
      if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc)) {
        return res.status(400).json({ success: false, message: "Enter a valid 11-digit IFSC code (e.g. SBIN0001234)." });
      }
      student.bankDetails = {
        bankName: String(bankName || "").trim(),
        savingAccountNumber: String(savingAccountNumber || "").trim(),
        ifsc: String(ifsc || "").toUpperCase().trim(),
      };
    }

    // Save First Quarter Report
    if (req.body.firstQuarterReport) {
      const { fromDate, toDate, daysPresent } = req.body.firstQuarterReport;
      if (fromDate && isNaN(Date.parse(fromDate))) {
        return res.status(400).json({ success: false, message: "First Quarter Report From Date is invalid." });
      }
      if (toDate && isNaN(Date.parse(toDate))) {
        return res.status(400).json({ success: false, message: "First Quarter Report To Date is invalid." });
      }
      if (fromDate && toDate) {
        const start = new Date(fromDate);
        const end = new Date(toDate);
        if (end < start) {
          return res.status(400).json({ success: false, message: "First Quarter Report To Date cannot be earlier than From Date." });
        }
        const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
        if (diffDays > 95) {
          return res.status(400).json({ success: false, message: "First Quarter Report: Date range must not exceed 95 days." });
        }
      }
      if (daysPresent !== undefined && daysPresent !== "") {
        const days = Number(daysPresent);
        if (!Number.isSafeInteger(days) || days < 0) {
          return res.status(400).json({ success: false, message: "First Quarter Report Days Present must be a non-negative whole number." });
        }
      }
      student.firstQuarterReport = {
        fromDate: fromDate || "",
        toDate: toDate || "",
        daysPresent: daysPresent !== undefined && daysPresent !== "" ? Number(daysPresent) : "",
      };
    }

    // Save Second Quarter Report
    if (req.body.secondQuarterReport) {
      const { fromDate, toDate, daysPresent } = req.body.secondQuarterReport;
      if (fromDate && isNaN(Date.parse(fromDate))) {
        return res.status(400).json({ success: false, message: "Second Quarter Report From Date is invalid." });
      }
      if (toDate && isNaN(Date.parse(toDate))) {
        return res.status(400).json({ success: false, message: "Second Quarter Report To Date is invalid." });
      }
      if (fromDate && toDate) {
        const start = new Date(fromDate);
        const end = new Date(toDate);
        if (end < start) {
          return res.status(400).json({ success: false, message: "Second Quarter Report To Date cannot be earlier than From Date." });
        }
        const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
        if (diffDays > 95) {
          return res.status(400).json({ success: false, message: "Second Quarter Report: Date range must not exceed 95 days." });
        }
      }
      if (daysPresent !== undefined && daysPresent !== "") {
        const days = Number(daysPresent);
        if (!Number.isSafeInteger(days) || days < 0) {
          return res.status(400).json({ success: false, message: "Second Quarter Report Days Present must be a non-negative whole number." });
        }
      }
      student.secondQuarterReport = {
        fromDate: fromDate || "",
        toDate: toDate || "",
        daysPresent: daysPresent !== undefined && daysPresent !== "" ? Number(daysPresent) : "",
      };
    }

    await student.save();

    return res.status(200).json({ success: true, message: "Details saved successfully.", student: publicStudent(student) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to save details.", error: error.message });
  }
}

async function downloadStudentDocument(req, res) {
  try {
    const student = req.student;

    if (!student) {
      return res.status(401).json({
        success: false,
        message: "Student not found or unauthenticated.",
      });
    }

    if (student.status !== "Approved") {
      return res.status(403).json({
        success: false,
        message: "Documents to be filled by students are available only after application approval.",
      });
    }

    const typeMap = {
      declaration: "declaration_form.html",
      character: "character_certificate.html",
    };
    const templateName = typeMap[req.params.type];

    if (!templateName) {
      return res.status(404).json({
        success: false,
        message: "Document template not found.",
      });
    }

    const html = await renderTemplate(templateName, buildStudentTemplateData(student));

    const pdf = await generatePdfFromHtml(html);
    const filename =
      req.params.type === "declaration"
        ? "DRDO-Declaration-Form.pdf"
        : "DRDO-Character-Certificate.pdf";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.send(pdf);
  } 
  catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

async function uploadCompletedStudentDocuments(req, res) {
  try {
    const student = req.student;

    if (!student) {
      return res.status(401).json({
        success: false,
        message: "Student not found or unauthenticated.",
      });
    }

    if (student.status !== "Approved") {
      return res.status(403).json({
        success: false,
        message: "Completed documents can be uploaded only after approval.",
      });
    }

    student.completedDocuments = {
      url: req.uploadedCompletedDocuments.url,
      publicId: req.uploadedCompletedDocuments.publicId,
      uploadedAt: new Date(),
    };

    await student.save();

    return res.status(200).json({
      success: true,
      message: "Form 1 and Form 2 uploaded successfully.",
      student: publicStudent(student),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to upload Form 1 and Form 2.",
      error: error.message,
    });
  }
}

async function logoutStudent(req, res) {
  res.clearCookie("token", getCookieOptions());
  return res.status(200).json({ success: true, message: "Logged out successfully." });
}

module.exports = {
  createStudent,
  deleteStudent,
  downloadStudentDocument,
  getStudentDashboard,
  loginStudent,
  logoutStudent,
  savePaidInternshipProjectDetails,
  uploadCompletedStudentDocuments,
};
