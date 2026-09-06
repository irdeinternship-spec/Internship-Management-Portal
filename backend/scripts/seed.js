require("dotenv").config();
const fsp = require("fs/promises");
const path = require("path");

const { connectDB, disconnectDB } = require("../config/mongo");
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
const COURSE_DEFAULTS = ["B.Tech", "M.Tech", "M.Sc", "PhD"];
const BRANCH_DEFAULTS = [
  "Computer Science and Engineering",
  "Information Technology",
  "Electronics and Communication",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Civil Engineering",
  "Aerospace Engineering",
  "Artificial Intelligence and Data Science",
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

async function upsertReferenceList(Model, label, names) {
  const existing = await Model.find({}).lean();
  const existingByName = new Map(existing.map((doc) => [doc.name.toLocaleLowerCase("en-US"), doc]));
  let nextId = existing.reduce((max, doc) => Math.max(max, doc._id), 0) + 1;
  let inserted = 0;

  for (const name of names) {
    const key = name.toLocaleLowerCase("en-US");
    if (existingByName.has(key)) continue;
    await Model.create({ _id: nextId, name });
    existingByName.set(key, { _id: nextId, name });
    nextId += 1;
    inserted += 1;
  }
  log(label, `${inserted} inserted, ${names.length - inserted} already present.`);
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

async function seedMainAdmin() {
  const mainAdminEmail = process.env.MAIN_ADMIN_EMAIL;
  if (!mainAdminEmail) {
    throw new Error("MAIN_ADMIN_EMAIL is not configured in backend/.env.");
  }

  const existing = await Admin.findOne({ email: mainAdminEmail });
  if (existing) {
    log("admin", `Main Admin (${mainAdminEmail}) already exists.`);
    return;
  }

  const plainPassword = process.env.MAIN_ADMIN_INITIAL_PASSWORD;
  if (!plainPassword) {
    throw new Error("MAIN_ADMIN_INITIAL_PASSWORD is required to create the initial admin.");
  }

  await Admin.create({
    name: process.env.MAIN_ADMIN_NAME || "Main Administrator",
    email: mainAdminEmail,
    password: plainPassword,
    role: "MAIN_ADMIN",
  });
  log("admin", `Main Admin (${mainAdminEmail}) created.`);
}

// --- Administration singleton -------------------------------------------

async function seedAdministration() {
  const configuration = await Administration.getAdministration();
  log("administration", `Singleton ready (${configuration.divisions.length} divisions, nextCertificateNumber=${configuration.nextCertificateNumber}).`);
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

async function main() {
  await connectDB();
  try {
    await seedColleges();
    await seedCoursesBranchesDurations();
    await seedMainAdmin();
    await seedAdministration();
    await seedStudents();
    await seedGyapan();
    await reportCounts();
  } finally {
    await disconnectDB();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Seeding failed:", error.message);
    process.exit(1);
  });
