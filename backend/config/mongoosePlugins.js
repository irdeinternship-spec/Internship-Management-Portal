const mongoose = require("mongoose");

const STRICT_ERROR_TAGGED = Symbol("strictErrorTagged");

// Enriches every Mongoose StrictModeError (thrown when strict:"throw" is set
// on a schema and an undeclared field is assigned) with which MODEL it
// happened on - Mongoose's own error only names the field path
// (err.path/err.message), never the model, which matters here because a bare
// field name like "status" or "url" is ambiguous across several schemas in
// this app.
//
// Also logs immediately, at the throw site, unconditionally (even in
// production): most controllers in this codebase catch errors locally and
// return a JSON 500 without ever calling console.error themselves, so a
// StrictModeError that isn't logged here might never reach anywhere that
// logs it at all. This is the one guaranteed choke point every occurrence
// passes through, regardless of how the calling controller handles the
// error afterward.
//
// Scope/limits, found while building this (see the migration-plan audit):
// this only covers document-instance mutation - Model.create()/new Model(),
// doc.set({...}), and assigning a nested object onto an already-declared
// parent path (student.offerLetter = {...}). It does NOT cover a flat
// property assignment to a wholly undeclared top-level path on an
// already-fetched document (doc.newField = value) - Mongoose never defines a
// setter for an undeclared path, so that assignment is a plain JS property
// write with no Mongoose involvement at all, and nothing here (or in
// Mongoose itself) can intercept it. That was the exact mechanism behind the
// original completedDocuments/offerLetter.url bug - now that every field is
// declared, that specific loss is fixed, but a *future* field introduced the
// same way (single assignment, not via .set()/create()/constructor) would
// still be silently dropped. Native query-level updates
// (Model.findOneAndUpdate(filter, {$set: {...}})) are a separate code path
// this plugin doesn't touch either - see models/mongo/Administration.js's
// saveAdministration for that one's own wrap.
function namedStrictErrors(schema) {
  schema.methods.$set = function (...args) {
    try {
      return mongoose.Document.prototype.$set.apply(this, args);
    } catch (err) {
      if (err && err.name === "StrictModeError" && !err[STRICT_ERROR_TAGGED]) {
        err[STRICT_ERROR_TAGGED] = true;
        err.modelName = this.constructor.modelName;
        err.message = `[${this.constructor.modelName}] ${err.message}`;
        console.error(`❌ StrictModeError: ${err.message}`);
      }
      throw err;
    }
  };
}

mongoose.plugin(namedStrictErrors);

module.exports = { namedStrictErrors };
