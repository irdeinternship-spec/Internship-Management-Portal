#!/usr/bin/env node
"use strict";

/**
 * scripts/migrateCourses.js
 *
 * Brings an existing database to the canonical course vocabulary:
 *
 *   1. Canonicalises the Ph.D. spelling. Three spellings existed across the
 *      codebase - seed.js had "PhD", web-portal/src/data/courses.js had
 *      "Ph.D." and pages/StudentDetails.jsx had "Ph.D", with a
 *      normalizeCourse() helper papering over the difference. "Ph.D." wins:
 *      it is the formally correct spelling and it lands in generated offer
 *      letters and certificates.
 *
 *   2. Backfills Course.level, which is required as of the same change but
 *      does not exist on documents seeded before it.
 *
 * Idempotent and safe to re-run: every write is conditional on the document
 * not already being in the target state, so a second run reports 0 changes.
 *
 * SAFETY GATE. Renaming the Course document does NOT rewrite student records -
 * students store their course by NAME (student.course is a plain string, not a
 * reference), so any student holding "PhD"/"Ph.D" would be silently orphaned
 * from the reference list by the rename. This script therefore RE-COUNTS those
 * students at run time rather than trusting any number measured earlier, and
 * refuses to change anything if the count is not zero. Migrating student
 * records is a separate decision for a human to make with the list in hand.
 */

require("dotenv").config({ quiet: true });

const { connectDB, disconnectDB } = require("../config/mongo");
const { requireWriteTarget } = require("../config/testEnvironment");
const Course = require("../models/mongo/Course");
const Student = require("../models/mongo/Student");

const CANONICAL_PHD = "Ph.D.";

// Every spelling that has ever been written by this codebase, minus the
// canonical one. Matched case-insensitively and exactly (anchored), so a
// legitimately different course is never caught by accident.
const PHD_VARIANTS = ["PhD", "Ph.D", "Ph D", "PHD"];

const COURSE_LEVELS = {
  "b.tech": "undergraduate",
  "m.tech": "postgraduate",
  "m.sc": "postgraduate",
  "ph.d.": "postgraduate",
};

function exactCaseInsensitive(values) {
  return values.map((value) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
}

async function main() {
  // Announces the target database and refuses production without --yes.
  await connectDB(requireWriteTarget({ scriptName: "migrate:courses" }));

  let changed = 0;

  // --- Gate: are any students holding a non-canonical Ph.D. spelling? -----
  const variantStudents = await Student.find({ course: { $in: exactCaseInsensitive(PHD_VARIANTS) } })
    .select("referenceId name course")
    .lean();

  if (variantStudents.length > 0) {
    console.error("");
    console.error("❌ ABORTED - nothing was changed.");
    console.error(
      `${variantStudents.length} student record(s) hold a non-canonical Ph.D. spelling. ` +
        `Renaming the Course document would orphan them from the reference list.`
    );
    console.error("");
    for (const student of variantStudents) {
      console.error(`   ${student.referenceId || student._id}  ${student.name}  course=${JSON.stringify(student.course)}`);
    }
    console.error("");
    console.error(`Decide how these should be migrated to "${CANONICAL_PHD}", then re-run.`);
    await disconnectDB();
    process.exit(1);
  }

  console.log(`✓ Gate passed: 0 student records hold a non-canonical Ph.D. spelling.`);

  // --- 1. Canonicalise the Ph.D. course name -----------------------------
  const phdCourse = await Course.findOne({ name: { $in: exactCaseInsensitive(PHD_VARIANTS) } });
  if (phdCourse) {
    console.log(`  renaming course ${JSON.stringify(phdCourse.name)} -> ${JSON.stringify(CANONICAL_PHD)}`);
    phdCourse.name = CANONICAL_PHD;
    // level is required, so it must be present before this document can save.
    phdCourse.level = phdCourse.level || COURSE_LEVELS["ph.d."];
    await phdCourse.save();
    changed += 1;
  } else {
    console.log(`  course name already canonical (or no Ph.D. course present).`);
  }

  // --- 2. Backfill Course.level -----------------------------------------
  const courses = await Course.find({});
  for (const course of courses) {
    if (course.level) continue;
    const level = COURSE_LEVELS[course.name.trim().toLowerCase()];
    if (!level) {
      console.warn(
        `  ⚠ ${JSON.stringify(course.name)} has no known level - set it through the admin Courses tab.`
      );
      continue;
    }
    console.log(`  setting level for ${JSON.stringify(course.name)} -> ${level}`);
    course.level = level;
    await course.save();
    changed += 1;
  }

  console.log("");
  console.log(`Done. ${changed} change(s) applied.`);
  console.log("Current courses:");
  for (const course of await Course.find({}).sort({ _id: 1 }).lean()) {
    console.log(`   ${course._id}  ${JSON.stringify(course.name).padEnd(12)} ${course.level || "(no level)"}`);
  }

  await disconnectDB();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  });
