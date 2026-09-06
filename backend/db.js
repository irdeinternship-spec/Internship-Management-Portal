const { Pool } = require("pg");

let pool;

if (process.env.DB_HOST) {
  const passwordLength = process.env.DB_PASSWORD ? process.env.DB_PASSWORD.length : 0;
  console.log("🔌 PostgreSQL Connection Config:", {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD ? `SET (length: ${passwordLength})` : "NOT SET",
  });

  pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  pool.query("SELECT current_database(), current_user, current_schema()")
    .then((res) => {
      console.log("✅ PostgreSQL connected successfully:", res.rows[0]);
    })
    .catch((err) => {
      console.error("❌ Fatal Database Connection Error:", err);
      process.exit(1);
    });

  pool.on("error", (err) => {
    console.error("❌ PostgreSQL error:", err);
  });
} else {
  // Mongo migration in progress: DB_HOST is intentionally unset once
  // MONGODB_URI is the configured store. This is deliberately NOT a null
  // export - a null pool turns every un-migrated call site into a generic
  // "Cannot read properties of null (reading 'query')" TypeError with no
  // indication of which code path is still on the old pg store. Instead,
  // every method the codebase actually calls on this pool (grepped: query,
  // connect, end - `.on` is only ever called from this file itself) throws
  // immediately with a message naming the problem, and the stack trace
  // pinpoints the exact call site that still needs to be migrated to Mongo.
  // Do not delete this file or change its exports - old code still imports
  // it until the rest of the migration lands.
  const notConfigured = (method) => () => {
    throw new Error(
      `Postgres is not configured (DB_HOST is unset). This code path called pool.${method}() ` +
      "and still uses the old pg store - it should have been migrated to Mongo. Call site:"
    );
  };

  pool = {
    query: notConfigured("query"),
    connect: notConfigured("connect"),
    end: notConfigured("end"),
  };

  console.log("ℹ️  DB_HOST not set - skipping Postgres connection (db.js exports a tripwire stub).");
}

module.exports = pool;
