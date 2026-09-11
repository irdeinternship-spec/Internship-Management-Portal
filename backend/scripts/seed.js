require("dotenv").config();
const fsp = require("fs/promises");
const path = require("path");

const { connectDB, disconnectDB } = require("../config/mongo");
const { requireWriteTarget } = require("../config/testEnvironment");
const Student = require("../models/mongo/Student");
const Admin = require("../models/mongo/Admin");
const Gyapan = require("../models/mongo/Gyapan");
const ActivityLog = require("../models/mongo/ActivityLog");
const Administration = require("../models/mongo/Administration");
const College = require("../models/mongo/College");
const Course = require("../models/mongo/Course");
const Branch = require("../models/mongo/Branch");
const Duration = require("../models/mongo/Duration");

// Same defaults services/managementItemService.js falls back to when its
// backing store is empty (defaults.courses/branches/durations) - the most
// authoritative "what does the app assume exists" source, since it's what
// the app itself already assumes as a fallback. The frontend's own
// registration-form dropdowns (web-portal/src/data/{courses,branches,internshipDurations}.js)
// are separate, hardcoded, and NOT fetched from these collections at all -
// checked, no other seed data is implied by the frontend for these three.
// Objects, not bare names: Course.level is required as of the reference-data
// change, so a fresh seed has to supply one or Model.create() fails
// validation. "Ph.D." is the canonical spelling - see
// scripts/migrateCourses.js for why, and for the migration that brings an
// already-seeded database to it.
const COURSE_DEFAULTS = [
  { name: "B.Tech", level: "undergraduate" },
  { name: "M.Tech", level: "postgraduate" },
  { name: "M.Sc", level: "postgraduate" },
  { name: "Ph.D.", level: "postgraduate" },
];
// The five branches actually in use. Aerospace Engineering, Civil Engineering
// and Artificial Intelligence and Data Science were RETIRED DELIBERATELY through
// the admin panel and must not be reintroduced - a seed run against a live
// database re-inserted all three once (upsertReferenceList adds anything
// missing by name), which put them back on the public application form.
// Do not re-add them here; add branches through Management -> Branch instead,
// which is the source of truth this list only bootstraps.
const BRANCH_DEFAULTS = [
  "Computer Science and Engineering",
  "Information Technology",
  "Electronics and Communication",
  "Electrical Engineering",
  "Mechanical Engineering",
];
const DURATION_DEFAULTS = ["1 Week", "2 Weeks", "3 Weeks", "4 Weeks", "6 Weeks", "8 Weeks", "10 Weeks", "12 Weeks"];

// Fixed, deterministic ObjectIds so re-running this script upserts the same
// 8 sample students / 1 gyapan instead of creating duplicates each time.
const STUDENT_IDS = {
  pendingUnpaid: "000000000000000000000101",
  pendingPaid: "000000000000000000000102",
  approvedUnpaid: "000000000000000000000103",
  approvedPaidActive: "000000000000000000000104",
  approvedPaidCompleted: "000000000000000000000105",
  rejected: "000000000000000000000106",
  approvedOfferLetterSent: "000000000000000000000107",
  approvedResigned: "000000000000000000000108",
};
const GYAPAN_ID = "000000000000000000000201";

function log(section, message) {
  console.log(`[seed:${section}] ${message}`);
}

// --- Reference data (colleges/courses/branches/durations) -----------------
// Shared upsert-by-name helper local to this script only - does not touch
// collegeService.js or managementItemService.js, per instruction. Each of
// the four collections keeps its own plain-integer _id, assigned
// sequentially from whatever the current max already in the collection is,
// so re-running this script never re-numbers or duplicates existing rows.

