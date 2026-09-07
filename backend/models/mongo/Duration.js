const mongoose = require("mongoose");

const { Schema } = mongoose;

// Straight 1:1 port of Postgres's `durations (id BIGSERIAL PRIMARY KEY, data
// JSONB NOT NULL)`, where `data` holds `{id, name}` - the app-facing identity
// is that inner `data.id` (a small integer the app assigns itself in
// services/managementItemService.js's create(), same pattern as
// colleges/courses/branches), not the outer Postgres row id. _id is kept as
// that plain Number rather than ObjectId, same reasoning as
// models/mongo/College.js.
//
// UPDATE per sign-off: `unique: true` added on `name` even though Postgres
// itself never enforced it here (unlike College/Course/Branch, which did).
// Resolved in the permissive direction specifically because the database
// starts empty on this migration - an empty collection can't have
// duplicates, so there's zero migration risk, and this closes the same kind
// of race managementItemService.js's app-level dedup check has always had
// (identical in shape to the Student.referenceId / Admin.email fix).
const durationSchema = new Schema(
  {
    _id: { type: Number },
    name: { type: String, required: true, unique: true },
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

module.exports = mongoose.model("Duration", durationSchema);
