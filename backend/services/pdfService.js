
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

// --- Concurrency control -------------------------------------------------
// Hard cap of 1 PDF generation at a time. Each Puppeteer render launches a
// whole separate Chromium process; on a small instance two of those running
// at once is what actually causes an OOM, not one slow request. Anything
// queued longer than QUEUE_TIMEOUT_MS fails fast with a clear error instead
// of piling up behind a stuck job.
const MAX_CONCURRENT_PDF_JOBS = 1;
const QUEUE_TIMEOUT_MS = Number(process.env.PDF_QUEUE_TIMEOUT_MS) || 45000;

let active = 0;
const waiting = [];

function drain() {
  while (waiting.length) {
    const entry = waiting[0];
    if (active >= MAX_CONCURRENT_PDF_JOBS) break;
    active++;
    waiting.shift();
    clearTimeout(entry.timer);
    entry.resolve(release);
  }
}

function release() {
  active--;
  drain();
}

function acquireSlot() {
  return new Promise((resolve, reject) => {
    if (active < MAX_CONCURRENT_PDF_JOBS) {
      active++;
      resolve(release);
      return;
    }

    const entry = { resolve };
    entry.timer = setTimeout(() => {
      const i = waiting.indexOf(entry);
      if (i !== -1) waiting.splice(i, 1);
      reject(new Error("PDF generation is busy — timed out waiting in queue"));
    }, QUEUE_TIMEOUT_MS);

    waiting.push(entry);
  });
}

// --- Chromium launch -------------------------------------------------------

async function getChromiumPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  try {
    return await chromium.executablePath();
  } catch (err) {
    return "bundled @sparticuz/chromium";
  }
}

async function checkChromiumPath() {
  const chromiumPath = await getChromiumPath();
  const source = process.env.PUPPETEER_EXECUTABLE_PATH
    ? "custom (PUPPETEER_EXECUTABLE_PATH)"
    : "@sparticuz/chromium";
  console.log(`🌐 Chromium path in use (${source}): ${chromiumPath}`);
  return chromiumPath;
}

async function createBrowser() {
  const executablePath = await getChromiumPath();

  // Low-memory flags for a small/free-tier instance. --single-process and
  // --no-zygote collapse Chromium down to one OS process instead of its
  // usual browser+renderer+GPU process tree; the rest trim background
  // work Chromium would otherwise keep resident.
  //
  // NOTE: --disable-gpu is deliberately NOT included. It was in the original
  // spec, but reproducibly hangs page loads (page.setContent never reaches
  // networkidle0) on real Chrome tested during development -- a known issue
  // with modern headless-shell Chrome, where GPU acceleration is already off
  // by default, making the flag both unnecessary and actively harmful here.
  const lowMemoryArgs = [
    "--single-process",
    "--no-zygote",
    "--disable-dev-shm-usage",
    "--no-sandbox",
  ];

  // chromium.args is tuned specifically for @sparticuz/chromium's own bundled
  // Linux binary (AWS Lambda-style flags, including a --headless='shell'
  // value with literal quote characters meant for their invocation path).
  // It must NOT be merged in when PUPPETEER_EXECUTABLE_PATH overrides to a
  // real desktop Chrome install (local dev) -- doing so reproducibly hangs
  // page loads, confirmed during development. Only apply it when we're
  // actually launching the bundled binary it was built for.
  const usingCustomExecutable = Boolean(process.env.PUPPETEER_EXECUTABLE_PATH);
  const args = usingCustomExecutable
    ? lowMemoryArgs
    : Array.from(new Set([...chromium.args, ...lowMemoryArgs]));

  const options = {
    headless: true,
    executablePath,
    args,
  };

  return puppeteer.launch(options);
}

async function renderPdf(browser, html) {
  console.info("PUPPETEER PAGE CREATE");
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(30000);
    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: 30000,
    });
    console.info("PUPPETEER HTML LOADED");
    await page.emulateMediaType("print");
    await page.evaluate(async () => {
      const images = Array.from(document.images);
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        })
      );
    });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
      timeout: 30000,
    });
    console.info("PUPPETEER PDF GENERATED", { bytes: pdfBuffer.length });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

async function generatePdfsFromHtml(htmlDocuments) {
  const release = await acquireSlot();
  let browser;
  try {
    browser = await createBrowser();
    return await Promise.all(htmlDocuments.map((html) => renderPdf(browser, html)));
  } catch (error) {
    console.error("PUPPETEER ERROR", { message: error.message, stack: error.stack });
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      console.info("PUPPETEER BROWSER CLOSED");
    }
    release();
  }
}

async function generatePdfFromHtml(html) {
  const [pdf] = await generatePdfsFromHtml([html]);
  return pdf;
}

module.exports = { checkChromiumPath, generatePdfFromHtml, generatePdfsFromHtml };
