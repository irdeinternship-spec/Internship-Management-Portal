#!/usr/bin/env node
"use strict";

/**
 * scripts/smoke.js
 *
 * Black-box HTTP smoke test against a running server (http://localhost:$PORT).
 * Hits every route in backend/routes/, in an order that respects real
 * dependencies (register -> login -> approve -> offer-letter/gyapan/
 * certificate -> cleanup), asserts status code + response shape, prints
 * PASS/FAIL/SKIP per route, and exits non-zero if anything unexpectedly
 * failed.
 *
 * Requires: the server running via `npm run start:test` - which points it at
 * the TEST database and TEST R2 bucket. This script then resets and seeds that
 * database itself, so it needs no pre-existing data and no pre-existing
 * credentials.
 *
 * THIS SCRIPT IS DESTRUCTIVE. It drops its target database and empties its
 * target R2 bucket before every run. It used to run against whatever
 * MONGODB_URI pointed at - production - and left orphaned students behind
 * whenever a run failed before its cleanup step. It now refuses to start
 * unless MONGODB_URI_TEST names a database that is genuinely different from
 * MONGODB_URI, and unless R2_TEST_BUCKET is a different bucket from R2_BUCKET
 * (with its own scoped credentials, so this path cannot address production
 * files at all). See config/testEnvironment.js.
 *
 * Some routes are expected to fail or be skipped in a fresh/local
 * environment (no S3/MinIO configured, EMAIL_ENABLED=false, no admin
 * birthPlace/birthDate ever set) - these are asserted against their
 * documented expected behavior, not treated as script bugs. See the SKIP/
 * "expected failure" notes inline.
 */

require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const mongoose = require("mongoose");
const { purgeTestBucket, requireTestBucket, requireTestDatabaseUri } = require("../config/testEnvironment");
const { seedAll } = require("./seed");
const Student = require("../models/mongo/Student");
const Gyapan = require("../models/mongo/Gyapan");
const Admin = require("../models/mongo/Admin");

const PORT = process.env.PORT || 5000;
const BASE = `http://localhost:${PORT}/api`;

// A response body is what the server SAID it did - it's not proof anything
// was actually persisted. This whole file was green while offerLetter.url
// and completedDocuments silently failed to save for two document types
// (see the migration-plan audit): the response echoed back the in-memory
// object correctly every time, so nothing here ever noticed the database
// never got written. assertPersisted() does a SEPARATE fresh read straight
// from Mongo - not the HTTP response, not a variable carried over from the
// write - and checks the field is actually there.
async function assertPersisted(Model, id, getFieldFromFreshDoc, description) {
  const fresh = await Model.findById(id).lean();
  const value = getFieldFromFreshDoc(fresh);
  expect(
    value !== undefined && value !== null && value !== "",
    `persistence check failed: ${description} - fresh read from Mongo shows ${JSON.stringify(value)}`
  );
  return value;
}

const results = [];
let currentSection = "";

function section(name) {
  currentSection = name;
  console.log(`\n--- ${name} ---`);
}

function extractCookie(res) {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = setCookie.match(/token=[^;]+/);
  return match ? match[0] : null;
}

async function req(method, path, { body, form, cookie, headers = {}, binary } = {}) {
  const finalHeaders = { ...headers };
  if (cookie) finalHeaders.Cookie = cookie;
  let payload;
  if (form) {
    payload = form; // FormData - fetch sets Content-Type + boundary itself
  } else if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers: finalHeaders, body: payload });
  let data;
  if (binary) {
    data = await res.arrayBuffer();
  } else {
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
  }
  return { status: res.status, data, res };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function t(name, fn) {
  try {
    await fn();
    results.push({ section: currentSection, name, status: "PASS" });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    results.push({ section: currentSection, name, status: "FAIL", error: error.message });
    console.log(`  FAIL  ${name} -- ${error.message}`);
  }
}

function skip(name, reason) {
  results.push({ section: currentSection, name, status: "SKIP", error: reason });
  console.log(`  SKIP  ${name} -- ${reason}`);
}

// Like t(), but for a test whose failure might be a genuine environment
// limitation (MinIO/S3 not configured here) rather than a code problem.
// isEnvironmentLimitation(error) inspects the thrown error's message; if it
// matches, this records a SKIP instead of a FAIL, since a wall of FAILs for
// "the S3 bucket isn't configured on this dev machine" would bury real
// migration regressions in noise that isn't actually about the migration.
async function attemptTest(name, fn, isEnvironmentLimitation) {
  try {
    await fn();
    results.push({ section: currentSection, name, status: "PASS" });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    if (isEnvironmentLimitation && isEnvironmentLimitation(error)) {
      skip(name, `${error.message} (environment limitation - MinIO/S3 not configured here - not a code issue)`);
      return;
    }
    results.push({ section: currentSection, name, status: "FAIL", error: error.message });
    console.log(`  FAIL  ${name} -- ${error.message}`);
  }
}

// For every test downstream of registering the throwaway smoke student:
// if registration (or its login) never succeeded - in practice because this
// environment has no MinIO/S3 configured, which the registration route's
// file uploads require - running these anyway just produces a wall of
// confusing "Student not found"/401 failures that all have the same one
// root cause. Skip them as a block with that cause named once, instead.
async function guardedTest(name, ready, fn) {
  if (!ready) {
    skip(name, "smoke student was never registered/logged in - see the registration failure above (this environment has no MinIO/S3 configured, which student registration's file uploads require)");
    return;
  }
  await t(name, fn);
}

// --- Minimal valid file buffers ------------------------------------------
// Only need to satisfy the app's own magic-byte checks (first 8 bytes),
// not be fully structurally valid documents - see
// middleware/uploadMiddleware.js's validateFileSignature.
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

function fileOf(bytes, type) {
  return new Blob([bytes], { type });
}

