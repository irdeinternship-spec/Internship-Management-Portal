const mongoose = require("mongoose");

const { Schema } = mongoose;

const activityLogSchema = new Schema(
  {
    // Deliberate exception to "ObjectId everywhere" - see the _id decision.
    // utils/activityLogger.js:16 sets this to `admin._id || admin.id ||
    // "system"`, so it can legitimately hold the literal string "system",
    // not just an id. Kept as String (storing the admin ObjectId's
    // .toString() when it is one) rather than inventing a fake sentinel
    // ObjectId just to satisfy a stricter type.
    userId: { type: String, index: true },
    userName: String,
    role: String,
    module: String,
    action: String,
    description: String,
    status: String,
    // Assigned by services/emailService.js's logEmailActivity (the
    // disabled-email logging path) but never declared - silently dropped on
    // every one of those log entries.
    recipient: String,
    subject: String,
    templateName: String,
    // queried/sorted at controllers/adminAuthController.js:477,497
    // (ActivityLog.find({ userId }).sort({ timestamp: -1 })) - kept as its
    // own field separate from createdAt since the app sets/reads it
    // explicitly rather than relying on the timestamps plugin for this one.
    timestamp: { type: Date, index: true },
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

module.exports = mongoose.model("ActivityLog", activityLogSchema);
