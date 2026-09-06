const mongoose = require("mongoose");

const { Schema } = mongoose;

// Straight 1:1 port of Postgres's `branches (id INTEGER PRIMARY KEY, name
// VARCHAR(255) NOT NULL UNIQUE)` - see models/mongo/College.js for the full
// reasoning on keeping _id as a plain Number instead of ObjectId here.
const branchSchema = new Schema(
  {
    _id: { type: Number },
    name: { type: String, required: true, unique: true },
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

module.exports = mongoose.model("Branch", branchSchema);