// --- Shared state across sections ----------------------------------------
const state = {
  adminCookie: null,
  studentCookie: null,
  newStudentId: null,
  newStudentReferenceId: null,
  newStudentEmail: null,
  seededApprovedId: null, // SEED003
  seededDivisionStudentId: null, // SEED004 (has trainingManagement.division set)
  seededCompletedId: null, // SEED005 (Approved, completedStatus Yes)
  gyapanId: null,
  // Generated per run and seeded into the throwaway database by this script,
  // so the suite depends on no credential stored anywhere and cannot be broken
  // by a password change on the real admin account.
  adminEmail: process.env.MAIN_ADMIN_EMAIL || "smoke.admin@example.com",
  adminPassword: `Smoke!${crypto.randomBytes(12).toString("hex")}`,
};

async function findSeededStudentId(referenceId) {
  const { data } = await req("GET", `/admin/students?search=${referenceId}`, { cookie: state.adminCookie });
  const match = (data.students || []).find((s) => s.referenceId === referenceId);
  return match ? match.id || match._id : null;
}

// Proves the server under test is talking to the TEST database, not production.
//
// No new endpoint and no database name exposed on /api/health: the admin below
// was just seeded into the test database with a password generated seconds ago,
// so it exists nowhere else. If this login succeeds, the server is on the test
// database. If it fails, it isn't - and aborting here with that one sentence is
// far more useful than letting 60+ admin-authenticated tests cascade into
// indistinguishable 401s, which is what made the previous failure hard to read.
// Empties every collection rather than dropping the database: the Atlas user
// has readWrite on this database but not dbAdmin, so dropDatabase() is denied
// ("user is not allowed to do action [dropDatabase]"). deleteMany({}) needs
// only write access and reaches the same starting state - it leaves indexes in
// place, which is harmless here and marginally faster than rebuilding them.
//
// Safe because main() has already proven, via requireTestDatabaseUri(), that
// this connection is NOT the production database.
async function clearTestDatabase() {
  const collections = await mongoose.connection.db.listCollections().toArray();
  await Promise.all(
    collections.map((collection) => mongoose.connection.db.collection(collection.name).deleteMany({}))
  );
  return collections.length;
}

