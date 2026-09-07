const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const { Schema } = mongoose;

const securityQuestionSchema = new Schema(
  {
    id: String,
    question: String,
    // Hashed inline by controllers/adminAuthController.js's
    // saveSecurityQuestion (bcrypt.hash(answer, 12)) BEFORE admin.save() is
    // called - there is no model-level hook for this field today, so none is
    // added here either. Adding one would double-hash and diverge from
    // current behavior.
    answer: String,
  },
  { _id: false }
);

const adminSchema = new Schema(
  {
    name: String,
    // Unique per user sign-off: Postgres never enforced this at the DB level
    // (only a plain expression index, idx_admins_email), only via a racy
    // Admin.exists({email}) pre-insert check in adminAuthController.js.
    // Confirmed no existing duplicates before enabling this - see the
    // migration pre-check report.
    email: { type: String, unique: true, index: true },

    // select: false on all four of these restores the narrower behavior the
    // calling code already assumes (.select("+password"),
    // .select("+password +birthPlace +birthDate") etc.) but that the current
    // postgresStore.js shim doesn't actually provide - see
    // services/postgresStore.js:45-56's project(): any "+"-prefixed token in
    // the selection string currently makes it return the ENTIRE record, not
    // just the named field(s), meaning .select("+password") today leaks
    // every other sensitive field too. Real Mongoose's select:false gives
    // the narrower, presumably-intended behavior for free.
    password: { type: String, select: false },
    role: { type: String, enum: ["MAIN_ADMIN", "SUB_ADMIN"] },
    // Assigned by adminAuthController.js's createSubUser (Admin.create({...,
    // status: "Active"})) but never declared - silently dropped on create.
    status: { type: String, default: "Active" },

    secretQuestion: String,
    secretAnswer: { type: String, select: false },
    recoverySetup: { type: Boolean, default: false },
    securityQuestions: [securityQuestionSchema],

    // Referenced by controllers/adminAuthController.js:263,269-270 (a
    // birth-details password-recovery flow) but never assigned anywhere in
    // the codebase - grepped the whole backend, no write site exists. Kept
    // here for schema parity since the read path exists and expects these
    // fields, but this recovery flow appears to be dead/broken today
    // (bcrypt.compare against an always-undefined hash) - flagging for you,
    // not fixing it as part of this migration.
    birthPlace: { type: String, select: false },
    birthDate: { type: String, select: false },
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

// --- Password / secret-answer hashing -----------------------------------
// Ported from models/Admin.js:5-11 as-is: hash on save only if the value
// isn't already a bcrypt hash (same "$2" prefix guard), so re-saving an
// admin whose password/secretAnswer are already hashed is a no-op, exactly
// like today. Not redesigned.
adminSchema.pre("save", async function hashCredentialsBeforeSave(next) {
  if (this.password && !this.password.startsWith("$2")) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  if (this.secretAnswer && !this.secretAnswer.startsWith("$2")) {
    this.secretAnswer = await bcrypt.hash(this.secretAnswer.trim().toLowerCase(), 12);
  }
  next();
});

adminSchema.methods.matchPassword = function matchPassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

adminSchema.methods.matchSecretAnswer = function matchSecretAnswer(candidate) {
  if (!this.secretAnswer) return Promise.resolve(false);
  return bcrypt.compare(candidate.trim().toLowerCase(), this.secretAnswer);
};

module.exports = mongoose.model("Admin", adminSchema);
