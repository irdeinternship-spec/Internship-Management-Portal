// Re-points list/create/update/remove at the real Course/Branch/Duration
// models instead of raw pool.query calls - one of the "bucket C" files
// found during the step-4 survey.
//
// TODO(mongo-migration follow-up, still valid post-port): collegeService.js
// duplicates this file's list/create/update/remove logic almost
// line-for-line, just hardcoded to the College model instead of taking a
// `type` param the way this file does for courses/branches/durations. Once
// the migration is stable, collapse collegeService.js into this file (add
// `colleges: College` to the `models` map and `Colleges: "College"` to
// `labels` below) - same consolidation idea as before, just updated for the
// model-based structure instead of the old entityFiles/SQL-table structure.
//
// Deliberately NOT porting the DELETE-all + re-INSERT pattern the original
// save() used for every write (courses/branches/durations alike). A
// Postgres transaction made that safe; without one, there's a real window
// where the collection is empty and a concurrent request sees no
// courses/branches/durations at all, and a crash mid-way loses the entire
// list permanently. Checked every caller (managementController.js is a
// thin pass-through of the 4 management routes) - none of them mean
// "replace the whole list," each means exactly one row-level operation.
// Replaced with targeted operations matching that: create = insert one
// document, update = update one document by id, remove = delete one
// document by id. (Contrast with collegeService.js's saveColleges(), where
// whole-list replacement genuinely IS correct - that's only ever called
// during a one-off bulk import nothing reads concurrently.)
//
// Also drops the JSON-file fallback branch entirely (the `fs`/`fileFor`/
// `entityFiles` machinery) - checked, it was already 100% unreachable in
// the original: modelFor's three real types (courses/branches/durations)
// were always handled by the SQL branch above it, and fileFor() returns
// null for anything else, including "colleges" - so `type` values besides
// the three real ones already just threw "Invalid management item type."
// immediately, matching what modelFor() below still does.
//
// Also drops the "if the DB query fails, fall back to hardcoded defaults"
// behavior read() used to have for courses/branches/durations. That's the
// same category of silent-failure-masking as postgresStore.js's old
// readTable() (which the user explicitly had changed to propagate errors
// instead) - flagging this as a deliberate, consistent extension of that
// same decision, not something reinterpreted quietly: a broken DB
// connection should now surface as a real error, not silently render as
// "here are 4 hardcoded course names" with no indication anything is wrong.

const Course = require("../models/mongo/Course");
const Branch = require("../models/mongo/Branch");
const Duration = require("../models/mongo/Duration");

const models = { courses: Course, branches: Branch, durations: Duration };
const labels = { courses: "Course", branches: "Branch", durations: "Duration" };

const normalize = (name) => String(name || "").trim().replace(/\s+/g, " ");
const failure = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const durationParts = (name) => {
  const match = String(name || "").trim().match(/^(\d+(?:\.\d+)?)\s*(day|week|month)s?\b/i);
  const units = { day: 0, week: 1, month: 2 };
  return match ? { unit: units[match[2].toLowerCase()], value: Number(match[1]) } : { unit: Infinity, value: Infinity };
};
const compareDurations = (left, right) => {
  const a = durationParts(left.name);
  const b = durationParts(right.name);
  return a.unit - b.unit || a.value - b.value || left.name.localeCompare(right.name);
};

// Case-insensitive EXACT match via collation, matching the original's
// LOWER(a) === LOWER(b) semantics without needing to escape regex
// metacharacters in a course/branch/duration name.
const CASE_INSENSITIVE = { locale: "en", strength: 2 };

function modelFor(type) {
  const model = models[type];
  if (!model) throw failure("Invalid management item type.", 404);
  return model;
}

// `level` is only present on Course documents, so it's emitted conditionally
// rather than as a fixed key - branches and durations keep the exact
// { id, name } shape they've always returned, which the admin Management
// screen and the public reference endpoint both already depend on.
function toApiShape(doc) {
  const shape = { id: doc._id, name: doc.name };
  if (doc.level) shape.level = doc.level;
  return shape;
}

const COURSE_LEVELS = ["undergraduate", "postgraduate"];

// Courses carry a required `level`; branches and durations have no such field
// and must reject one rather than silently accepting an ignored argument.
function resolveLevel(type, level, { existing } = {}) {
  if (type !== "courses") {
    if (level) throw failure(`A ${labels[type].toLowerCase()} has no level.`, 400);
    return undefined;
  }
  const value = String(level || "").trim().toLowerCase();
  if (!value) {
    // On update, keeping the level the document already has is the sensible
    // default; on create (no existing doc) there is nothing to fall back to.
    if (existing?.level) return existing.level;
    throw failure("Course level is required (undergraduate or postgraduate).", 400);
  }
  if (!COURSE_LEVELS.includes(value)) {
    throw failure("Course level must be either undergraduate or postgraduate.", 400);
  }
  return value;
}

async function list(type) {
  const model = modelFor(type);
  const items = (await model.find({}).lean()).map(toApiShape);
  return items.sort(type === "durations" ? compareDurations : (a, b) => a.name.localeCompare(b.name));
}

async function create(type, name, level) {
  const model = modelFor(type);
  const label = labels[type];
  const value = normalize(name);
  if (!value) throw failure(`${label} name is required.`, 400);
  const resolvedLevel = resolveLevel(type, level);

  const existing = await model.findOne({ name: value }).collation(CASE_INSENSITIVE).lean();
  if (existing) throw failure(`${label} already exists.`, 409);

  // NOTE: computing the next id as (max existing _id) + 1 is racy under
  // concurrency - carried over unchanged from the original version's
  // identical race (it computed the same max+1 over the whole in-memory
  // list before writing). Since _id is the primary key, the failure mode
  // if two requests race is a loud duplicate-key error (E11000) on insert,
  // not silent corruption - accepted as-is rather than fixed in this pass.
  const highest = await model.findOne({}).sort({ _id: -1 }).lean();
  const id = (highest ? highest._id : 0) + 1;

  const created = await model.create(
    resolvedLevel ? { _id: id, name: value, level: resolvedLevel } : { _id: id, name: value }
  );
  return toApiShape(created);
}

async function update(type, id, name, level) {
  const model = modelFor(type);
  const label = labels[type];
  const value = normalize(name);
  const numericId = Number(id);
  if (!value) throw failure(`${label} name is required.`, 400);

  const existing = await model.findById(numericId);
  if (!existing) throw failure(`${label} not found.`, 404);

  const duplicate = await model.findOne({ name: value, _id: { $ne: numericId } }).collation(CASE_INSENSITIVE).lean();
  if (duplicate) throw failure(`${label} already exists.`, 409);

  existing.name = value;
  // Resolved AFTER the document is loaded so an omitted level falls back to
  // the one already stored. Without this, renaming a course through the admin
  // screen would hit Course.level's required validator on .save() and fail.
  const resolvedLevel = resolveLevel(type, level, { existing });
  if (resolvedLevel) existing.level = resolvedLevel;
  await existing.save();
  return toApiShape(existing);
}

async function remove(type, id) {
  const model = modelFor(type);
  const label = labels[type];
  const numericId = Number(id);

  const existing = await model.findById(numericId).lean();
  if (!existing) throw failure(`${label} not found.`, 404);

  await model.deleteOne({ _id: numericId });
  return toApiShape(existing);
}

module.exports = { list, create, update, remove };
