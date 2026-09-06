// Regression test for a real bug caught and fixed during the Postgres ->
// Mongo migration: a post("init") decryption hook does NOT fire for .lean()
// queries, which are used extensively for exactly the read paths that show
// student data (admin student list, division-capacity checks, the scheduled
// export). Before the fix, every one of those would have silently returned
// still-encrypted aadhaarNumber/bankDetails. See models/mongo/Student.js's
// post(["find","findOne","findOneAndUpdate"]) hook for the fix.
//
// This is exactly the class of bug that ships silently, so this test fails
// LOUDLY (throws, non-zero exit) if it ever regresses, rather than quietly
// passing on stale expectations.
//
// Run with: node --test tests/decryption.test.js
// Requires: MONGODB_URI configured and `npm run seed` already run (needs
// the seeded student that carries aadhaarNumber/bankDetails).

const test = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config();
const mongoose = require("mongoose");
const Student = require("../models/mongo/Student");

function maskLast4(value) {
  const str = String(value ?? "");
  if (str.length <= 4) return "*".repeat(str.length);
  return "*".repeat(str.length - 4) + str.slice(-4);
}

test("lean() and hydrated queries both return DECRYPTED aadhaarNumber and bankDetails", async (t) => {
  await mongoose.connect(process.env.MONGODB_URI);
  t.after(async () => {
    await mongoose.disconnect();
  });

  const leanResult = await Student.findOne({ aadhaarNumber: { $exists: true, $ne: null } }).lean();
  assert.ok(
    leanResult,
    "expected a seeded student with an aadhaarNumber to exist - run `npm run seed` first"
  );

  console.log(`  [lean]     aadhaarNumber: ...${maskLast4(leanResult.aadhaarNumber)}`);
  console.log(`  [lean]     bankDetails.savingAccountNumber: ...${maskLast4(leanResult.bankDetails?.savingAccountNumber)}`);
  console.log(`  [lean]     bankDetails.ifsc: ...${maskLast4(leanResult.bankDetails?.ifsc)}`);

  assert.match(
    String(leanResult.aadhaarNumber),
    /^\d{12}$/,
    "expected a 12-digit plaintext Aadhaar number from a .lean() query, not ciphertext"
  );
  assert.ok(
    !String(leanResult.aadhaarNumber).includes(":"),
    ".lean() aadhaarNumber still looks like iv:authTag:ciphertext - the decryption hook did not fire for .lean()"
  );
  assert.equal(
    typeof leanResult.bankDetails,
    "object",
    ".lean() bankDetails should be a decrypted object, not a ciphertext string"
  );
  assert.ok(leanResult.bankDetails.ifsc, "expected a decrypted ifsc field in .lean() bankDetails");

  // Same assertions against a hydrated (non-lean) result, to confirm the fix
  // didn't regress the previously-working path.
  const hydratedResult = await Student.findOne({ aadhaarNumber: { $exists: true, $ne: null } });
  console.log(`  [hydrated] aadhaarNumber: ...${maskLast4(hydratedResult.aadhaarNumber)}`);

  assert.match(String(hydratedResult.aadhaarNumber), /^\d{12}$/, "expected decrypted aadhaarNumber on a hydrated document too");
  assert.equal(typeof hydratedResult.bankDetails, "object", "expected decrypted bankDetails object on a hydrated document too");
});
