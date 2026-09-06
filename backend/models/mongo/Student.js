const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../../utils/encryption");

const { Schema } = mongoose;

const FileRefSchema = new Schema(
  { url: String, publicId: String },
  { _id: false }
);

const studentSchema = new Schema(
  {
    // Unique per user sign-off: Postgres never enforced this at the DB level
    // (only a plain expression index, idx_students_reference_id), only via a
    // racy Student.exists({referenceId}) pre-insert check in
    // controllers/studentController.js. Confirmed no existing duplicates
    // before enabling this - see the migration pre-check report.
    referenceId: { type: String, unique: true, index: true },
    serialNumber: { type: Number, index: true },
    internshipType: { type: String, default: "Unpaid", index: true },

    name: { type: String, index: true },
    gender: { type: String, default: "" },
    course: String,
    branch: { type: String, index: true },
    year: { type: String, index: true },
    phone: { type: String, index: true },
    email: { type: String, index: true }, // no unique constraint in Postgres, and not made unique here either - students can legitimately reapply
    dob: Date,

    aadhaarNumber: String, // encrypted at rest, see the pre-save/post-query hooks below
    collegeName: { type: String, index: true },
    collegeAddress: { type: String, default: "" },
    collegeState: String,
    location: String,
    currentAddress: String,
    permanentAddress: String,

    fatherName: String,
    fatherPhone: String,
    fatherOccupation: String,
    cgpa: { type: Number, index: true },
    collegeId: String, // student's own college ID-card number - NOT a foreign key (name collision noted in original audit)

    internshipDuration: String,
    internshipJoiningDate: Date,
    internshipJoiningMonth: String,
    permissionLetterNumber: String,
    permissionLetterDate: Date,

    resume: FileRefSchema,
    result: FileRefSchema,
    photo: FileRefSchema,
    permissionLetter: FileRefSchema,
    aadhaarCard: { type: FileRefSchema, default: null },

    submittedAt: { type: Date, index: true },
    status: { type: String, default: "Pending", index: true },
    offerLetterStatus: { type: String, default: "", index: true },
    certificateGenerated: { type: Boolean, default: false },
    certificateBufferRemoved: { type: Boolean, default: false },
    gyapanGenerated: { type: Boolean, default: false },
    gyapanBufferRemoved: { type: Boolean, default: false },
    reviewedBy: String,
    reviewedAt: Date,
    approvedDate: { type: Date, index: true },
    recommendedBy: String,

    trainingManagement: {
      studentName: String,
      courseName: String,
      courseYear: String,
      branch: String,
      collegeName: String,
      collegeLocation: String,
      trainingDuration: String,
      collegeAddress: String,
      division: { type: String, index: true },
      fromDate: { type: Date, index: true },
      toDate: { type: Date, index: true },
    },

    offerLetter: {
      studentName: String,
      course: String,
      year: String,
      branch: String,
      collegeName: String,
      collegeLocation: String,
      internshipDuration: String,
      collegeAddress: String,
      issueDate: Date,
      letterNumber: String,
    },

    // These fields are deliberately separate from training management so only
    // the approved paid-internship student can maintain their project details
    // (mirrors the comment in the original models/Student.js).
    paidInternshipProjectDetails: {
      projectName: { type: String, default: "" },
      designationTitle: { type: String, default: "" },
      supervisorName: { type: String, default: "" },
      projectNameAndPdc: { type: String, default: "" },
      achievements: { type: String, default: "" },
    },

    // Schema.Types.Mixed, NOT a nested sub-schema: this field holds an
    // object ({bankName, savingAccountNumber, ifsc}) in application memory
    // but a single encrypted STRING at rest (see the encryption hooks
    // below). A nested sub-schema here would make Mongoose cast/reject the
    // pre-save hook's string assignment back to object shape, silently
    // defeating the encryption - caught by testing the hook directly rather
    // than assuming it worked.
    bankDetails: { type: Schema.Types.Mixed, default: () => ({ bankName: "", savingAccountNumber: "", ifsc: "" }) },

    firstQuarterReport: {
      fromDate: { type: String, default: "" },
      toDate: { type: String, default: "" },
      daysPresent: { type: String, default: "" },
    },
    secondQuarterReport: {
      fromDate: { type: String, default: "" },
      toDate: { type: String, default: "" },
      daysPresent: { type: String, default: "" },
    },

    resignationStatus: { type: String, default: "No", index: true },
    resignationDate: Date,
    certificateNumber: { type: Number, default: null },
    completedStatus: { type: String, index: true },
  },
  {
    // timestamps: true adds createdAt/updatedAt automatically on every new
    // save. The data migration script must set these explicitly from
    // Postgres's created_at/updated_at columns (via `new Student({..., createdAt, updatedAt})`
    // + `{ timestamps: false }` on that one insert, or a direct collection
    // insertMany bypassing hooks) rather than letting Mongoose regenerate them.
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound indexes matching the most common real query combinations found in
// controllers/adminStudentController.js (buildStudentFilter/buildSort),
// controllers/gyapanController.js, and services/divisionCapacityService.js.
studentSchema.index({ status: 1, internshipType: 1 });
studentSchema.index({ status: 1, "trainingManagement.division": 1, completedStatus: 1 });
studentSchema.index({ submittedAt: -1, createdAt: -1 }); // services/applicationExportService.js sort

// --- Encryption hooks -------------------------------------------------
// Ported from services/postgresStore.js:67-101 at exactly the same boundary:
// encrypt immediately before every write, decrypt immediately after every
// read. Same ENCRYPTION_KEY / aes-256-gcm (utils/encryption.js, reused
// unmodified), same two fields, same "bankDetails encrypted as one JSON
// string" behavior, same legacy-fallback-on-decrypt-failure behavior. Not
// redesigned.

function encryptSensitiveFields(doc) {
  if (doc.aadhaarNumber) {
    doc.aadhaarNumber = encrypt(doc.aadhaarNumber);
  }
  if (doc.bankDetails && typeof doc.bankDetails === "object") {
    doc.bankDetails = encrypt(JSON.stringify(doc.bankDetails));
  }
}

function decryptSensitiveFields(doc) {
  if (doc.aadhaarNumber) {
    doc.aadhaarNumber = decrypt(doc.aadhaarNumber);
  }
  if (doc.bankDetails && typeof doc.bankDetails === "string") {
    try {
      doc.bankDetails = JSON.parse(decrypt(doc.bankDetails));
    } catch (e) {
      // legacy-compatibility fallback, identical to postgresStore.js:92-96
      if (doc.bankDetails.trim().startsWith("{")) {
        try {
          doc.bankDetails = JSON.parse(doc.bankDetails);
        } catch (err) {
          // leave as-is, matching current behavior
        }
      }
    }
  }
}

studentSchema.pre("save", function encryptBeforeSave(next) {
  encryptSensitiveFields(this);
  next();
});

// BUG FOUND AND FIXED before this ever shipped: a `post("init")` hook (the
// original design here) does NOT fire for .lean() queries -- .lean()
// explicitly skips Mongoose's document-hydration machinery, which is what
// "init" is part of. .lean() is used extensively for exactly the read paths
// that show student data (the main admin student list, division-capacity
// checks, the scheduled Excel export) -- every one of those would have
// silently returned still-encrypted aadhaarNumber/bankDetails. Verified this
// with a real .lean() query against seeded data before writing the fix; see
// tests/decryption.test.js for the regression test.
//
// Fixed by hooking the query-level events instead, which fire with the
// final result set regardless of whether it was lean()'d or hydrated into
// full documents: "find" (arrays), "findOne" (single doc/null), and
// "findOneAndUpdate" (single doc/null - also covers findByIdAndUpdate,
// which Mongoose implements as a thin wrapper sharing the same hook).
// decryptSensitiveFields() is idempotent (it type-checks before touching
// each field), so this and encryptBeforeSave above can never double-apply
// against each other by accident.
function decryptQueryResult(result) {
  if (!result) return;
  if (Array.isArray(result)) {
    result.forEach(decryptSensitiveFields);
  } else {
    decryptSensitiveFields(result);
  }
}

studentSchema.post(["find", "findOne", "findOneAndUpdate"], function decryptAfterQuery(result) {
  decryptQueryResult(result);
});

module.exports = mongoose.model("Student", studentSchema);
