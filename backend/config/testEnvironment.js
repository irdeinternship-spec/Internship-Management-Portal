"use strict";

/**
 * config/testEnvironment.js
 *
 * Everything that decides "is it safe for a destructive test run to write
 * here?" lives in this one file, so there is exactly one place to audit.
 *
 * Context: scripts/smoke.js is destructive by design - it registers students,
 * uploads their documents, creates and deletes admins, colleges and divisions.
 * It used to run against whatever MONGODB_URI pointed at, which is production,
 * and it left orphaned records behind whenever a run failed before its cleanup
 * step. The fix is a separate database AND a separate R2 bucket with its own
 * scoped credentials, so the test path physically cannot address production
 * files no matter what bug it has.
 *
 * The guards below are belt-and-braces on top of that physical separation.
 */

const { DeleteObjectsCommand, ListObjectsV2Command, S3Client } = require("@aws-sdk/client-s3");

// --- Database guard --------------------------------------------------------

// Compared by PARSED host + database name, never by string equality: the same
// database is reachable by many different strings (a trailing "?retryWrites=
// true", different credentials, a different option order), so a string compare
// would pass happily while both URIs addressed production.
function describeMongoUri(uri, label) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch (error) {
    throw new Error(`${label} is not a parseable MongoDB URI.`);
  }
  const database = parsed.pathname.replace(/^\/+/, "").trim();
  if (!database) {
    throw new Error(
      `${label} does not name a database (nothing after the host). ` +
        `Add one, e.g. mongodb+srv://.../portal_test`
    );
  }
  return { host: parsed.host.toLowerCase(), database };
}

/**
 * Returns the test database URI, or throws with an actionable message.
 * Refuses if MONGODB_URI_TEST is unset, or if it resolves to the same
 * host + database as MONGODB_URI.
 */
function requireTestDatabaseUri() {
  const testUri = process.env.MONGODB_URI_TEST;
  if (!testUri) {
    throw new Error(
      "MONGODB_URI_TEST is not set. The smoke suite is destructive and refuses to " +
        "run without a dedicated test database. Add MONGODB_URI_TEST to backend/.env " +
        "(see .env.example)."
    );
  }

  const test = describeMongoUri(testUri, "MONGODB_URI_TEST");

  // If MONGODB_URI isn't set at all there is nothing to collide with, so the
  // comparison is skipped rather than treated as an error.
  if (process.env.MONGODB_URI) {
    const live = describeMongoUri(process.env.MONGODB_URI, "MONGODB_URI");
    if (test.host === live.host && test.database === live.database) {
      throw new Error(
        `REFUSING TO RUN: MONGODB_URI_TEST resolves to the same database as MONGODB_URI ` +
          `(${live.host}/${live.database}). They must be different databases - the smoke ` +
          `suite drops and reseeds whatever it is pointed at.`
      );
    }
  }

  return { uri: testUri, ...test };
}

// --- R2 guard --------------------------------------------------------------

/**
 * Returns the test bucket's name and its OWN scoped client. The credentials
 * are deliberately read from R2_TEST_* rather than R2_* so this client has no
 * authority over the production bucket at all - the guard below is the second
 * line of defence, not the first.
 */
