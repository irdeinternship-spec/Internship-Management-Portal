const mongoose = require("mongoose");

const { Schema } = mongoose;

// Straight 1:1 port of Postgres's `colleges (id INTEGER PRIMARY KEY, name
// VARCHAR(255) NOT NULL UNIQUE)` - per instruction, NOT merged with
// courses/branches/durations into one referenceData collection. _id is kept
// as the existing plain integer (not ObjectId): the ObjectId decision was
// scoped to the crypto.randomBytes(12) hex-string-keyed documents
// (students/admins/gyapan/activityLogs) - colleges never used that scheme,
// and nothing references a college by id as a foreign key (Student stores
// collegeName as free text), so there's no reference-consistency argument
// pulling this toward ObjectId the way there was for Student.
const collegeSchema = new Schema(
  {
    _id: { type: Number },
    name: { type: String, required: true, unique: true },
  },
  {
    // NOTE: no `_id: false` here - that schema OPTION disables the _id path
    // entirely (for subdocuments), which is not what we want. Declaring
    // `_id: { type: Number }` above as a regular field is what overrides the
    // default auto-generated ObjectId with a plain Number instead, while
    // still keeping a real, present _id path.
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

module.exports = mongoose.model("College", collegeSchema);
