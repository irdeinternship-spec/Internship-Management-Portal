const { createPostgresModel } = require("../services/mongoStore");

module.exports = createPostgresModel("students.json", {
  status: "Pending",
  offerLetterStatus: "",
  certificateGenerated: false,
  certificateBufferRemoved: false,
  gyapanGenerated: false,
  gyapanBufferRemoved: false,
  aadhaarCard: null,
  collegeAddress: "",
  internshipType: "Unpaid",
  gender: "",
  // These fields are deliberately separate from training management so only
  // the approved paid-internship student can maintain their project details.
  paidInternshipProjectDetails: {
    projectName: "",
    designationTitle: "",
    supervisorName: "",
    projectNameAndPdc: "",
    achievements: "",
  },
  bankDetails: {
    bankName: "",
    savingAccountNumber: "",
    ifsc: "",
  },
  firstQuarterReport: {
    fromDate: "",
    toDate: "",
    daysPresent: "",
  },
  secondQuarterReport: {
    fromDate: "",
    toDate: "",
    daysPresent: "",
  },
  resignationStatus: "No",
  resignationDate: null,
  certificateNumber: null,
});