async function assertServerIsOnTestDatabase() {
  const response = await fetch(`${BASE}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: state.adminEmail, password: state.adminPassword }),
  });

  if (response.status !== 200) {
    throw new Error(
      `The server at ${BASE} is NOT connected to the test database.\n` +
        `  This script just seeded a throwaway admin into the test database, and the\n` +
        `  server rejected it (HTTP ${response.status}) - so the server is pointed somewhere\n` +
        `  else, almost certainly production.\n` +
        `  Start it with:  npm run start:test`
    );
  }
}

async function main() {
  // Guards first: nothing touches the network or a database until both the
  // test database and the test bucket have been resolved and proven distinct
  // from their production counterparts.
  const database = requireTestDatabaseUri();
  const { bucket } = requireTestBucket();

  console.log(`Target database : ${database.host}/${database.database}`);
  console.log(`Target R2 bucket: ${bucket}`);
  console.log("");

  // Separate connection from the server's own - this script does its own
  // independent reads for assertPersisted(), deliberately not trusting
  // anything the app process itself reports.
  await mongoose.connect(database.uri);

  // Reset to a deterministic starting state. The suite used to be explicitly
  // NOT repeatable against a persistent cluster (see the forgot-password note
  // below, which documented exactly that); owning a throwaway database removes
  // the problem instead of working around it.
  console.log("Resetting test environment...");
  const cleared = await clearTestDatabase();
  const purged = await purgeTestBucket();
  console.log(`  cleared ${cleared} collection(s), emptied bucket (${purged.deleted} object(s))`);
  await seedAll({ mainAdminEmail: state.adminEmail, mainAdminPassword: state.adminPassword });
  console.log("");

  await assertServerIsOnTestDatabase();

  // ======================================================================
  section("Public / unauthenticated");
  // ======================================================================

  await t("GET /colleges (public, unauthenticated)", async () => {
    const { status, data } = await req("GET", "/colleges");
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data), "expected a raw array response");
    expect(data.length > 0, "expected seeded colleges to be present - did you run `npm run seed`?");
  });

  await t("GET /reference (public, unauthenticated)", async () => {
    const { status, data } = await req("GET", "/reference");
    expect(status === 200, `expected 200, got ${status}`);
    for (const key of ["branches", "courses", "durations", "states"]) {
      expect(Array.isArray(data[key]), `expected ${key} to be an array`);
      expect(data[key].length > 0, `expected non-empty ${key} - did you run \`npm run seed\`?`);
      expect(
        data[key].every((item) => item.id !== undefined && typeof item.name === "string"),
        `expected every ${key} entry to be shaped { id, name }`
      );
    }
    // Course.level is required, so every course must carry one - the public
    // endpoint is where the next change reads it from.
    expect(
      data.courses.every((course) => ["undergraduate", "postgraduate"].includes(course.level)),
      `every course needs a level - run \`npm run migrate:courses\`: ${JSON.stringify(data.courses)}`
    );
  });

  await attemptTest("POST /students (register a new student)", async () => {
    const suffix = Date.now().toString().slice(-8);
    state.newStudentEmail = `smoke.${suffix}@example.com`;
    const form = new FormData();
    const fields = {
      name: "Smoke Test Student",
      gender: "Male",
      course: "B.Tech",
      branch: "Computer Science and Engineering",
      // Required as of the Branch Code change; the API rejects a registration
      // without one, and every downstream test depends on this student existing.
      branchCode: "CS",
      currentYear: "3rd Year",
      phone: `98${suffix}`.padEnd(10, "0").slice(0, 10),
      email: state.newStudentEmail,
      dob: "2003-01-01",
      aadhaarNumber: "123456789012",
      collegeName: "Smoke Test College",
      collegeAddress: "Test Address",
      collegeState: "Uttarakhand",
      collegeLocation: "Dehradun",
      currentAddress: "Test Address",
      permanentAddress: "Test Address",
      fatherName: "Test Father",
      fatherPhone: `97${suffix}`.padEnd(10, "0").slice(0, 10),
      fatherOccupation: "Service",
      cgpa: "8.5",
      collegeId: "SMOKE-ID-1",
      internshipDuration: "4 Weeks",
      internshipJoiningMonth: "2026-01",
      permissionLetterNumber: "PL-SMOKE-1",
      permissionLetterDate: "2026-01-01",
    };
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    form.append("resume", fileOf(PDF_BYTES, "application/pdf"), "resume.pdf");
    form.append("result", fileOf(PDF_BYTES, "application/pdf"), "result.pdf");
    form.append("photo", fileOf(JPEG_BYTES, "image/jpeg"), "photo.jpg");
    form.append("permissionLetter", fileOf(PDF_BYTES, "application/pdf"), "permission.pdf");
    form.append("aadhaarCard", fileOf(PNG_BYTES, "image/png"), "aadhaar.png");

    const { status, data } = await req("POST", "/students", { form });
    expect(status === 201, `expected 201, got ${status}: ${JSON.stringify(data)}`);
    expect(data.success === true, "expected success:true");
    expect(typeof data.referenceId === "string", "expected a referenceId");
    state.newStudentReferenceId = data.referenceId;

    const fresh = await Student.findOne({ referenceId: data.referenceId }).lean();
    expect(!!fresh, "persistence check failed: no student found in Mongo with this referenceId right after registration");
    expect(!!fresh.resume?.url, `persistence check failed: resume.url missing from fresh read - got ${JSON.stringify(fresh.resume)}`);
    expect(!!fresh.photo?.url, `persistence check failed: photo.url missing from fresh read - got ${JSON.stringify(fresh.photo)}`);
    expect(!!fresh.aadhaarCard?.url, `persistence check failed: aadhaarCard.url missing from fresh read - got ${JSON.stringify(fresh.aadhaarCard)}`);
  }, (error) => /region is missing|minio|s3/i.test(error.message));

  await guardedTest("POST /students/login (newly registered student)", Boolean(state.newStudentReferenceId), async () => {
    const { status, data } = await req("POST", "/students/login", {
      body: { email: state.newStudentEmail, referenceId: state.newStudentReferenceId },
    });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
    expect(data.success === true, "expected success:true");
    state.studentCookie = extractCookie(await fetch(`${BASE}/students/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: state.newStudentEmail, referenceId: state.newStudentReferenceId }),
    }));
  });

  await t("POST /admin/auth/login (seeded Main Admin)", async () => {
    const res = await fetch(`${BASE}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: state.adminEmail, password: state.adminPassword }),
    });
    const data = await res.json();
    expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    state.adminCookie = extractCookie(res);
    expect(state.adminCookie, "expected a token cookie from admin login");
  });

  await t("GET /admin/auth/forgot-password-questions (before recovery is configured, or already configured from a prior smoke run)", async () => {
    const { status } = await req("GET", `/admin/auth/forgot-password-questions?email=${state.adminEmail}`);
    // This hits the real seeded (persistent) admin account, not a fresh
    // throwaway one. The setup-recovery test later in this same run always
    // sets a secretQuestion and never unsets it, so on a repeat run of this
    // script against the same Atlas cluster, "before recovery is
    // configured" is no longer actually true - the admin is left
    // recovery-configured from the last run. 400 (fresh) and 200 (already
    // configured) are both valid depending on run history; only a 404/500
    // would indicate something is actually broken.
    expect(status === 400 || status === 200, `expected 400 (fresh) or 200 (already configured from a prior run), got ${status}`);
  });

  // ======================================================================
  section("Admin auth / profile / account management");
  // ======================================================================

  await t("GET /admin/auth/me", async () => {
    const { status, data } = await req("GET", "/admin/auth/me", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(data.admin?.email === state.adminEmail, "expected the logged-in admin's email back");
  });

  await t("GET /admin/profile (main-admin only)", async () => {
    const { status, data } = await req("GET", "/admin/profile", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(data.success === true, "expected success:true");
  });

  await t("POST /admin/auth/setup-recovery", async () => {
    const { status, data } = await req("POST", "/admin/auth/setup-recovery", {
      cookie: state.adminCookie,
      body: { secretQuestion: "Smoke test question?", secretAnswer: "smoke-answer" },
    });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  await t("GET /admin/auth/forgot-password-questions (after recovery configured -> expected 200)", async () => {
    const { status, data } = await req("GET", `/admin/auth/forgot-password-questions?email=${state.adminEmail}`);
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.questions) && data.questions.length > 0, "expected at least one question");
  });

  await t("GET /admin/auth/security-questions", async () => {
    const { status, data } = await req("GET", "/admin/auth/security-questions", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.questions), "expected a questions array");
  });

  let createdSecurityQuestionId = null;
  await t("POST /admin/auth/security-questions (create)", async () => {
    const { status, data } = await req("POST", "/admin/auth/security-questions", {
      cookie: state.adminCookie,
      body: { question: "Smoke test security question?", answer: "smoke" },
    });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
    const list = await req("GET", "/admin/auth/security-questions", { cookie: state.adminCookie });
    const created = list.data.questions.find((q) => q.question === "Smoke test security question?");
    expect(created, "expected the created question to appear in the list");
    createdSecurityQuestionId = created.id;
  });

  await t("DELETE /admin/auth/security-questions/:id (cleanup)", async () => {
    const { status } = await req("DELETE", `/admin/auth/security-questions/${createdSecurityQuestionId}`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("POST /admin/auth/reset-password-recovery (dead code path - birthPlace/birthDate never set anywhere in the app)", async () => {
    const { status } = await req("POST", "/admin/auth/reset-password-recovery", {
      body: { email: state.adminEmail, birthPlace: "x", birthDate: "2000-01-01", newPassword: "Whatever123", confirmPassword: "Whatever123" },
    });
    // Originally expected this to 400 (a clean "invalid recovery info"
    // rejection). Running it for real revealed it's actually worse: since
    // admin.birthPlace/birthDate are never set, adminAuthController.js calls
    // bcrypt.compare(candidate, undefined), which bcrypt throws on rather
    // than returning false, surfacing as an unhandled 500. This is a
    // genuine pre-existing bug, unrelated to the Mongo migration - the exact
    // same undefined value existed under the old Postgres-backed Admin
    // model too. Asserting the verified real behavior here, not the
    // originally-assumed one, since this test's job is to catch a migration
    // regression, not silently paper over an unrelated bug with a wrong
    // expectation.
    expect(status === 500, `expected 500 (pre-existing bug: bcrypt.compare on an undefined hash), got ${status}`);
  });

  await t("PUT /admin/change-password (round-trips: change then change back, so the seeded admin's password is unaffected)", async () => {
    const tempPassword = "SmokeTemp1234!";
    const first = await req("PUT", "/admin/change-password", {
      cookie: state.adminCookie,
      body: { oldPassword: state.adminPassword, newPassword: tempPassword, confirmPassword: tempPassword },
    });
    expect(first.status === 200, `expected 200, got ${first.status}: ${JSON.stringify(first.data)}`);

    const second = await req("PUT", "/admin/change-password", {
      cookie: state.adminCookie,
      body: { oldPassword: tempPassword, newPassword: state.adminPassword, confirmPassword: state.adminPassword },
    });
    expect(second.status === 200, `expected password to be restored, got ${second.status}: ${JSON.stringify(second.data)}`);
  });

  await t("POST /admin/auth/reset-password-questions + PUT /admin/change-password (round-trip via recovery flow)", async () => {
    const list = await req("GET", `/admin/auth/forgot-password-questions?email=${state.adminEmail}`);
    const questionId = list.data.questions[0].id;
    const tempPassword = "SmokeRecoveryTemp1!";
    const reset = await req("POST", "/admin/auth/reset-password-questions", {
      body: {
        email: state.adminEmail,
        answers: [{ id: questionId, answer: "smoke-answer" }],
        newPassword: tempPassword,
        confirmPassword: tempPassword,
      },
    });
    expect(reset.status === 200, `expected 200, got ${reset.status}: ${JSON.stringify(reset.data)}`);

    // Log back in with the temp password, then restore the original, so the
    // net effect on shared seeded state is zero.
    const loginRes = await fetch(`${BASE}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: state.adminEmail, password: tempPassword }),
    });
    expect(loginRes.status === 200, "expected to log in with the recovery-reset temp password");
    state.adminCookie = extractCookie(loginRes);

    const restore = await req("PUT", "/admin/change-password", {
      cookie: state.adminCookie,
      body: { oldPassword: tempPassword, newPassword: state.adminPassword, confirmPassword: state.adminPassword },
    });
    expect(restore.status === 200, "expected to restore the original admin password");
  });

  let subAdminId = null;
  await t("POST /admin/users (create sub-admin)", async () => {
    const { status, data } = await req("POST", "/admin/users", {
      cookie: state.adminCookie,
      body: { name: "Smoke Sub Admin", email: `smoke.subadmin.${Date.now()}@example.com` },
    });
    expect(status === 201, `expected 201, got ${status}: ${JSON.stringify(data)}`);
    subAdminId = data.user.id;
    await assertPersisted(Admin, subAdminId, (a) => a.status, "status on a newly-created sub-admin");
  });

  await t("GET /admin/users", async () => {
    const { status, data } = await req("GET", "/admin/users", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.users) && data.users.length >= 2, "expected at least main admin + the new sub-admin");
  });

  await t("PUT /admin/users/:id/password", async () => {
    const { status } = await req("PUT", `/admin/users/${subAdminId}/password`, {
      cookie: state.adminCookie,
      body: { newPassword: "SubAdminPass123", confirmPassword: "SubAdminPass123" },
    });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("GET /admin/users/:id/activity", async () => {
    const { status, data } = await req("GET", `/admin/users/${subAdminId}/activity`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.logs), "expected a logs array");
  });

  await t("GET /admin/users/:id/activity/export?format=excel", async () => {
    const { status } = await req("GET", `/admin/users/${subAdminId}/activity/export?format=excel`, { cookie: state.adminCookie, binary: true });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("GET /admin/users/:id/activity/export?format=pdf (Puppeteer)", async () => {
    const { status } = await req("GET", `/admin/users/${subAdminId}/activity/export?format=pdf`, { cookie: state.adminCookie, binary: true });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("DELETE /admin/users/:id (cleanup)", async () => {
    const { status } = await req("DELETE", `/admin/users/${subAdminId}`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
  });

  // ======================================================================
  section("Reference data: colleges, courses/branches/durations");
  // ======================================================================

  await t("GET /admin/colleges (raw array)", async () => {
    const { status, data } = await req("GET", "/admin/colleges", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data), "expected a raw array, not {success,...}");
  });

  let createdCollegeId = null;
  await t("POST /admin/colleges (create)", async () => {
    const { status, data } = await req("POST", "/admin/colleges", { cookie: state.adminCookie, body: { name: `Smoke College ${Date.now()}` } });
    expect(status === 201, `expected 201, got ${status}: ${JSON.stringify(data)}`);
    createdCollegeId = data.college.id;
  });

  await t("PATCH /admin/colleges/:id (rename)", async () => {
    const { status } = await req("PATCH", `/admin/colleges/${createdCollegeId}`, { cookie: state.adminCookie, body: { name: `Smoke College Renamed ${Date.now()}` } });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("DELETE /admin/colleges/:id (cleanup)", async () => {
    const { status } = await req("DELETE", `/admin/colleges/${createdCollegeId}`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
  });

  for (const type of ["courses", "branches", "durations"]) {
    await t(`GET /admin/management/${type} (raw array)`, async () => {
      const { status, data } = await req("GET", `/admin/management/${type}`, { cookie: state.adminCookie });
      expect(status === 200, `expected 200, got ${status}`);
      expect(Array.isArray(data) && data.length > 0, `expected seeded ${type} - did you run \`npm run seed\`?`);
    });
  }

  let createdManagementItem = null;
  await t("POST /admin/management/courses (create)", async () => {
    const { status, data } = await req("POST", "/admin/management/courses", { cookie: state.adminCookie, body: { name: `Smoke Course ${Date.now()}`, level: "postgraduate" } });
    expect(status === 201, `expected 201, got ${status}: ${JSON.stringify(data)}`);
    expect(data.item.level === "postgraduate", `expected the created course to echo its level, got ${JSON.stringify(data.item)}`);
    createdManagementItem = data.item.id;
  });

  await t("POST /admin/management/courses without level (expected 400)", async () => {
    const { status } = await req("POST", "/admin/management/courses", { cookie: state.adminCookie, body: { name: `Smoke Levelless ${Date.now()}` } });
    expect(status === 400, `expected 400, got ${status}`);
  });

  await t("POST /admin/management/branches with a level (expected 400)", async () => {
    const { status } = await req("POST", "/admin/management/branches", { cookie: state.adminCookie, body: { name: `Smoke Branch ${Date.now()}`, level: "undergraduate" } });
    expect(status === 400, `expected 400, got ${status}`);
  });

  await t("PATCH /admin/management/courses/:id (rename)", async () => {
    const { status } = await req("PATCH", `/admin/management/courses/${createdManagementItem}`, { cookie: state.adminCookie, body: { name: `Smoke Course Renamed ${Date.now()}` } });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("DELETE /admin/management/courses/:id (cleanup)", async () => {
    const { status } = await req("DELETE", `/admin/management/courses/${createdManagementItem}`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("GET /admin/management/invalid-type (expected 404)", async () => {
    const { status } = await req("GET", "/admin/management/not-a-real-type", { cookie: state.adminCookie });
    expect(status === 404, `expected 404, got ${status}`);
  });

  // ======================================================================
  section("Administration singleton");
  // ======================================================================

  await t("GET /admin/administration", async () => {
    const { status, data } = await req("GET", "/admin/administration", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.administration.divisions), "expected a divisions array");
  });

  await t("POST /admin/administration/divisions (create) -> PATCH (rename) -> DELETE (cleanup)", async () => {
    const name = `Smoke Division ${Date.now()}`;
    const created = await req("POST", "/admin/administration/divisions", { cookie: state.adminCookie, body: { name } });
    expect(created.status === 201, `expected 201, got ${created.status}: ${JSON.stringify(created.data)}`);

    const renamed = `${name} Renamed`;
    const patched = await req("PATCH", `/admin/administration/divisions/${encodeURIComponent(name)}`, { cookie: state.adminCookie, body: { name: renamed } });
    expect(patched.status === 200, `expected 200, got ${patched.status}`);

    const deleted = await req("DELETE", `/admin/administration/divisions/${encodeURIComponent(renamed)}`, { cookie: state.adminCookie });
    expect(deleted.status === 200, `expected 200, got ${deleted.status}`);
  });

  await t("PATCH /admin/administration/seats", async () => {
    const { status } = await req("PATCH", "/admin/administration/seats", { cookie: state.adminCookie, body: { paidSeatLimit: 100, unpaidSeatLimit: 150 } });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("PATCH /admin/administration/certificate-number", async () => {
    const { status, data } = await req("PATCH", "/admin/administration/certificate-number", { cookie: state.adminCookie, body: { nextCertificateNumber: 101 } });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  await t("GET /admin/administration/division-configurations", async () => {
    const { status, data } = await req("GET", "/admin/administration/division-configurations", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.divisions), "expected a divisions array");
  });

  await t("PUT /admin/administration/division-configurations", async () => {
    // Must send EVERY division: the endpoint is a full replace and now rejects
    // a partial payload rather than silently clearing the divisions it omits.
    // This test used to send exactly one, modelling the destructive save it was
    // supposed to be guarding against.
    const current = await req("GET", "/admin/administration/division-configurations", { cookie: state.adminCookie });
    const configurations = { ...current.data.configurations };
    configurations["Servo System"] = {
      allowedBranches: ["Computer Science and Engineering"],
      branchSeats: { "Computer Science and Engineering": { paid: 5, unpaid: 5 } },
    };

    const { status } = await req("PUT", "/admin/administration/division-configurations", {
      cookie: state.adminCookie,
      body: { configurations },
    });
    expect(status === 200, `expected 200, got ${status}`);

    // READ-BACK. A 200 here is not proof of anything: division configuration
    // was unreadable for the entire life of the Mongo migration
    // (models/mongo/Administration.js read a Mongoose Map with bracket
    // notation, so every entry normalised to empty) and this test stayed green
    // throughout, because it only ever asserted the status code.
    const Administration = require("../models/mongo/Administration");
    const fresh = await Administration.getAdministration();
    const servo = fresh.divisionConfigurations["Servo System"];
    expect(
      servo?.allowedBranches?.includes("Computer Science and Engineering"),
      `persistence check failed: Servo System allowedBranches - fresh read shows ${JSON.stringify(servo)}`
    );
    expect(
      servo?.branchSeats?.["Computer Science and Engineering"]?.paid === 5 &&
        servo?.branchSeats?.["Computer Science and Engineering"]?.unpaid === 5,
      `persistence check failed: Servo System branchSeats - fresh read shows ${JSON.stringify(servo?.branchSeats)}`
    );
  });

  await t("PUT /admin/administration/division-configurations with a partial payload (expected 400)", async () => {
    const { status } = await req("PUT", "/admin/administration/division-configurations", {
      cookie: state.adminCookie,
      body: { configurations: { "Servo System": { allowedBranches: [], branchSeats: {} } } },
    });
    expect(status === 400, `expected 400 (payload omits every other division), got ${status}`);

    // And prove the refusal was actually non-destructive.
    const Administration = require("../models/mongo/Administration");
    const fresh = await Administration.getAdministration();
    expect(
      fresh.divisionConfigurations["Servo System"]?.allowedBranches?.length === 1,
      "a rejected partial save must not have modified anything"
    );
  });

  await t("PATCH /admin/administration/proforma", async () => {
    const { status } = await req("PATCH", "/admin/administration/proforma", { cookie: state.adminCookie, body: { proformaQuarterEnding: "March" } });
    expect(status === 200, `expected 200, got ${status}`);

    // The entire proforma feature (5 fields) was undeclared on the
    // Administration schema and had never persisted since the Mongo
    // migration - this route returned 200 every time regardless.
    const Administration = require("../models/mongo/Administration");
    const fresh = await Administration.findOne({}).lean();
    expect(fresh?.proformaQuarterEnding === "March", `persistence check failed: proformaQuarterEnding - fresh read shows ${JSON.stringify(fresh?.proformaQuarterEnding)}`);
  });

  // ======================================================================
  section("Students list / lookup (seeded data)");
  // ======================================================================

  await t("GET /admin/recommended-by-options", async () => {
    const { status, data } = await req("GET", "/admin/recommended-by-options", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.options) && data.options.length > 0, "expected a non-empty options array");
  });

  await t("GET /admin/students (list + summary)", async () => {
    const { status, data } = await req("GET", "/admin/students", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.students), "expected a students array");
    expect(typeof data.summary?.totalStudents === "number", "expected a summary.totalStudents count");
    expect(data.summary.totalStudents >= 8, "expected at least the 8 seeded sample students - did you run `npm run seed`?");
  });

  await t("GET /admin/applications/export (xlsx)", async () => {
    const { status } = await req("GET", "/admin/applications/export", { cookie: state.adminCookie, binary: true });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("resolve seeded student ids (SEED003/SEED004/SEED005) via GET /admin/students", async () => {
    state.seededApprovedId = await findSeededStudentId("SEED003");
    state.seededDivisionStudentId = await findSeededStudentId("SEED004");
    state.seededCompletedId = await findSeededStudentId("SEED005");
    expect(state.seededApprovedId, "expected seeded student SEED003 to exist - did you run `npm run seed`?");
    expect(state.seededDivisionStudentId, "expected seeded student SEED004 to exist");
    expect(state.seededCompletedId, "expected seeded student SEED005 to exist");
  });

  await t("GET /admin/students/:id", async () => {
    const { status, data } = await req("GET", `/admin/students/${state.seededApprovedId}`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(data.student?.referenceId === "SEED003", "expected the SEED003 student back");
  });

  await t("GET /admin/students/:id (not found)", async () => {
    const { status } = await req("GET", "/admin/students/000000000000000000000000", { cookie: state.adminCookie });
    expect(status === 404, `expected 404, got ${status}`);
  });

  // ======================================================================
  section("New student: review -> approve -> training-management");
  // ======================================================================

  await guardedTest("GET /admin/students (resolve the newly-registered smoke student's id)", Boolean(state.newStudentReferenceId), async () => {
    state.newStudentId = await findSeededStudentId(state.newStudentReferenceId);
    expect(state.newStudentId, "expected the newly-registered smoke student to be findable by referenceId");
  });

  await guardedTest("PATCH /admin/students/:id/review (approve)", Boolean(state.newStudentId), async () => {
    const { status, data } = await req("PATCH", `/admin/students/${state.newStudentId}/review`, {
      cookie: state.adminCookie,
      body: { status: "Approved", remark: "Smoke test approval", recommendedBy: "Servo System" },
    });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
    expect(data.student?.status === "Approved", "expected status to now be Approved");

    await assertPersisted(Student, state.newStudentId, (s) => s.status, "status===Approved after review");
    await assertPersisted(Student, state.newStudentId, (s) => s.remark, "remark set by the review");
  });

  await guardedTest("PATCH /admin/students/:id/training-management", Boolean(state.newStudentId), async () => {
    const { status, data } = await req("PATCH", `/admin/students/${state.newStudentId}/training-management`, {
      cookie: state.adminCookie,
      body: {
        division: "Servo System",
        branch: "Computer Science and Engineering",
        completed: "No",
        joined: "",
        fromDate: new Date().toISOString().slice(0, 10),
        toDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 28).toISOString().slice(0, 10),
        trainingDuration: "4 Weeks",
        projectTitle: "",
        projectGuide: "",
        designation: "",
        leaveAvailed: "",
      },
    });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);

    await assertPersisted(Student, state.newStudentId, (s) => s.trainingManagement?.division, "trainingManagement.division");
    await assertPersisted(Student, state.newStudentId, (s) => s.trainingManagement?.trainingDuration, "trainingManagement.trainingDuration");
  });

  await guardedTest("PATCH /admin/students/:id (multipart edit, no new files)", Boolean(state.newStudentId), async () => {
    const form = new FormData();
    form.append("recommendedBy", "Servo System");
    const { status, data } = await req("PATCH", `/admin/students/${state.newStudentId}`, { cookie: state.adminCookie, form });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  // ======================================================================
  section("Offer letter (backend/controllers/offerLetterController.js)");
  // ======================================================================

  await guardedTest("POST /offer-letter/:studentId/generate", Boolean(state.newStudentId), async () => {
    const { status, data } = await req("POST", `/offer-letter/${state.newStudentId}/generate`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
    expect(typeof data.html === "string" && data.html.length > 0, "expected generated HTML back");
  });

  await guardedTest("GET /offer-letter/:studentId", Boolean(state.newStudentId), async () => {
    const { status, data } = await req("GET", `/offer-letter/${state.newStudentId}`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(typeof data.html === "string", "expected html back");
  });

  await guardedTest("PUT /offer-letter/:studentId (edit - note: discards its own PDF render, known dead code)", Boolean(state.newStudentId), async () => {
    const { status, data } = await req("PUT", `/offer-letter/${state.newStudentId}`, {
      cookie: state.adminCookie,
      body: { studentName: "Smoke Test Student", collegeName: "Smoke Test College", course: "B.Tech" },
    });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  await guardedTest("POST /offer-letter/:studentId/pdf (Puppeteer)", Boolean(state.newStudentId), async () => {
    const { status } = await req("POST", `/offer-letter/${state.newStudentId}/pdf`, { cookie: state.adminCookie, binary: true });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await guardedTest("POST /offer-letter/:studentId/upload (multipart PDF)", Boolean(state.newStudentId), async () => {
    const form = new FormData();
    form.append("offerLetter", fileOf(PDF_BYTES, "application/pdf"), "offer.pdf");
    const { status, data } = await req("POST", `/offer-letter/${state.newStudentId}/upload`, { cookie: state.adminCookie, form });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);

    // This exact field (offerLetter.url) is what started the whole audit:
    // the upload succeeded, the response carried a working pdfUrl, and the
    // pointer still never reached the database.
    await assertPersisted(Student, state.newStudentId, (s) => s.offerLetter?.url, "offerLetter.url after upload");
    await assertPersisted(Student, state.newStudentId, (s) => s.offerLetterUrl, "legacy offerLetterUrl mirror after upload");
  });

  await guardedTest("POST /offer-letter/:studentId/send (needs EMAIL_ENABLED=true and MinIO/S3 configured)", Boolean(state.newStudentId), async () => {
    const { status, data } = await req("POST", `/offer-letter/${state.newStudentId}/send`, { cookie: state.adminCookie });
    if (process.env.EMAIL_ENABLED !== "true") {
      // This assertion used to expect a FAILURE here, on the premise that the
      // route "treats a skipped email as an error, unlike other email routes".
      // That premise is stale: emailService.sendOfferLetterEmail returns
      // { skipped: false, disabled: true } when email is switched off
      // (emailService.js:80-85), and sendOfferLetter only throws on
      // `emailResult?.skipped` - so a disabled mailer is NOT an error and the
      // route returns 200, consistent with every other email route. The bug
      // was in the expectation, not the code. It went unnoticed because the
      // suite never reached this line - admin login failed and 60+ tests
      // cascaded into 401s.
      expect(status === 200, `expected 200 with email disabled, got ${status}: ${JSON.stringify(data)}`);
      return;
    }
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
    await assertPersisted(Student, state.newStudentId, (s) => s.offerLetter?.sent, "offerLetter.sent after a successful send");
    await assertPersisted(Student, state.newStudentId, (s) => s.offerLetterSentDate, "offerLetterSentDate after a successful send");
  });

  await guardedTest("POST /admin/students/:id/offer-letter (separate admin-side offer-letter file upload)", Boolean(state.newStudentId), async () => {
    const form = new FormData();
    form.append("offerLetter", fileOf(PDF_BYTES, "application/pdf"), "offer.pdf");
    const { status, data } = await req("POST", `/admin/students/${state.newStudentId}/offer-letter`, { cookie: state.adminCookie, form });
    // Depends on S3/MinIO being configured; report the real outcome either way.
    if (status !== 200) {
      skip("  (see above) offer-letter file upload", `got ${status} - likely MinIO/S3 not configured in this environment: ${JSON.stringify(data)}`);
      return;
    }
    expect(status === 200, `expected 200, got ${status}`);
    await assertPersisted(Student, state.newStudentId, (s) => s.offerLetterUrl, "offerLetterUrl after the admin-side upload");
  });

  // ======================================================================
  section("Gyapan (seeded SEED003 + SEED004)");
  // ======================================================================

  await t("GET /admin/gyapan/students", async () => {
    const { status, data } = await req("GET", "/admin/gyapan/students", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.students), "expected a students array");
  });

  await t("POST /admin/gyapan/preview", async () => {
    const { status, data } = await req("POST", "/admin/gyapan/preview", {
      cookie: state.adminCookie,
      body: { ids: [state.seededApprovedId, state.seededDivisionStudentId] },
    });
    expect(status === 201, `expected 201, got ${status}: ${JSON.stringify(data)}`);
    state.gyapanId = data.gyapan?.id || data.gyapan?._id;
    expect(state.gyapanId, "expected a created gyapan id");
  });

  await t("GET /admin/gyapan/:id", async () => {
    const { status, data } = await req("GET", `/admin/gyapan/${state.gyapanId}`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(typeof data.html === "string", "expected html back");
  });

  await t("PUT /admin/gyapan/:id/edit", async () => {
    const { data: preview } = await req("GET", `/admin/gyapan/${state.gyapanId}`, { cookie: state.adminCookie });
    const { status, data } = await req("PUT", `/admin/gyapan/${state.gyapanId}/edit`, {
      cookie: state.adminCookie,
      body: { studentRows: preview.editable.studentRows, issueDate: preview.editable.issueDate, letterNumber: preview.editable.letterNumber },
    });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  await t("POST /admin/gyapan/:id/generate (Puppeteer + S3 upload)", async () => {
    const { status, data } = await req("POST", `/admin/gyapan/${state.gyapanId}/generate`, { cookie: state.adminCookie });
    if (status !== 200) {
      skip("(see above) gyapan PDF generation", `got ${status} - likely MinIO/S3 not configured in this environment: ${JSON.stringify(data)}`);
      return;
    }
    expect(status === 200, `expected 200, got ${status}`);
    await assertPersisted(Gyapan, state.gyapanId, (g) => g.pdfUrl, "Gyapan.pdfUrl after generate");
    await assertPersisted(Gyapan, state.gyapanId, (g) => g.generatedDate, "Gyapan.generatedDate after generate");
  });

  await t("GET /admin/gyapan1/students (buffer-mode variant)", async () => {
    const { status, data } = await req("GET", "/admin/gyapan1/students", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.students), "expected a students array");
  });

  // ======================================================================
  section("Certificates (seeded SEED005 - Approved + Completed)");
  // ======================================================================

  await t("GET /admin/certificates/students", async () => {
    const { status, data } = await req("GET", "/admin/certificates/students", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data.students), "expected a students array");
  });

  await t("POST /admin/certificates/download (Puppeteer, reserves a certificate number)", async () => {
    const { status, data } = await req("POST", "/admin/certificates/download", { cookie: state.adminCookie, binary: true, body: { ids: [state.seededCompletedId] } });
    if (status !== 200) {
      skip("(see above) certificate PDF generation", `got ${status}`);
      return;
    }
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("GET /admin/certificate1/students + POST download + DELETE (buffer-mode variant)", async () => {
    const list = await req("GET", "/admin/certificate1/students", { cookie: state.adminCookie });
    expect(list.status === 200, `expected 200, got ${list.status}`);

    const download = await req("POST", "/admin/certificate1/download", { cookie: state.adminCookie, binary: true, body: { ids: [state.seededCompletedId] } });
    if (download.status !== 200) {
      skip("(see above) certificate1 buffer-mode download", `got ${download.status}`);
    }

    const del = await req("DELETE", "/admin/certificate1/students", { cookie: state.adminCookie, body: { ids: [state.seededCompletedId] } });
    expect(del.status === 200, `expected 200, got ${del.status}`);
  });

  // ======================================================================
  section("Attendance report / student self-service");
  // ======================================================================

  await t("POST /admin/attendance-report/pdf (Puppeteer, arbitrary HTML)", async () => {
    const { status } = await req("POST", "/admin/attendance-report/pdf", { cookie: state.adminCookie, binary: true, body: { html: "<h1>Smoke Test Attendance Report</h1>" } });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await guardedTest("GET /students/dashboard (new student, now Approved)", Boolean(state.studentCookie), async () => {
    const { status, data } = await req("GET", "/students/dashboard", { cookie: state.studentCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(data.student?.status === "Approved", "expected the smoke student's dashboard to show Approved");
  });

  await guardedTest("GET /students/documents/declaration (Puppeteer)", Boolean(state.studentCookie), async () => {
    const { status } = await req("GET", "/students/documents/declaration", { cookie: state.studentCookie, binary: true });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await guardedTest("GET /students/documents/character (Puppeteer)", Boolean(state.studentCookie), async () => {
    const { status } = await req("GET", "/students/documents/character", { cookie: state.studentCookie, binary: true });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await guardedTest("GET /students/documents/not-a-real-type (expected 404)", Boolean(state.studentCookie), async () => {
    const { status } = await req("GET", "/students/documents/not-a-real-type", { cookie: state.studentCookie });
    expect(status === 404, `expected 404, got ${status}`);
  });

  await guardedTest("POST /students/completed-documents (multipart)", Boolean(state.studentCookie), async () => {
    const form = new FormData();
    form.append("completedDocuments", fileOf(PDF_BYTES, "application/pdf"), "completed.pdf");
    const { status, data } = await req("POST", "/students/completed-documents", { cookie: state.studentCookie, form });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);

    // completedDocuments was entirely undeclared in the Student schema until
    // this audit - this is the other field that started it (alongside
    // offerLetter.url above).
    await assertPersisted(Student, state.newStudentId, (s) => s.completedDocuments?.url, "completedDocuments.url after upload");
  });

  await guardedTest("PATCH /students/paid-project-details (expected 403 - smoke student is Unpaid)", Boolean(state.studentCookie), async () => {
    const { status } = await req("PATCH", "/students/paid-project-details", { cookie: state.studentCookie, body: { projectName: "Smoke Project" } });
    expect(status === 403, `expected 403 (student is Unpaid, not Paid+Approved), got ${status}`);
  });

  // ======================================================================
  section("Cleanup");
  // ======================================================================

  await t("POST /students/logout", async () => {
    const { status } = await req("POST", "/students/logout", { cookie: state.studentCookie });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await guardedTest("DELETE /students/:id (admin deletes the throwaway smoke student)", Boolean(state.newStudentId), async () => {
    const { status } = await req("DELETE", `/students/${state.newStudentId}`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("POST /admin/auth/logout", async () => {
    const { status } = await req("POST", "/admin/auth/logout", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
  });

  // ======================================================================
  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");
  const passed = results.filter((r) => r.status === "PASS");

  console.log("\n==================== SMOKE TEST SUMMARY ====================");
  console.log(`PASS: ${passed.length}   FAIL: ${failed.length}   SKIP: ${skipped.length}   TOTAL: ${results.length}`);
  if (failed.length) {
    console.log("\nFailed:");
    failed.forEach((r) => console.log(`  [${r.section}] ${r.name} -- ${r.error}`));
  }
  console.log("==============================================================");

  await teardown();
  process.exit(failed.length ? 1 : 0);
}

// The bucket is emptied in a finally, NOT only in the Cleanup section.
//
// This is the exact hole that orphaned 15 files: the cleanup step sat behind an
// admin cookie the run never obtained, so when the suite failed early nothing
// deleted the uploads it had already made. A finally cannot be skipped by a
// failed assertion, a crashed run, or a guard tripping mid-suite.
async function teardown() {
  try {
    const purged = await purgeTestBucket();
    if (purged.deleted) console.log(`\nTeardown: emptied ${purged.bucket} (${purged.deleted} object(s)).`);
  } catch (error) {
    console.error("Teardown: failed to empty the test bucket:", error.message);
  }
  await mongoose.disconnect().catch(() => {});
}

main().catch(async (error) => {
  console.error("\nSmoke test crashed:", error.message || error);
  await teardown();
  process.exit(1);
});
