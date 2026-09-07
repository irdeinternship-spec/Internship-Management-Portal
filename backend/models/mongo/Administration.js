const mongoose = require("mongoose");

const { Schema } = mongoose;

// Fixed, well-known _id for the one-and-only administration document -
// per the sign-off, this is a singleton modeled with a hardcoded _id rather
// than relying on "whichever row happens to exist" (which is how
// services/administrationService.js works today via `SELECT ... LIMIT 1`).
// This also closes a latent race in the current code: two concurrent
// first-ever calls could both see zero rows and both insert a config row,
// silently forking the "singleton". A fixed _id + upsert (see
// getAdministration below) makes creation atomic and idempotent instead.
const SINGLETON_ID = new mongoose.Types.ObjectId("000000000000000000000001");

const branchSeatSchema = new Schema(
  { paid: { type: Number, default: 0 }, unpaid: { type: Number, default: 0 } },
  { _id: false }
);

const divisionConfigurationSchema = new Schema(
  {
    allowedBranches: { type: [String], default: [] },
    paidSeats: Number,
    unpaidSeats: Number,
    totalVacancy: { type: Number, default: 0 },
    branchSeats: { type: Map, of: branchSeatSchema, default: {} },
  },
  { _id: false }
);

const administrationSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, default: SINGLETON_ID },
    totalAllocatedSeats: { type: Number, default: 250 },
    paidSeatLimit: Number,
    unpaidSeatLimit: Number,
    totalSeatLimit: Number,
    nextCertificateNumber: { type: Number, default: 100 },
    divisions: { type: [String], default: [] },
    // Keyed by division name (matches the current JSONB object-keyed-by-name
    // shape exactly) - Map is the Mongoose type for an arbitrary-key nested
    // object like this, rather than a fixed set of schema paths.
    divisionConfigurations: { type: Map, of: divisionConfigurationSchema, default: {} },

    // Proforma/attendance report config, assigned by
    // controllers/administrationController.js's saveProformaConfig but never
    // declared here - PATCH /admin/administration/proforma has never
    // persisted anything since the Mongo migration; every save silently
    // no-opped. proformaSection1/proformas are Mixed because nothing in the
    // codebase reads their shape back (confirmed by grep) - there's no real
    // contract to type precisely, same reasoning as Student.bankDetails.
    proformaSelectedPeriod: String,
    attendanceSelectedPeriod: String,
    proformaQuarterEnding: String,
    proformaSection1: Schema.Types.Mixed,
    proformas: Schema.Types.Mixed,
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

const DEFAULT_DIVISIONS = [
  "Servo System", "ABS", "SS & ST", "NS (Naval System)", "OD (Optical Design)", "CS & S", "ALTDS", "LI", "LS", "LPF", "Photonics", "EAD", "LIDAR", "FTIR", "HR", "MS", "ISO", "AI", "VI", "IRST", "OME", "LIC", "ENV", "Reprography", "MT", "P & C", "AV", "CMD", "DIR", "HRD", "WORKS", "MI", "SECURITY",
];

// --- Statics: keep the exact accessor shape services/administrationService.js
// exports today (getAdministration, saveAdministration,
// reserveNextCertificateNumber), so no caller needs to change when this
// model is wired in. The normalization/defaulting logic in getAdministration
// is ported as-is from administrationService.js:18-70, not redesigned.

administrationSchema.statics.getAdministration = async function getAdministration() {
  const Administration = this;
  const doc = await Administration.findOneAndUpdate(
    { _id: SINGLETON_ID },
    { $setOnInsert: { divisions: DEFAULT_DIVISIONS } },
    { upsert: true, new: true }
  );

  const value = doc.toObject();
  value.divisions = [...(value.divisions || [])].sort((left, right) => left.localeCompare(right));
  value.divisionConfigurations = value.divisionConfigurations || {};

  value.paidSeatLimit = Number.isSafeInteger(value.paidSeatLimit) && value.paidSeatLimit >= 0 ? value.paidSeatLimit : undefined;
  value.unpaidSeatLimit = Number.isSafeInteger(value.unpaidSeatLimit) && value.unpaidSeatLimit >= 0 ? value.unpaidSeatLimit : undefined;
  value.totalSeatLimit = value.paidSeatLimit !== undefined && value.unpaidSeatLimit !== undefined
    ? value.paidSeatLimit + value.unpaidSeatLimit
    : undefined;

  value.divisions.forEach((division) => {
    const entry = value.divisionConfigurations[division];
    value.divisionConfigurations[division] = {
      allowedBranches: Array.isArray(entry?.allowedBranches) ? entry.allowedBranches : [],
      paidSeats: Number.isSafeInteger(entry?.paidSeats) && entry.paidSeats >= 0 ? entry.paidSeats : undefined,
      unpaidSeats: Number.isSafeInteger(entry?.unpaidSeats) && entry.unpaidSeats >= 0 ? entry.unpaidSeats : undefined,
      totalVacancy: Number.isSafeInteger(entry?.paidSeats) && entry.paidSeats >= 0 && Number.isSafeInteger(entry?.unpaidSeats) && entry.unpaidSeats >= 0
        ? entry.paidSeats + entry.unpaidSeats
        : (Number.isSafeInteger(entry?.totalVacancy) && entry.totalVacancy >= 0 ? entry.totalVacancy : 0),
      branchSeats: entry?.branchSeats && typeof entry.branchSeats === "object" && !Array.isArray(entry.branchSeats)
        ? Object.fromEntries(Object.entries(entry.branchSeats).map(([branch, seats]) => {
            if (seats && typeof seats === "object") {
              return [branch, {
                paid: Number.isSafeInteger(seats.paid) && seats.paid >= 0 ? seats.paid : 0,
                unpaid: Number.isSafeInteger(seats.unpaid) && seats.unpaid >= 0 ? seats.unpaid : 0,
              }];
            }
            return [branch, { paid: 0, unpaid: Number.isSafeInteger(seats) && seats >= 0 ? seats : 0 }];
          }))
        : {},
    };
  });
  Object.keys(value.divisionConfigurations).forEach((division) => {
    if (!value.divisions.includes(division)) delete value.divisionConfigurations[division];
  });
  value.nextCertificateNumber = Number.isSafeInteger(value.nextCertificateNumber) && value.nextCertificateNumber > 0 ? value.nextCertificateNumber : 100;
  return value;
};

