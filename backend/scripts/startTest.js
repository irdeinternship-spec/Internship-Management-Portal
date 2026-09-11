#!/usr/bin/env node
"use strict";

/**
 * scripts/startTest.js  ->  npm run start:test
 *
 * Boots the normal server against the TEST database and TEST R2 bucket, so
 * scripts/smoke.js has something safe to point at.
 *
 * ORDERING IS LOAD-BEARING. services/s3StorageService.js builds its S3 client
 * at module load from process.env.R2_*, so the reassignments below must happen
 * BEFORE server.js is required - it pulls that module in transitively. Moving
 * the require above them would silently send every smoke upload to the
 * production bucket while everything still appeared to work.
 *
 * Only the bucket and its credentials are swapped. R2_ENDPOINT and R2_REGION
 * are shared: same Cloudflare account, different bucket.
 */

require("dotenv").config({ quiet: true });

const { requireTestBucket, requireTestDatabaseUri } = require("../config/testEnvironment");

// Both guards run before anything binds a port or opens a connection, so a
// misconfiguration fails immediately and loudly instead of halfway through a
// destructive test run.
const database = requireTestDatabaseUri();
const { bucket } = requireTestBucket();

process.env.MONGODB_URI = database.uri;
process.env.R2_BUCKET = bucket;
process.env.R2_ACCESS_KEY_ID = process.env.R2_TEST_ACCESS_KEY_ID;
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_TEST_SECRET_ACCESS_KEY;

console.log("=========================================================");
console.log("  TEST SERVER - isolated from production");
console.log(`  database : ${database.host}/${database.database}`);
console.log(`  R2 bucket: ${bucket}`);
console.log("=========================================================");

require("../server");
