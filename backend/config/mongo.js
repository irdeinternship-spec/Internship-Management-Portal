const mongoose = require("mongoose");

// The connection URI is a PARAMETER, not a hidden read of one global env var.
//
// It used to be the latter, and that single implicit read is what made pointing
// anything at a different database hard: server.js, scripts/seed.js,
// scripts/migrateCourses.js and scripts/smoke.js all sat on it, so "run the
// smoke suite somewhere safe" had no answer that didn't involve mutating
// process.env behind everything's back. The practical consequence was that
// `npm run smoke` wrote throwaway students straight into live data.
//
// Callers that want the app's normal database still call connectDB() with no
// argument and get MONGODB_URI exactly as before; anything that needs a
// different target passes it explicitly.
//
// NOTE ON SCOPE: this points Mongoose's DEFAULT connection, which is what every
// model in models/mongo/*.js is compiled against. It is deliberately not
// mongoose.createConnection() - true multi-connection support would mean
// rebinding all nine models per connection, which buys nothing here because no
// process ever needs two databases at once. One process, one database, chosen
// explicitly by its caller.
async function connectDB(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error("No MongoDB URI supplied (and MONGODB_URI is not set in backend/.env).");
  }
  await mongoose.connect(uri);
  // Not logging the URI itself - it carries credentials. The database name is
  // logged on purpose: it is the one thing you want to see before a script
  // starts writing.
  console.log(`🌐 Connected to MongoDB (db: ${mongoose.connection.name})`);
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
