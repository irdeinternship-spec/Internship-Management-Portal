const fs = require("fs/promises");
const path = require("path");
const { saveColleges } = require("../services/collegeService");
const { connectDB, disconnectDB } = require("../config/mongo");
const { requireWriteTarget } = require("../config/testEnvironment");

// This script is DESTRUCTIVE: saveColleges() is deleteMany({}) + insertMany, a
// whole-collection replacement. It also never opened a database connection of
// its own - every write just buffered until Mongoose timed out - so it has been
// broken since the Mongo migration. Both are fixed here: it connects
// explicitly, and it announces its target and refuses production without --yes.

async function importColleges() {
  await connectDB(requireWriteTarget({ scriptName: "db:import-colleges" }));
  const csvPath = path.join(__dirname, "..", "data", "UniversityList.csv");
  const names = (await fs.readFile(csvPath, "utf8"))
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.replace(/^"+|"+$/g, "").replace(/""/g, '"').trim())
    .filter(Boolean);
  const uniqueNames = [...new Map(names.map((name) => [name.toLocaleLowerCase("en-US"), name])).values()];
  await saveColleges(uniqueNames.map((name, index) => ({ id: index + 1, name })));
  console.log(`Imported ${uniqueNames.length} colleges.`);
  await disconnectDB();
}

importColleges().catch((error) => { console.error(error); process.exitCode = 1; });