// Entries may be a plain name string or a { name, ...extraFields } object -
// courses need to carry `level` through, colleges/branches/durations don't.
async function upsertReferenceList(Model, label, entries) {
  const existing = await Model.find({}).lean();
  const existingByName = new Map(existing.map((doc) => [doc.name.toLocaleLowerCase("en-US"), doc]));
  let nextId = existing.reduce((max, doc) => Math.max(max, doc._id), 0) + 1;
  let inserted = 0;

  for (const entry of entries) {
    const { name, ...extraFields } = typeof entry === "string" ? { name: entry } : entry;
    const key = name.toLocaleLowerCase("en-US");
    if (existingByName.has(key)) continue;
    await Model.create({ _id: nextId, name, ...extraFields });
    existingByName.set(key, { _id: nextId, name });
    nextId += 1;
    inserted += 1;
  }
  log(label, `${inserted} inserted, ${entries.length - inserted} already present.`);
}

async function seedColleges() {
  const csvPath = path.join(__dirname, "..", "data", "UniversityList.csv");
  const raw = await fsp.readFile(csvPath, "utf8");
  const names = raw
    .split(/\r?\n/)
    .slice(1) // header row: "Name of the University"
    .map((line) => line.replace(/^"+|"+$/g, "").replace(/""/g, '"').trim())
    .filter(Boolean);
  // De-duplicate case-insensitively, same as scripts/importColleges.js.
  const uniqueNames = [...new Map(names.map((name) => [name.toLocaleLowerCase("en-US"), name])).values()];
  await upsertReferenceList(College, "colleges", uniqueNames);
}

async function seedCoursesBranchesDurations() {
  await upsertReferenceList(Course, "courses", COURSE_DEFAULTS);
  await upsertReferenceList(Branch, "branches", BRANCH_DEFAULTS);
  await upsertReferenceList(Duration, "durations", DURATION_DEFAULTS);
}

// --- Main admin -------------------------------------------------------
// Byte-identical bcrypt path to seedAdmin.js: Admin.create() runs the same
// pre('save') hashing hook, guarded the same way, so the resulting hash is
// produced by the exact same code login later compares against.

// Credentials are parameters with env defaults, not direct env reads: the
// smoke suite seeds its own throwaway database with an admin password it
// generates per run, so the suite can never again be broken by someone
// changing the live admin's password (which is exactly what happened - every
// admin-authenticated test cascaded to 401 against a stale
// MAIN_ADMIN_INITIAL_PASSWORD). `npm run seed` passes nothing and behaves
// exactly as before.
async function seedMainAdmin({ mainAdminEmail, mainAdminPassword } = {}) {
  const email = mainAdminEmail || process.env.MAIN_ADMIN_EMAIL;
  if (!email) {
    throw new Error("MAIN_ADMIN_EMAIL is not configured in backend/.env.");
  }

  const existing = await Admin.findOne({ email });
  if (existing) {
    log("admin", `Main Admin (${email}) already exists.`);
    return;
  }

  const plainPassword = mainAdminPassword || process.env.MAIN_ADMIN_INITIAL_PASSWORD;
  if (!plainPassword) {
    throw new Error(
      "No main-admin password supplied, and MAIN_ADMIN_INITIAL_PASSWORD is not set. " +
        "It is only needed the very first time an environment is seeded."
    );
  }

  await Admin.create({
    name: process.env.MAIN_ADMIN_NAME || "Main Administrator",
    email,
    password: plainPassword,
    role: "MAIN_ADMIN",
  });
  log("admin", `Main Admin (${email}) created.`);
}

// --- Administration singleton -------------------------------------------

// Divisions exist by default but arrive with NO branch/seat configuration, so a
// freshly-seeded environment cannot allocate a single student to a division -
// validateDivisionCapacity() rejects every attempt with "No seats are
// configured for <branch> in <division>". That never showed up while the smoke
// suite ran against production, where a human had configured seats by hand;
// pointing it at an empty test database surfaced it immediately.
//
// Seeds capacity for the divisions the sample students and the smoke suite
// actually use, leaving the rest unconfigured (which is the honest default -
// an admin still has to configure the others deliberately).
// Per-branch seats, applied to all 8 seeded branches in each division below.
// Kept deliberately modest: these totals are validated against the overall
// paid/unpaid seat limits (controllers/administrationController.js's
// updateSeats refuses a limit lower than what divisions already reserve), so
// generous defaults here would make a perfectly reasonable seat limit
// unsettable. 2 divisions x 8 branches gives 32 paid / 48 unpaid, comfortably
// inside the 100/150 the smoke suite sets and the 250 default total.
const DIVISION_SEAT_DEFAULTS = {
  "Servo System": { paid: 2, unpaid: 3 },
  AI: { paid: 2, unpaid: 3 },
};

