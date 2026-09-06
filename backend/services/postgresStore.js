// Backs the same createPostgresModel() surface every model file
// (models/Admin.js, Student.js, Gyapan.js, ActivityLog.js, College.js) has
// always called, but now returns real Mongoose models (models/mongo/*.js)
// instead of the old in-memory-filter-over-Postgres-JSONB shim. The exported
// surface is unchanged on purpose - createPostgresModel(fileName, defaults,
// methods), same argument order, same return shape - so nothing importing
// this file needs to change (that's step 4's job to verify, not this one's).
//
// See the migration-plan audit for the full list of Postgres-specific
// behavior this used to encode and how each one was resolved; the short
// version of what changed vs. a naive port:
//
//   - readTable() is gone entirely. There's no "fetch the whole table into
//     JS and filter with Array.prototype" step anymore - every method below
//     delegates straight to the real model's own find/findOne/etc, so
//     filtering, sorting, and projection all happen server-side now. This
//     works because the shim's own filter DSL (matches()/matchesCondition())
//     was already written in real MongoDB query syntax ($or, $in, $ne,
//     $exists, $regex, $gte/$lte/$gt/$lt) - it was never actually
//     Postgres-specific, just interpreted by hand instead of by a real
//     query engine.
//   - Errors now propagate instead of being swallowed into an empty result
//     (the old readTable() caught every error and returned []). A dropped
//     Atlas connection now surfaces as a real error instead of "no
//     students".
//   - A malformed id (CastError) still degrades to "not found" (null / [] /
//     0 / false / {deletedCount:0}) rather than reaching the client as a
//     500 - handled in exactly one place here (safeQuery/catchCast below),
//     not scattered across route handlers.
//   - findByIdAndUpdate() deliberately does NOT delegate to the real
//     model's native findOneAndUpdate. Two reasons, found while auditing
//     this file line by line: (1) a plain update object with no $ operators
//     is treated by the old shim as a partial merge (implicit $set), but
//     native MongoDB update semantics without operators means a full
//     document REPLACEMENT - every existing caller passing a plain object
//     would have silently wiped the rest of the document. (2) the old shim
//     calls .save() internally, which means it already fires beforeSave
//     (bcrypt hashing, Student's encryption hooks) on every update - a
//     native findOneAndUpdate would skip pre("save") entirely. So this one
//     method keeps the original find -> merge -> save pattern, just backed
//     by the real model instead of the in-memory one.
//   - The old project()'s "+fieldname" projection syntax (which actually
//     returned the ENTIRE record, not just the named extra field - a real
//     bug) is gone. .select() now delegates to the real model's native
//     select, which already has correct semantics (and Admin's
//     password/secretAnswer/birthPlace/birthDate are now properly
//     select:false at the schema level instead).

const mongoose = require("mongoose");

const modelsByKey = {
  "students.json": require("../models/mongo/Student"),
  "admins.json": require("../models/mongo/Admin"),
  "gyapan.json": require("../models/mongo/Gyapan"),
  "activityLogs.json": require("../models/mongo/ActivityLog"),
  // Neither of these two is actually reachable today - grepped the whole
  // backend: nothing calls createPostgresModel("durations.json") anywhere,
  // and models/College.js (the only thing that calls
  // createPostgresModel("colleges.json")) is never require()'d by anything;
  // both colleges and durations are read/written via raw SQL directly in
  // collegeService.js/managementItemService.js instead. Mapped anyway so
  // this file has no dead-end landmine if that ever changes.
  "durations.json": require("../models/mongo/Duration"),
  "colleges.json": require("../models/mongo/College"),
};

function resolveModel(fileName) {
  const model = modelsByKey[fileName];
  if (!model) throw new Error("Unknown storage filename: " + fileName);
  return model;
}

function isCastError(error) {
  return Boolean(error) && (error instanceof mongoose.Error.CastError || error.name === "CastError");
}

// The ONE place a malformed id degrades to "not found" instead of a 500 -
// see the file header. Wraps a real Mongoose Query so it stays fully
// chainable (.select().sort().lean(), exactly like before) while converting
// a CastError at execution time into the given "nothing matched" value.
function safeQuery(realQuery, emptyValue) {
  const wrapper = {
    select(...args) {
      realQuery = realQuery.select(...args);
      return wrapper;
    },
    sort(...args) {
      realQuery = realQuery.sort(...args);
      return wrapper;
    },
    lean(...args) {
      realQuery = realQuery.lean(...args);
      return wrapper;
    },
    async exec() {
      try {
        return await realQuery.exec();
      } catch (error) {
        if (isCastError(error)) return emptyValue;
        throw error;
      }
    },
    then(resolve, reject) {
      return wrapper.exec().then(resolve, reject);
    },
    catch(reject) {
      return wrapper.exec().catch(reject);
    },
  };
  return wrapper;
}

async function catchCast(promise, emptyValue) {
  try {
    return await promise;
  } catch (error) {
    if (isCastError(error)) return typeof emptyValue === "function" ? emptyValue() : emptyValue;
    throw error;
  }
}

// Ported verbatim from the original shim (unchanged): a plain update object
// merges its top-level keys onto the record; a $set with a dotted path
// creates intermediate objects as needed. See the file header for why this
// stays hand-rolled instead of delegating to a native update.
function applyUpdate(record, update = {}) {
  const next = { ...record, ...JSON.parse(JSON.stringify(update)) };
  delete next.$set;
  Object.entries(update.$set || {}).forEach(([key, value]) => {
    const parts = key.split(".");
    let target = next;
    while (parts.length > 1) {
      const part = parts.shift();
      target[part] ||= {};
      target = target[part];
    }
    target[parts[0]] = value;
  });
  return next;
}

function createPostgresModel(fileName, _defaults, _methods) {
  // _defaults and _methods are intentionally unused: the real Mongoose
  // model (models/mongo/*.js) is already a complete schema with its own
  // defaults and its own instance methods (e.g. Admin's matchPassword,
  // matchSecretAnswer are real schema methods now, not the object that used
  // to be passed in here). Kept as parameters purely so models/Admin.js,
  // Student.js, Gyapan.js, ActivityLog.js keep calling this the same way
  // they always have - step 4 is where each of those gets verified, not
  // this one.
  const RealModel = resolveModel(fileName);

  const Model = function Model(data) {
    return new RealModel(data);
  };

  Model.find = (filter = {}, projection) => safeQuery(RealModel.find(filter, projection), []);
  Model.findOne = (filter = {}) => safeQuery(RealModel.findOne(filter), null);
  Model.findById = (id) => safeQuery(RealModel.findById(id), null);
  Model.create = (data) => RealModel.create(data);
  Model.exists = (filter = {}) => catchCast(RealModel.exists(filter), null);
  Model.countDocuments = (filter = {}) => catchCast(RealModel.countDocuments(filter), 0);

  Model.findByIdAndUpdate = async (id, update) => {
    const document = await catchCast(RealModel.findById(id), null);
    if (!document) return null;
    Object.assign(document, applyUpdate(document.toObject(), update));
    return document.save();
  };

  Model.deleteMany = (filter = {}) => catchCast(RealModel.deleteMany(filter), { deletedCount: 0 });

  return Model;
}

module.exports = { createPostgresModel };