function requireTestBucket() {
  const bucket = process.env.R2_TEST_BUCKET;
  const accessKeyId = process.env.R2_TEST_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_TEST_SECRET_ACCESS_KEY;

  const missing = [
    !bucket && "R2_TEST_BUCKET",
    !accessKeyId && "R2_TEST_ACCESS_KEY_ID",
    !secretAccessKey && "R2_TEST_SECRET_ACCESS_KEY",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(", ")} in backend/.env. The smoke suite uploads and then ` +
        `deletes files, and refuses to do either against the production bucket.`
    );
  }

  if (process.env.R2_BUCKET && bucket === process.env.R2_BUCKET) {
    throw new Error(
      `REFUSING TO RUN: R2_TEST_BUCKET and R2_BUCKET are the same bucket (${bucket}). ` +
        `The smoke suite deletes the entire contents of the test bucket.`
    );
  }

  // R2_ENDPOINT / R2_REGION are shared - it's the same Cloudflare account, and
  // only the bucket and credentials differ.
  const client = new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
    // Must match services/s3StorageService.js's client. Without it the SDK
    // addresses the bucket virtual-host style, ListObjectsV2 resolves
    // elsewhere, and purgeTestBucket() reports "0 objects deleted" against a
    // bucket that is actually full - a silent no-op, which is the one failure
    // mode a cleanup routine must not have.
    forcePathStyle: true,
  });

  return { bucket, client };
}

/**
 * Deletes EVERY object in the test bucket.
 *
 * Whole-bucket rather than tracking individual keys on purpose: a run that
 * dies halfway leaves files behind precisely because nothing recorded their
 * keys. Emptying the bucket cannot miss them.
 *
 * The bucket name is the guard. This function takes no bucket argument - it
 * resolves R2_TEST_BUCKET itself and re-asserts the name immediately before
 * every delete call, so there is no parameter for a caller to get wrong.
 */
async function purgeTestBucket() {
  const { bucket, client } = requireTestBucket();

  let deleted = 0;
  let continuationToken;

  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken })
    );
    const objects = (listed.Contents || []).map((object) => ({ Key: object.Key }));

    if (objects.length) {
      // Re-assert on every iteration, not once at the top: this is the last
      // statement before an irreversible bulk delete.
      if (bucket !== process.env.R2_TEST_BUCKET) {
        throw new Error(`REFUSING TO DELETE: target bucket ${bucket} is not R2_TEST_BUCKET.`);
      }
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
      deleted += objects.length;
    }

    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  return { bucket, deleted };
}

// --- Write guard for one-off scripts -------------------------------------

/**
 * Resolves and ANNOUNCES the database a write-capable script is about to act
 * on, and refuses to touch anything other than the test database without an
 * explicit --yes.
 *
 * This exists because `npm run seed` silently defaulted to MONGODB_URI, and a
 * run intended as a harmless check re-inserted three branches that had been
 * deliberately retired through the admin panel - straight onto the live
 * application form. The script did nothing wrong; it just never said where it
 * was pointing, and nothing made production opt-in.
 *
 * Usage in a script:
 *   const uri = requireWriteTarget({ scriptName: "seed" });
 *   await connectDB(uri);
 *
 *   node scripts/seed.js --uri=<test uri>   -> proceeds (test database)
 *   node scripts/seed.js                    -> REFUSES (production)
 *   node scripts/seed.js --yes              -> proceeds, having said so
 */
function requireWriteTarget({ scriptName = "script", argv = process.argv } = {}) {
  const explicit = argv.map((arg) => (arg.startsWith("--uri=") ? arg.slice("--uri=".length) : null)).find(Boolean);
  const uri = explicit || process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(`No database URI: pass --uri=<uri> or set MONGODB_URI in backend/.env.`);
  }

  const target = describeMongoUri(uri, explicit ? "--uri" : "MONGODB_URI");

  // Same parsed host+database comparison the smoke guard uses, so "is this the
  // test database?" is decided identically everywhere.
  let isTestDatabase = false;
  if (process.env.MONGODB_URI_TEST) {
    const test = describeMongoUri(process.env.MONGODB_URI_TEST, "MONGODB_URI_TEST");
    isTestDatabase = target.host === test.host && target.database === test.database;
  }

  // Announced BEFORE the confirmation check, so even a refused run tells you
  // what it was aimed at.
  console.log("---------------------------------------------------------");
  console.log(`  ${scriptName} -> ${target.host}/${target.database}`);
  console.log(`  ${isTestDatabase ? "test database" : "NOT the test database - production data"}`);
  console.log("---------------------------------------------------------");

  if (!isTestDatabase && !argv.includes("--yes")) {
    throw new Error(
      `REFUSING TO WRITE to ${target.host}/${target.database} - this is not the test database.\n` +
        `  If that is genuinely what you want, re-run with --yes.\n` +
        `  To target the test database instead: --uri=$MONGODB_URI_TEST`
    );
  }

  return uri;
}

module.exports = {
  describeMongoUri,
  purgeTestBucket,
  requireTestBucket,
  requireTestDatabaseUri,
  requireWriteTarget,
};