async function seedAdministration() {
  const configuration = await Administration.getAdministration();

  let configured = 0;
  for (const [division, seats] of Object.entries(DIVISION_SEAT_DEFAULTS)) {
    if (!configuration.divisions.includes(division)) continue;
    const existing = configuration.divisionConfigurations[division];
    // Idempotent: never overwrite capacity an admin has already set.
    if (existing?.allowedBranches?.length) continue;

    configuration.divisionConfigurations[division] = {
      allowedBranches: [...BRANCH_DEFAULTS],
      branchSeats: Object.fromEntries(BRANCH_DEFAULTS.map((branch) => [branch, { ...seats }])),
      paidSeats: seats.paid * BRANCH_DEFAULTS.length,
      unpaidSeats: seats.unpaid * BRANCH_DEFAULTS.length,
    };
    configured += 1;
  }

  if (configured) await Administration.saveAdministration(configuration);

  log(
    "administration",
    `Singleton ready (${configuration.divisions.length} divisions, ${configured} newly configured with branch seats, nextCertificateNumber=${configuration.nextCertificateNumber}).`
  );
}

// --- Sample students ----------------------------------------------------
// Idempotent via "create if absent, leave untouched if present" (checked by
// fixed _id) rather than upsert-and-overwrite: uses new Student(...).save()
// so the encryption pre-save hook actually runs for the one student that
// carries aadhaarNumber/bankDetails, matching real app behavior - a plain
// findOneAndUpdate would bypass that hook entirely (same as the live app:
// postgresStore.js's own findByIdAndUpdate never calls beforeSave either).

async function createStudentIfMissing(id, data) {
  const existing = await Student.findById(id);
  if (existing) return existing;
  const student = new Student({ _id: id, ...data });
  await student.save();
  return student;
}

