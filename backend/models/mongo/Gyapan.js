const mongoose = require("mongoose");

const { Schema } = mongoose;

const studentRowSchema = new Schema(
  {
    // Denormalized snapshot taken at generation time (see
    // controllers/gyapanController.js), not a live join - kept as ObjectId
    // for consistency with the rest of the app's _id strategy even though
    // this copy is never dereferenced back to the student record.
    studentId: { type: Schema.Types.ObjectId, ref: "Student" },
    studentName: String,
    course: String,
    courseYear: String,
    branch: String,
    division: String,
    collegeName: String,
    collegeLocation: String,
    collegeAddress: String,
    trainingStartDate: Date,
    trainingEndDate: Date,
  },
  { _id: false }
);

const gyapanSchema = new Schema(
  {
    letterNumber: { type: String, default: "" },
    issueDate: Date,
    generated: { type: Boolean, default: false },
    generatedBy: { type: String, default: "" },
    // Assigned by controllers/gyapanController.js alongside generated/
    // generatedBy/pdfUrl/gyapanUrl/publicId but never declared here - silently
    // dropped on every save until this fix.
    generatedDate: Date,
    pdfUrl: { type: String, default: "" },
    gyapanUrl: { type: String, default: "" },
    publicId: { type: String, default: "" },
    uploadType: { type: String, default: "Generated" },
    studentRows: [studentRowSchema],
    // One-to-many to Student, ref'd for real populate()/$lookup support -
    // see the _id decision (ObjectId everywhere except activityLogs.userId).
    selectedStudents: [{ type: Schema.Types.ObjectId, ref: "Student" }],
    html: { type: String, default: "" },
    bufferMode: Boolean,
  },
  {
    timestamps: true,
    strict: "throw",
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

module.exports = mongoose.model("Gyapan", gyapanSchema);
