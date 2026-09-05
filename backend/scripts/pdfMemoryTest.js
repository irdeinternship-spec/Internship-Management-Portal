#!/usr/bin/env node
"use strict";

/**
 * scripts/pdfMemoryTest.js
 *
 * Generates the heaviest real document in the app -- the DRDO offer letter,
 * which embeds three base64 PNGs into a ~2MB HTML payload -- 10 times in a
 * row through the actual production pdfService.generatePdfFromHtml() call
 * (same concurrency-1 queue, same low-memory launch flags as production),
 * and reports:
 *
 *   - process.memoryUsage().rss for THIS Node process, before/after each run
 *     (what was literally asked for)
 *   - the combined RSS of Node + every child process it spawns, sampled
 *     while each render is in flight -- Puppeteer launches Chromium as a
 *     *separate* OS process, so process.memoryUsage() alone never sees it.
 *     This combined number is the one that actually matters against a
 *     container memory limit (Render's cap applies to the whole container,
 *     not just the Node process).
 *
 * Usage:
 *   PUPPETEER_EXECUTABLE_PATH="/path/to/real/chrome" \
 *     node --max-old-space-size=512 scripts/pdfMemoryTest.js
 *
 * CAVEATS -- read before trusting the printed number:
 *
 *   1. --max-old-space-size only caps the V8 heap *inside Node*. It has NO
 *      effect on Chromium's memory -- Chromium is a separate binary with its
 *      own allocator. Passing it here makes Node-side ballooning visible; it
 *      does not simulate a real 512MB container ceiling for the Chromium
 *      side. A faithful simulation needs a cgroup/container memory limit
 *      wrapped around the whole process tree (e.g. `docker run --memory=512m`).
 *
 *   2. This script measures the RSS of whatever Chromium binary
 *      PUPPETEER_EXECUTABLE_PATH points at (or @sparticuz/chromium's bundled
 *      binary if that env var is unset). @sparticuz/chromium's bundled
 *      binary is Linux-only. On a non-Linux dev machine you MUST set
 *      PUPPETEER_EXECUTABLE_PATH to a real local Chrome install -- the
 *      number you get is then a proxy (identical driver code and launch
 *      flags, a different actual Chromium binary/build) for what will run
 *      on Render, not a direct measurement of the exact binary that will
 *      deploy there.
 */

const path = require("path");
const { execSync } = require("child_process");

const pdfService = require(path.join(__dirname, "..", "services", "pdfService"));
const templateService = require(path.join(__dirname, "..", "services", "templateService"));

const RUNS = 10;
const POLL_MS = 100;

// Doesn't need a DB: the offer letter's dominant memory cost is the 3 baked-in
// images, which don't depend on student data. See templateService.js.
const mockStudent = {
  _id: "000000000000pdftest",
  name: "Test Student For Memory Benchmark",
  course: "B.Tech",
  year: "3rd Year",
  branch: "Computer Science",
  collegeName: "Sample Institute of Technology",
  location: "Hyderabad, Telangana",
  collegeAddress: "123 Sample Road, Hyderabad, Telangana - 500001",
  internshipType: "Unpaid",
  trainingManagement: { trainingDuration: "6 Weeks" },
  offerLetter: {},
};

function bytesToMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

// Sum RSS (bytes) of the current process plus every descendant process,
// using `ps` -- portable across macOS/Linux, no extra dependency needed.
function totalTreeRssBytes(rootPid) {
  let out;
  try {
    out = execSync("ps -Ao pid,ppid,rss", { encoding: "utf8" });
  } catch (err) {
    return null;
  }
  const rows = out
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length === 3 && !row.some(Number.isNaN));

  const childrenOf = new Map();
  const rssByPid = new Map();
  for (const [pid, ppid, rss] of rows) {
    rssByPid.set(pid, rss);
    if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
    childrenOf.get(ppid).push(pid);
  }

  const included = new Set([rootPid]);
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    for (const child of childrenOf.get(pid) || []) {
      if (!included.has(child)) {
        included.add(child);
        stack.push(child);
      }
    }
  }

  let totalKb = 0;
  for (const pid of included) totalKb += rssByPid.get(pid) || 0;
  return totalKb * 1024; // ps reports rss in KB
}

async function main() {
  console.log(`Generating the DRDO offer letter (heaviest real document) x${RUNS}`);
  console.log(
    `Chromium binary: ${
      process.env.PUPPETEER_EXECUTABLE_PATH || "(default: @sparticuz/chromium, Linux only)"
    }`
  );
  console.log("");

  const html = await templateService.generateOfferLetterHtml(mockStudent);
  console.log(`Rendered HTML size: ${bytesToMB(Buffer.byteLength(html))} MB\n`);

  let peakNodeRss = 0;
  let peakTreeRss = 0;

  for (let i = 1; i <= RUNS; i++) {
    const nodeRssBefore = process.memoryUsage().rss;

    let peakTreeThisRun = totalTreeRssBytes(process.pid) || 0;
    const poller = setInterval(() => {
      const sample = totalTreeRssBytes(process.pid);
      if (sample && sample > peakTreeThisRun) peakTreeThisRun = sample;
    }, POLL_MS);

    let pdfBytes = 0;
    try {
      const pdf = await pdfService.generatePdfFromHtml(html);
      pdfBytes = pdf.length;
    } finally {
      clearInterval(poller);
    }

    const nodeRssAfter = process.memoryUsage().rss;

    peakNodeRss = Math.max(peakNodeRss, nodeRssAfter);
    peakTreeRss = Math.max(peakTreeRss, peakTreeThisRun);

    console.log(
      `Run ${String(i).padStart(2, " ")}/${RUNS}  ` +
        `Node RSS before/after: ${bytesToMB(nodeRssBefore)}MB -> ${bytesToMB(nodeRssAfter)}MB  ` +
        `(delta ${bytesToMB(nodeRssAfter - nodeRssBefore)}MB)  ` +
        `Peak Node+Chromium RSS during run: ${bytesToMB(peakTreeThisRun)}MB  ` +
        `PDF: ${bytesToMB(pdfBytes)}MB`
    );
  }

  console.log("");
  console.log("==================== SUMMARY ====================");
  console.log(`Peak Node-only RSS across all ${RUNS} runs:       ${bytesToMB(peakNodeRss)} MB`);
  console.log(
    `Peak Node+Chromium RSS across all ${RUNS} runs:   ${bytesToMB(
      peakTreeRss
    )} MB   <-- this is the number that matters for a container memory limit`
  );
  console.log("===================================================");
  console.log("");
  console.log("CAVEATS (see file header for full detail):");
  console.log("- --max-old-space-size bounds Node's V8 heap only; it does not constrain Chromium.");
  console.log("- The number above reflects the Chromium binary actually launched (path printed above),");
  console.log("  which is a real local Chrome on non-Linux dev machines, not the exact Linux");
  console.log("  @sparticuz/chromium binary that will run on Render.");
}

main().catch((err) => {
  console.error("Memory test failed:", err);
  process.exitCode = 1;
});