async function seedStudents() {
  const base = {
    course: "B.Tech",
    year: "3rd Year",
    fatherName: "Sample Father",
    fatherPhone: "9876500000",
    fatherOccupation: "Service",
    collegeState: "Uttarakhand",
    location: "Dehradun",
    currentAddress: "123 Sample Street, Dehradun",
    permanentAddress: "123 Sample Street, Dehradun",
    collegeAddress: "College Road, Dehradun",
    cgpa: 8.2,
    submittedAt: new Date(),
  };

  await createStudentIfMissing(STUDENT_IDS.pendingUnpaid, {
    ...base,
    referenceId: "SEED001",
    serialNumber: 1,
    name: "Aarav Sharma",
    gender: "Male",
    branch: "Computer Science and Engineering",
    phone: "9876500001",
    email: "aarav.seed@example.com",
    dob: new Date("2003-05-14"),
    collegeName: "IIT Roorkee",
    internshipType: "Unpaid",
    internshipDuration: "6 Weeks",
    status: "Pending",
  });

  await createStudentIfMissing(STUDENT_IDS.pendingPaid, {
    ...base,
    referenceId: "SEED002",
    serialNumber: 2,
    name: "Diya Patel",
    gender: "Female",
    branch: "Electronics and Communication",
    phone: "9876500002",
    email: "diya.seed@example.com",
    dob: new Date("2002-11-02"),
    collegeName: "NIT Surat",
    internshipType: "Paid",
    internshipDuration: "6 Months",
    status: "Pending",
  });

  await createStudentIfMissing(STUDENT_IDS.approvedUnpaid, {
    ...base,
    referenceId: "SEED003",
    serialNumber: 3,
    name: "Rohan Verma",
    gender: "Male",
    branch: "Mechanical Engineering",
    phone: "9876500003",
    email: "rohan.seed@example.com",
    dob: new Date("2003-01-20"),
    collegeName: "DTU Delhi",
    internshipType: "Unpaid",
    internshipDuration: "4 Weeks",
    status: "Approved",
    approvedDate: new Date(),
    completedStatus: "No",
  });

  await createStudentIfMissing(STUDENT_IDS.approvedPaidActive, {
    ...base,
    referenceId: "SEED004",
    serialNumber: 4,
    name: "Ishita Rao",
    gender: "Female",
    branch: "Computer Science and Engineering",
    phone: "9876500004",
    email: "ishita.seed@example.com",
    dob: new Date("2002-08-09"),
    collegeName: "BITS Pilani",
    internshipType: "Paid",
    internshipDuration: "6 Months",
    status: "Approved",
    approvedDate: new Date(),
    completedStatus: "No",
    trainingManagement: {
      studentName: "Ishita Rao",
      courseName: "B.Tech",
      courseYear: "3rd Year",
      branch: "Computer Science and Engineering",
      collegeName: "BITS Pilani",
      collegeLocation: "Pilani",
      trainingDuration: "6 Months",
      collegeAddress: "Pilani, Rajasthan",
      division: "Servo System",
      fromDate: new Date(),
      toDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180),
    },
  });

  await createStudentIfMissing(STUDENT_IDS.approvedPaidCompleted, {
    ...base,
    referenceId: "SEED005",
    serialNumber: 5,
    name: "Kabir Singh",
    gender: "Male",
    branch: "Artificial Intelligence and Data Science",
    phone: "9876500005",
    email: "kabir.seed@example.com",
    dob: new Date("2001-12-30"),
    collegeName: "IIIT Hyderabad",
    internshipType: "Paid",
    internshipDuration: "6 Months",
    status: "Approved",
    approvedDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 200),
    completedStatus: "Yes",
    aadhaarNumber: "123456789012", // exercises the encryption hook when saved
    bankDetails: { bankName: "State Bank", savingAccountNumber: "12345678901", ifsc: "SBIN0001234" },
    certificateNumber: 100,
    trainingManagement: {
      studentName: "Kabir Singh",
      courseName: "B.Tech",
      courseYear: "4th Year",
      branch: "Artificial Intelligence and Data Science",
      collegeName: "IIIT Hyderabad",
      collegeLocation: "Hyderabad",
      trainingDuration: "6 Months",
      collegeAddress: "Gachibowli, Hyderabad",
      division: "AI",
      fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 200),
      toDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20),
    },
  });

  await createStudentIfMissing(STUDENT_IDS.rejected, {
    ...base,
    referenceId: "SEED006",
    serialNumber: 6,
    name: "Meera Nair",
    gender: "Female",
    branch: "Civil Engineering",
    phone: "9876500006",
    email: "meera.seed@example.com",
    dob: new Date("2003-03-11"),
    collegeName: "NIT Calicut",
    internshipType: "Unpaid",
    internshipDuration: "4 Weeks",
    status: "Rejected",
  });

  await createStudentIfMissing(STUDENT_IDS.approvedOfferLetterSent, {
    ...base,
    referenceId: "SEED007",
    serialNumber: 7,
    name: "Vivaan Gupta",
    gender: "Male",
    branch: "Electrical Engineering",
    phone: "9876500007",
    email: "vivaan.seed@example.com",
    dob: new Date("2002-06-25"),
    collegeName: "IIT Delhi",
    internshipType: "Unpaid",
    internshipDuration: "6 Weeks",
    status: "Approved",
    approvedDate: new Date(),
    completedStatus: "No",
    offerLetterStatus: "Sent",
  });

  await createStudentIfMissing(STUDENT_IDS.approvedResigned, {
    ...base,
    referenceId: "SEED008",
    serialNumber: 8,
    name: "Ananya Iyer",
    gender: "Female",
    branch: "Aerospace Engineering",
    phone: "9876500008",
    email: "ananya.seed@example.com",
    dob: new Date("2002-09-17"),
    collegeName: "IIST Trivandrum",
    internshipType: "Unpaid",
    internshipDuration: "6 Weeks",
    status: "Approved",
    approvedDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
    completedStatus: "No",
    resignationStatus: "Yes",
    resignationDate: new Date(),
  });

  log("students", `${Object.keys(STUDENT_IDS).length} sample students ready.`);
}

