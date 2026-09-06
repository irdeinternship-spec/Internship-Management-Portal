const mongoose = require("mongoose");

// Deliberately standalone and NOT required by server.js/db.js yet - per
// instruction, the new Mongo models aren't wired into the running app until
// that's reviewed on its own. This exists only for scripts (seed.js, and
// smoke.js's target server once wiring happens) to connect with.
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required (set it in backend/.env).");
  }
  await mongoose.connect(uri);
  // Not logging the URI itself - it carries credentials.
  console.log(`🌐 Connected to MongoDB (db: ${mongoose.connection.name})`);
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
