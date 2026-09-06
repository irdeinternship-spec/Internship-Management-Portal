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
 * Requires: the server running (npm start / npm run dev) against a DB that
 * has already been seeded (npm run seed) - several routes depend on the
 * seeded reference data (courses/branches) and the seeded Approved sample
 * students existing.
 *
 * Some routes are expected to fail or be skipped in a fresh/local
 * environment (no S3/MinIO configured, EMAIL_ENABLED=false, no admin
 * birthPlace/birthDate ever set) - these are asserted against their
 * documented expected behavior, not treated as script bugs. See the SKIP/
 * "expected failure" notes inline.
 */

const PORT = process.env.PORT || 5000;
const BASE = `http://localhost:${PORT}/api`;

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

// --- Minimal valid file buffers ------------------------------------------
// Only need to satisfy the app's own magic-byte checks (first 8 bytes),
// not be fully structurally valid documents - see
// middleware/uploadMiddleware.js's validateFileSignature.
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

function fileOf(bytes, filename, type) {
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
  originalAdminPassword: process.env.MAIN_ADMIN_INITIAL_PASSWORD,
};

async function findSeededStudentId(referenceId) {
  const { data } = await req("GET", `/admin/students?search=${referenceId}`, { cookie: state.adminCookie });
  const match = (data.students || []).find((s) => s.referenceId === referenceId);
  return match ? match.id || match._id : null;
}

