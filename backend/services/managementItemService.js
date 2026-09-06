const fs = require("fs/promises");
const path = require("path");

// TODO(mongo-migration follow-up): services/collegeService.js duplicates this
// file's list/create/update/remove logic almost line-for-line, just hardcoded
// to the `colleges` table/collection instead of taking a `type` param like
// this file already does for courses/branches/durations. Once the Mongo
// migration is stable, collapse collegeService.js into this generic
// type-parameterized service (add "colleges" to entityFiles/labels below and
// point it at the new College model). Deliberately NOT done as part of the
// migration itself, so a broken reference lookup after cutover is
// unambiguously the migration's fault, not a refactor's - see the
// colleges/courses/branches modeling decision in the migration plan.
const entityFiles = { courses: "courses.json", branches: "branches.json", durations: "durations.json" };
const labels = { courses: "Course", branches: "Branch", durations: "Duration" };
const defaults = {
  courses: ["B.Tech", "M.Tech", "M.Sc", "PhD"],
  branches: [
    "Computer Science and Engineering",
    "Information Technology",
    "Electronics and Communication",
    "Electrical Engineering",
    "Mechanical Engineering",
    "Civil Engineering",
    "Aerospace Engineering",
    "Artificial Intelligence and Data Science",
  ],
  durations: ["1 Week", "2 Weeks", "3 Weeks", "4 Weeks", "6 Weeks", "8 Weeks", "10 Weeks", "12 Weeks"],
};
const normalize = (name) => String(name || "").trim().replace(/\s+/g, " ");
const failure = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const fileFor = (type) => entityFiles[type] ? path.join(__dirname, "..", "data", entityFiles[type]) : null;
const durationParts = (name) => { const match = String(name || "").trim().match(/^(\d+(?:\.\d+)?)\s*(day|week|month)s?\b/i); const units = { day: 0, week: 1, month: 2 }; return match ? { unit: units[match[2].toLowerCase()], value: Number(match[1]) } : { unit: Infinity, value: Infinity }; };
const compareDurations = (left, right) => { const a = durationParts(left.name); const b = durationParts(right.name); return a.unit - b.unit || a.value - b.value || left.name.localeCompare(right.name); };

const pool = require("../db");

async function read(type) {
  if (type === "durations") {
    try {
      const res = await pool.query("SELECT data FROM durations");
      const values = res.rows.map(row => row.data);
      return Array.isArray(values) ? values : [];
    } catch (error) {
      return (defaults.durations || []).map((name, index) => ({ id: index + 1, name }));
    }
  }

  if (type === "courses" || type === "branches") {
    try {
      const res = await pool.query(`SELECT id, name FROM ${type} ORDER BY name ASC`);
      return res.rows;
    } catch (error) {
      return (defaults[type] || []).map((name, index) => ({ id: index + 1, name }));
    }
  }

  const file = fileFor(type); if (!file) throw failure("Invalid management item type.", 404);
  try { const values = JSON.parse(await fs.readFile(file, "utf8")); return Array.isArray(values) ? values : []; }
  catch (error) { if (error.code === "ENOENT") return (defaults[type] || []).map((name, index) => ({ id: index + 1, name })); throw failure(`Unable to read ${labels[type].toLowerCase()} data.`, 500); }
}
async function save(type, values) {
  if (type === "durations") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM durations");
      for (const item of values) {
        await client.query("INSERT INTO durations (data) VALUES ($1)", [item]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw failure("Failed to save durations to database.", 500);
    } finally {
      client.release();
    }
    return;
  }

  if (type === "courses" || type === "branches") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ${type}`);
      for (const item of values) {
        await client.query(`INSERT INTO ${type} (id, name) VALUES ($1, $2)`, [item.id, item.name]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw failure(`Failed to save ${type} to database.`, 500);
    } finally {
      client.release();
    }
    return;
  }

  const file = fileFor(type); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `${JSON.stringify(values, null, 2)}\n`, "utf8");
}
async function list(type) { return (await read(type)).sort(type === "durations" ? compareDurations : (a, b) => a.name.localeCompare(b.name)); }
async function create(type, name) { const value = normalize(name), label = labels[type]; if (!value) throw failure(`${label} name is required.`, 400); const items = await read(type); if (items.some((item) => item.name.toLowerCase() === value.toLowerCase())) throw failure(`${label} already exists.`, 409); const item = { id: items.reduce((max, entry) => Math.max(max, entry.id || 0), 0) + 1, name: value }; await save(type, [...items, item]); return item; }
async function update(type, id, name) { const value = normalize(name), label = labels[type], items = await read(type), index = items.findIndex((item) => item.id === Number(id)); if (!value) throw failure(`${label} name is required.`, 400); if (index < 0) throw failure(`${label} not found.`, 404); if (items.some((item) => item.id !== Number(id) && item.name.toLowerCase() === value.toLowerCase())) throw failure(`${label} already exists.`, 409); const item = { ...items[index], name: value }; items[index] = item; await save(type, items); return item; }
async function remove(type, id) { const items = await read(type), item = items.find((entry) => entry.id === Number(id)); if (!item) throw failure(`${labels[type]} not found.`, 404); await save(type, items.filter((entry) => entry.id !== Number(id))); return item; }
module.exports = { list, create, update, remove };
