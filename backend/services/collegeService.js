// Re-points every function in this file at the real College model
// (models/mongo/College.js) instead of raw pool.query calls against the
// `colleges(id, name)` table - one of the "bucket C" files found during the
// step-4 survey.
//
// The numeric college id: checked web-portal/src directly before touching
// this file. Student registration (AcademicSection.jsx/StudentForm.jsx)
// only ever sends/reads the college NAME (a string) - the dropdown is built
// from `college.name`, and the submitted field is `collegeName`. The
// numeric id is used in exactly one place, CollegeManagement.jsx's
// update/delete actions (PATCH/DELETE /api/admin/colleges/:id), as a pure
// URL path parameter identifying which row to act on - never persisted on
// a student record. So College.js's _id staying a plain Number (not an
// ObjectId - a schema-design decision made earlier specifically because
// nothing needs this to be Mongo-native) is correct, and the response
// shape below (`{id, name}`, not `{_id, name}`) has to be built explicitly
// rather than relying on .lean() (which returns the raw `_id`/`__v` shape -
// the schema's toJSON transform only applies to a real hydrated
// document's .toJSON()/JSON.stringify, not to .lean() results) or on
// findById(...).toJSON() (same reason via a different path) - getting this
// wrong would have silently changed the API response shape.
//
// saveColleges() is ported too (not left as the one raw-SQL function in an
// otherwise-migrated file) - it's only ever called by
// scripts/importColleges.js during a fresh bulk import, never by a live
// controller, so deleteMany + insertMany is the CORRECT semantic here
// (unlike managementItemService.js's equivalent pattern, which this same
// migration pass replaces with targeted operations - see that file):
// nothing reads this collection concurrently during an import run, so
// there's no "empty collection window" a real request could ever observe.

const College = require("../models/mongo/College");

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toApiShape(doc) {
  return { id: doc._id, name: doc.name };
}

// Case-insensitive EXACT match, via collation rather than a regex - no
// escaping needed for names containing regex metacharacters, and strength:2
// is Mongo's "case-insensitive, accent-sensitive" comparison level, the
// closest equivalent to the original SQL's LOWER(a) = LOWER(b).
const CASE_INSENSITIVE = { locale: "en", strength: 2 };

async function readColleges() {
  try {
    const docs = await College.find({}).sort({ name: 1 }).lean();
    return docs.map(toApiShape);
  } catch (error) {
    throw createError(`Unable to read college data: ${error.message}`, 500);
  }
}

async function saveColleges(colleges) {
  try {
    await College.deleteMany({});
    if (colleges.length > 0) {
      await College.insertMany(colleges.map((c) => ({ _id: c.id, name: c.name })));
    }
  } catch (error) {
    throw createError(`Unable to save college data: ${error.message}`, 500);
  }
}

async function findCollege(id) {
  // Preserves this function's own existing behavior (swallow every error,
  // including unexpected ones, to null) rather than applying the
  // let-errors-propagate change made to postgresStore.js's readTable() -
  // that change was scoped to that file; this one wasn't asked to change
  // its error handling, so it isn't touched here. (Note: exported but
  // never actually called anywhere in the codebase today - checked.)
  try {
    const doc = await College.findById(Number(id)).lean();
    return doc ? toApiShape(doc) : null;
  } catch (error) {
    return null;
  }
}

async function addCollege(name) {
  const cleanedName = normalizeName(name);
  if (!cleanedName) throw createError("College name is required.", 400);
  try {
    const existing = await College.findOne({ name: cleanedName }).collation(CASE_INSENSITIVE).lean();
    if (existing) throw createError("College already exists.", 409);

    // NOTE: computing the next id as (max existing _id) + 1 is racy under
    // concurrency - carried over unchanged from the Postgres version
    // (SELECT COALESCE(MAX(id),0)+1 had exactly the same race), not a
    // regression introduced by this port. Since _id is the primary key,
    // the failure mode if two requests race is a loud duplicate-key error
    // (E11000) on insert, not silent data corruption - accepting this
    // as-is rather than fixing it in this pass.
    const highest = await College.findOne({}).sort({ _id: -1 }).lean();
    const id = (highest ? highest._id : 0) + 1;

    const created = await College.create({ _id: id, name: cleanedName });
    return toApiShape(created);
  } catch (error) {
    if (error.statusCode) throw error;
    throw createError(`Unable to add college: ${error.message}`, 500);
  }
}

async function updateCollege(id, name) {
  const numericId = Number(id);
  const cleanedName = normalizeName(name);
  if (!cleanedName) throw createError("College name is required.", 400);
  try {
    const existing = await College.findById(numericId);
    if (!existing) throw createError("College not found.", 404);

    const duplicate = await College.findOne({ name: cleanedName, _id: { $ne: numericId } })
      .collation(CASE_INSENSITIVE)
      .lean();
    if (duplicate) throw createError("College already exists.", 409);

    existing.name = cleanedName;
    await existing.save();
    return toApiShape(existing);
  } catch (error) {
    if (error.statusCode) throw error;
    throw createError(`Unable to update college: ${error.message}`, 500);
  }
}

async function deleteCollege(id) {
  const numericId = Number(id);
  try {
    const existing = await College.findById(numericId).lean();
    if (!existing) throw createError("College not found.", 404);

    await College.deleteOne({ _id: numericId });
    return toApiShape(existing);
  } catch (error) {
    if (error.statusCode) throw error;
    throw createError(`Unable to delete college: ${error.message}`, 500);
  }
}

module.exports = { readColleges, saveColleges, findCollege, addCollege, updateCollege, deleteCollege };