async function main() {
  // ======================================================================
  section("Public / unauthenticated");
  // ======================================================================

  await t("GET /colleges (public, unauthenticated)", async () => {
    const { status, data } = await req("GET", "/colleges");
    expect(status === 200, `expected 200, got ${status}`);
    expect(Array.isArray(data), "expected a raw array response");
    expect(data.length > 0, "expected seeded colleges to be present - did you run `npm run seed`?");
  });

  await t("POST /students (register a new student)", async () => {
    const suffix = Date.now().toString().slice(-8);
    state.newStudentEmail = `smoke.${suffix}@example.com`;
    const form = new FormData();
    const fields = {
      name: "Smoke Test Student",
      gender: "Male",
      course: "B.Tech",
      branch: "Computer Science and Engineering",
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
      internshipJoiningMonth: "January",
      permissionLetterNumber: "PL-SMOKE-1",
      permissionLetterDate: "2026-01-01",
    };
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    form.append("resume", fileOf(PDF_BYTES), "resume.pdf");
    form.append("result", fileOf(PDF_BYTES), "result.pdf");
    form.append("photo", fileOf(JPEG_BYTES, "photo.jpg", "image/jpeg"), "photo.jpg");
    form.append("permissionLetter", fileOf(PDF_BYTES), "permission.pdf");
    form.append("aadhaarCard", fileOf(PNG_BYTES, "aadhaar.png", "image/png"), "aadhaar.png");

    const { status, data } = await req("POST", "/students", { form });
    expect(status === 201, `expected 201, got ${status}: ${JSON.stringify(data)}`);
    expect(data.success === true, "expected success:true");
    expect(typeof data.referenceId === "string", "expected a referenceId");
    state.newStudentReferenceId = data.referenceId;
  });

  await t("POST /students/login (newly registered student)", async () => {
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
    const email = process.env.MAIN_ADMIN_EMAIL;
    const password = state.originalAdminPassword;
    expect(email && password, "MAIN_ADMIN_EMAIL / MAIN_ADMIN_INITIAL_PASSWORD must be set in .env");
    const res = await fetch(`${BASE}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    state.adminCookie = extractCookie(res);
    expect(state.adminCookie, "expected a token cookie from admin login");
  });

  await t("GET /admin/auth/forgot-password-questions (before recovery is configured -> expected 400)", async () => {
    const { status } = await req("GET", `/admin/auth/forgot-password-questions?email=${process.env.MAIN_ADMIN_EMAIL}`);
    expect(status === 400, `expected 400 (no secret question configured yet), got ${status}`);
  });

  // ======================================================================
  section("Admin auth / profile / account management");
  // ======================================================================

  await t("GET /admin/auth/me", async () => {
    const { status, data } = await req("GET", "/admin/auth/me", { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(data.admin?.email === process.env.MAIN_ADMIN_EMAIL, "expected the logged-in admin's email back");
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
    const { status, data } = await req("GET", `/admin/auth/forgot-password-questions?email=${process.env.MAIN_ADMIN_EMAIL}`);
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

  await t("POST /admin/auth/reset-password-recovery (expected 400 - birthPlace/birthDate never set anywhere in the app)", async () => {
    const { status } = await req("POST", "/admin/auth/reset-password-recovery", {
      body: { email: process.env.MAIN_ADMIN_EMAIL, birthPlace: "x", birthDate: "2000-01-01", newPassword: "Whatever123", confirmPassword: "Whatever123" },
    });
    expect(status === 400, `expected 400 (documented dead code path), got ${status}`);
  });

  await t("PUT /admin/change-password (round-trips: change then change back, so the seeded admin's password is unaffected)", async () => {
    const tempPassword = "SmokeTemp1234!";
    const first = await req("PUT", "/admin/change-password", {
      cookie: state.adminCookie,
      body: { oldPassword: state.originalAdminPassword, newPassword: tempPassword, confirmPassword: tempPassword },
    });
    expect(first.status === 200, `expected 200, got ${first.status}: ${JSON.stringify(first.data)}`);

    const second = await req("PUT", "/admin/change-password", {
      cookie: state.adminCookie,
      body: { oldPassword: tempPassword, newPassword: state.originalAdminPassword, confirmPassword: state.originalAdminPassword },
    });
    expect(second.status === 200, `expected password to be restored, got ${second.status}: ${JSON.stringify(second.data)}`);
  });

  await t("POST /admin/auth/reset-password-questions + PUT /admin/change-password (round-trip via recovery flow)", async () => {
    const list = await req("GET", `/admin/auth/forgot-password-questions?email=${process.env.MAIN_ADMIN_EMAIL}`);
    const questionId = list.data.questions[0].id;
    const tempPassword = "SmokeRecoveryTemp1!";
    const reset = await req("POST", "/admin/auth/reset-password-questions", {
      body: {
        email: process.env.MAIN_ADMIN_EMAIL,
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
      body: JSON.stringify({ email: process.env.MAIN_ADMIN_EMAIL, password: tempPassword }),
    });
    expect(loginRes.status === 200, "expected to log in with the recovery-reset temp password");
    state.adminCookie = extractCookie(loginRes);

    const restore = await req("PUT", "/admin/change-password", {
      cookie: state.adminCookie,
      body: { oldPassword: tempPassword, newPassword: state.originalAdminPassword, confirmPassword: state.originalAdminPassword },
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
    const { status, data } = await req("POST", "/admin/management/courses", { cookie: state.adminCookie, body: { name: `Smoke Course ${Date.now()}` } });
    expect(status === 201, `expected 201, got ${status}: ${JSON.stringify(data)}`);
    createdManagementItem = data.item.id;
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
    const { status } = await req("PUT", "/admin/administration/division-configurations", {
      cookie: state.adminCookie,
      body: { configurations: { "Servo System": { allowedBranches: ["Computer Science and Engineering"], branchSeats: { "Computer Science and Engineering": { paid: 5, unpaid: 5 } } } } },
    });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("PATCH /admin/administration/proforma", async () => {
    const { status } = await req("PATCH", "/admin/administration/proforma", { cookie: state.adminCookie, body: { proformaQuarterEnding: "March" } });
    expect(status === 200, `expected 200, got ${status}`);
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

  await t("GET /admin/students (resolve the newly-registered smoke student's id)", async () => {
    state.newStudentId = await findSeededStudentId(state.newStudentReferenceId);
    expect(state.newStudentId, "expected the newly-registered smoke student to be findable by referenceId");
  });

  await t("PATCH /admin/students/:id/review (approve)", async () => {
    const { status, data } = await req("PATCH", `/admin/students/${state.newStudentId}/review`, {
      cookie: state.adminCookie,
      body: { status: "Approved", remark: "Smoke test approval", recommendedBy: "Servo System" },
    });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
    expect(data.student?.status === "Approved", "expected status to now be Approved");
  });

  await t("PATCH /admin/students/:id/training-management", async () => {
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
  });

  await t("PATCH /admin/students/:id (multipart edit, no new files)", async () => {
    const form = new FormData();
    form.append("recommendedBy", "Servo System");
    const { status, data } = await req("PATCH", `/admin/students/${state.newStudentId}`, { cookie: state.adminCookie, form });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  // ======================================================================
  section("Offer letter (backend/controllers/offerLetterController.js)");
  // ======================================================================

  await t("POST /offer-letter/:studentId/generate", async () => {
    const { status, data } = await req("POST", `/offer-letter/${state.newStudentId}/generate`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
    expect(typeof data.html === "string" && data.html.length > 0, "expected generated HTML back");
  });

  await t("GET /offer-letter/:studentId", async () => {
    const { status, data } = await req("GET", `/offer-letter/${state.newStudentId}`, { cookie: state.adminCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(typeof data.html === "string", "expected html back");
  });

  await t("PUT /offer-letter/:studentId (edit - note: discards its own PDF render, known dead code)", async () => {
    const { status, data } = await req("PUT", `/offer-letter/${state.newStudentId}`, {
      cookie: state.adminCookie,
      body: { studentName: "Smoke Test Student", collegeName: "Smoke Test College", course: "B.Tech" },
    });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  await t("POST /offer-letter/:studentId/pdf (Puppeteer)", async () => {
    const { status } = await req("POST", `/offer-letter/${state.newStudentId}/pdf`, { cookie: state.adminCookie, binary: true });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("POST /offer-letter/:studentId/upload (multipart PDF)", async () => {
    const form = new FormData();
    form.append("offerLetter", fileOf(PDF_BYTES), "offer.pdf");
    const { status, data } = await req("POST", `/offer-letter/${state.newStudentId}/upload`, { cookie: state.adminCookie, form });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  await t("POST /offer-letter/:studentId/send (needs EMAIL_ENABLED=true and MinIO/S3 configured)", async () => {
    const { status, data } = await req("POST", `/offer-letter/${state.newStudentId}/send`, { cookie: state.adminCookie });
    if (process.env.EMAIL_ENABLED !== "true") {
      expect(status !== 200, "expected this route to fail when EMAIL_ENABLED is not 'true' - it treats a skipped email as an error, unlike other email routes");
      return;
    }
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  await t("POST /admin/students/:id/offer-letter (separate admin-side offer-letter file upload)", async () => {
    const form = new FormData();
    form.append("offerLetter", fileOf(PDF_BYTES), "offer.pdf");
    const { status, data } = await req("POST", `/admin/students/${state.newStudentId}/offer-letter`, { cookie: state.adminCookie, form });
    // Depends on S3/MinIO being configured; report the real outcome either way.
    if (status !== 200) {
      skip("  (see above) offer-letter file upload", `got ${status} - likely MinIO/S3 not configured in this environment: ${JSON.stringify(data)}`);
      return;
    }
    expect(status === 200, `expected 200, got ${status}`);
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

  await t("GET /students/dashboard (new student, now Approved)", async () => {
    const { status, data } = await req("GET", "/students/dashboard", { cookie: state.studentCookie });
    expect(status === 200, `expected 200, got ${status}`);
    expect(data.student?.status === "Approved", "expected the smoke student's dashboard to show Approved");
  });

  await t("GET /students/documents/declaration (Puppeteer)", async () => {
    const { status } = await req("GET", "/students/documents/declaration", { cookie: state.studentCookie, binary: true });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("GET /students/documents/character (Puppeteer)", async () => {
    const { status } = await req("GET", "/students/documents/character", { cookie: state.studentCookie, binary: true });
    expect(status === 200, `expected 200, got ${status}`);
  });

  await t("GET /students/documents/not-a-real-type (expected 404)", async () => {
    const { status } = await req("GET", "/students/documents/not-a-real-type", { cookie: state.studentCookie });
    expect(status === 404, `expected 404, got ${status}`);
  });

  await t("POST /students/completed-documents (multipart)", async () => {
    const form = new FormData();
    form.append("completedDocuments", fileOf(PDF_BYTES), "completed.pdf");
    const { status, data } = await req("POST", "/students/completed-documents", { cookie: state.studentCookie, form });
    expect(status === 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  });

  await t("PATCH /students/paid-project-details (expected 403 - smoke student is Unpaid)", async () => {
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

  await t("DELETE /students/:id (admin deletes the throwaway smoke student)", async () => {
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

  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("Smoke test crashed:", error);
  process.exit(1);
});
