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
  },
  {
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
  await Administration.findOneAndUpdate(
    { _id: SINGLETON_ID },
    { $set: configuration },
    { upsert: true }
  );
  return configuration;
};

// Ported from administrationService.js:83-121. The Postgres version wraps
// the administration increment and the student's certificateNumber write in
// one transaction with a `SELECT ... FOR UPDATE` row lock, so either both
// happen or neither does. The Mongo-native equivalent atomicity guarantee is
// a multi-document session transaction (Atlas clusters, including the free
// M0 tier, are replica sets and support this) - not a redesign, the same
// guarantee via the Mongo-native mechanism.
administrationSchema.statics.reserveNextCertificateNumber = async function reserveNextCertificateNumber(studentId) {
  const Administration = this;
  // Deferred require to avoid a require-cycle between the two model files.
  const Student = require("./Student");

  const student = await Student.findById(studentId);
  if (!student) throw new Error("Student not found");
  if (student.certificateNumber !== null && student.certificateNumber !== undefined) {
    return student.certificateNumber;
  }

  const session = await mongoose.startSession();
  try {
    let assignedNum;
    await session.withTransaction(async () => {
      const admin = await Administration.findOneAndUpdate(
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
        { new: false, session, upsert: true }
      );
      assignedNum = admin && Number.isInteger(admin.nextCertificateNumber) && admin.nextCertificateNumber > 0
        ? admin.nextCertificateNumber
        : 100;

      await Student.updateOne(
        { _id: studentId },
        { $set: { certificateNumber: assignedNum } },
        { session }
      );
    });
    return assignedNum;
  } finally {
    await session.endSession();
  }
};

module.exports = mongoose.model("Administration", administrationSchema);
