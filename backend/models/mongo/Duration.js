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
// NOTE - deliberately NOT unique on `name`, unlike College/Course/Branch:
// grepped services/postgresSchema.js and durations has no `UNIQUE`
// constraint at all (colleges/courses/branches do). managementItemService.js
// checks for a duplicate name in application code before insert for all
// four types, but only three of them ever had that backed by a real DB
// constraint. Following the "unique index wherever Postgres had a unique
// constraint" rule literally means durations doesn't get one here either -
// flagging this in case you'd rather close that gap too while we're here,
// the same way referenceId/admin-email were.
const durationSchema = new Schema(
  {
    _id: { type: Number },
    name: { type: String, required: true },
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

module.exports = mongoose.model("Duration", durationSchema);