administrationSchema.statics.saveAdministration = async function saveAdministration(configuration) {
  const Administration = this;
  configuration.divisions = [...configuration.divisions].sort((left, right) => left.localeCompare(right));
  try {
    await Administration.findOneAndUpdate(
      { _id: SINGLETON_ID },
      { $set: configuration },
      { upsert: true }
    );
  } catch (error) {
    // This is a query-level update (findOneAndUpdate + $set), not a document
    // instance mutation - config/mongoosePlugins.js's $set-override plugin
    // only covers the latter, so this one call site needs its own
    // model-name enrichment + logging.
    if (error.name === "StrictModeError") {
      error.modelName = "Administration";
      error.message = `[Administration] ${error.message}`;
      console.error(`❌ StrictModeError: ${error.message}`);
    }
    throw error;
  }
  return configuration;
};

// Ported from administrationService.js:83-121. The Postgres version wraps
// the administration increment and the student's certificateNumber write in
// one transaction with a `SELECT ... FOR UPDATE` row lock on the
// administration row.
//
// Re-examined what that lock actually protects, rather than defaulting to a
// Mongo session/transaction as the "equivalent" mechanism (an earlier draft
// of this function did exactly that, out of habit rather than because the
// logic required it): the lock's only job is to stop two concurrent callers
// from reading the same nextCertificateNumber and both computing the same
// "next" value - i.e. the counter increment itself must be atomic. It does
// NOT require the student write to be wrapped in the *same* transaction. If
// the counter increment succeeds but the student write fails or crashes
// afterward, the only consequence is one certificate number is permanently
// skipped (the student still has no certificateNumber, so a retry just
// allocates a fresh one) - a harmless gap, not a duplicate. Nothing else in
// the app reads "which number belongs to which student" from the
// administration side to even notice the gap.
//
// So: a single atomic findOneAndUpdate + $inc-equivalent on the counter is
// sufficient for the one invariant that actually matters (no two students
// ever receive the same number), followed by a plain, non-transactional
// student write. No session, no transaction.
administrationSchema.statics.reserveNextCertificateNumber = async function reserveNextCertificateNumber(studentId) {
  const Administration = this;
  // Deferred require to avoid a require-cycle between the two model files.
  const Student = require("./Student");

  const student = await Student.findById(studentId);
  if (!student) throw new Error("Student not found");
  if (student.certificateNumber !== null && student.certificateNumber !== undefined) {
    return student.certificateNumber;
  }

  // Atomic increment via an aggregation-pipeline update: MongoDB reads and
  // bumps nextCertificateNumber as a single server-side operation, so two
  // concurrent calls can never observe (and return) the same value - the
  // same guarantee the FOR UPDATE lock gave, without a client-side
  // transaction. { new: false } returns the pre-increment document, so
  // `previous.nextCertificateNumber` is exactly the number to assign.
  const previous = await Administration.findOneAndUpdate(
    { _id: SINGLETON_ID },
    [
      {
        $set: {
          nextCertificateNumber: {
            $cond: [
              { $and: [{ $gt: ["$nextCertificateNumber", 0] }, { $eq: [{ $type: "$nextCertificateNumber" }, "int"] }] },
              { $add: ["$nextCertificateNumber", 1] },
              101,
            ],
          },
        },
      },
    ],
    { new: false, upsert: true }
  );
  const assignedNum = previous && Number.isInteger(previous.nextCertificateNumber) && previous.nextCertificateNumber > 0
    ? previous.nextCertificateNumber
    : 100;

  await Student.updateOne({ _id: studentId }, { $set: { certificateNumber: assignedNum } });

  return assignedNum;
};

module.exports = mongoose.model("Administration", administrationSchema);