// --- One sample gyapan, referencing two of the approved students ---------

async function seedGyapan() {
  const existing = await Gyapan.findById(GYAPAN_ID);
  if (existing) {
    log("gyapan", "Sample gyapan already exists.");
    return;
  }

  const students = await Student.find({
    _id: { $in: [STUDENT_IDS.approvedUnpaid, STUDENT_IDS.approvedPaidActive] },
  }).lean();

  const gyapan = new Gyapan({
    _id: GYAPAN_ID,
    letterNumber: "IRDE/GYAPAN/SEED/001",
    issueDate: new Date(),
    generated: false,
    uploadType: "Generated",
    selectedStudents: students.map((s) => s._id),
    studentRows: students.map((s) => ({
      studentId: s._id,
      studentName: s.name,
      course: s.course,
      courseYear: s.year,
      branch: s.branch,
      division: s.trainingManagement?.division || "",
      collegeName: s.collegeName,
      collegeLocation: s.location,
      collegeAddress: s.collegeAddress,
      trainingStartDate: s.trainingManagement?.fromDate,
      trainingEndDate: s.trainingManagement?.toDate,
    })),
  });
  await gyapan.save();
  log("gyapan", "Sample gyapan created, referencing 2 approved students.");
}

// --- Report counts --------------------------------------------------------

async function reportCounts() {
  const [students, admins, gyapans, activityLogs, colleges, courses, branches, durations] = await Promise.all([
    Student.countDocuments(),
    Admin.countDocuments(),
    Gyapan.countDocuments(),
    ActivityLog.countDocuments(),
    College.countDocuments(),
    Course.countDocuments(),
    Branch.countDocuments(),
    Duration.countDocuments(),
  ]);
  const administrationCount = (await Administration.countDocuments());

  console.log("");
  console.log("==================== SEED SUMMARY ====================");
  console.log(`students:        ${students}`);
  console.log(`admins:          ${admins}`);
  console.log(`gyapan:          ${gyapans}`);
  console.log(`activityLogs:    ${activityLogs}`);
  console.log(`administration:  ${administrationCount}`);
  console.log(`colleges:        ${colleges}`);
  console.log(`courses:         ${courses}`);
  console.log(`branches:        ${branches}`);
  console.log(`durations:       ${durations}`);
  console.log("========================================================");
}

// Seeds whatever database is ALREADY connected - it does not connect or
// disconnect. scripts/smoke.js calls this on its own test connection, which it
// keeps open afterwards for its assertPersisted() reads.
async function seedAll({ mainAdminEmail, mainAdminPassword } = {}) {
  await seedColleges();
  await seedCoursesBranchesDurations();
  await seedMainAdmin({ mainAdminEmail, mainAdminPassword });
  await seedAdministration();
  await seedStudents();
  await seedGyapan();
  await reportCounts();
}

async function main() {
  // Announces the target database and refuses production without --yes.
  await connectDB(requireWriteTarget({ scriptName: "seed" }));
  try {
    await seedAll();
  } finally {
    await disconnectDB();
  }
}

// Only self-execute when run directly (`npm run seed`). Requiring this file as
// a module must not kick off a seed as a side effect.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Seeding failed:", error.message);
      process.exit(1);
    });
}

module.exports = { seedAll };
