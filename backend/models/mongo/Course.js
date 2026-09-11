const mongoose = require("mongoose");

const { Schema } = mongoose;

// Straight 1:1 port of Postgres's `courses (id INTEGER PRIMARY KEY, name
// VARCHAR(255) NOT NULL UNIQUE)` - see models/mongo/College.js for the full
// reasoning on keeping _id as a plain Number instead of ObjectId here.
const courseSchema = new Schema(
  {
    _id: { type: Number },
    name: { type: String, required: true, unique: true },
    // Undergraduate vs postgraduate. Added so year options can be driven by
    // course level instead of the single hardcoded list every course shares
    // today - nothing reads it yet, that's the next change. required:true is
    // safe for the four existing documents because Mongoose only validates on
    // save: scripts/migrateCourses.js backfills them, and until then a read
    // never trips it. It does mean a course can no longer be created without
    // one, which is why managementItemService.create/update and the admin
    // Courses tab both take a level as of this change.
    level: {
      type: String,
      enum: ["undergraduate", "postgraduate"],
      required: true,
    },
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

module.exports = mongoose.model("Course", courseSchema);
