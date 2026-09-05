const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const templatePath = path.join(
  __dirname,
  "..",
  "templates",
  "drdo_offer_letter.html"
);

// Optimized WebP versions, downscaled to the largest size these actually
// render at in the template (135px/95px CSS width) sampled at 300 DPI print
// quality, then re-encoded (see backend/templates/*-optimized.webp). This
// replaced the original ~924KB/404KB PNGs, which were rendered at a tiny
// fraction of their native 1024px resolution -- see git history for the
// originals if a higher-resolution source is ever needed elsewhere.
const logoPath = path.join(__dirname, "..", "templates", "drdo_logo-optimized.webp");
const bannerPath = path.join(__dirname, "..", "templates", "ssa_banner-optimized.webp");
const swachhPath = path.join(__dirname, "..", "templates", "swachh_logo-optimized.webp");

// Convert images to Base64 so Puppeteer always renders them
const logoBase64 = fs.existsSync(logoPath)
  ? `data:image/webp;base64,${fs.readFileSync(logoPath).toString("base64")}`
  : "";

// NOTE: bannerBase64 is computed but not currently referenced by any
// {{placeholder}} in drdo_offer_letter.html -- the banner image is instead
// baked directly into that template file as a literal base64 string (see
// the optimization pass that replaced it). Kept here, pointed at the same
// optimized asset, in case the template is ever changed to use {{bannerUrl}}.
const bannerBase64 = fs.existsSync(bannerPath)
  ? `data:image/webp;base64,${fs.readFileSync(bannerPath).toString("base64")}`
  : "";

const swachhBase64 = fs.existsSync(swachhPath)
  ? `data:image/webp;base64,${fs.readFileSync(swachhPath).toString("base64")}`
  : "";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return new Date().toLocaleDateString("en-IN");
  return new Date(value).toLocaleDateString("en-IN");
}

function defaultLetterNumber(student) {
  const suffix = String(student._id || "")
    .slice(-6)
    .toUpperCase();

  const year = new Date().getFullYear();

  return `DRDO/INT/${year}/${suffix}`;
}

function buildTemplateData(student, overrides = {}) {
  const issueDate =
    overrides.issueDate ||
    student.offerLetter?.issueDate ||
    new Date();

  let duration =
    overrides.internshipDuration ||
    overrides.duration ||
    student.trainingManagement?.trainingDuration ||
    student.offerLetter?.internshipDuration ||
    student.internshipDuration ||
    "";
  if (!duration && student.internshipType === "Paid") {
    duration = "6 Months";
  }

  return {
    logoUrl: overrides.logoUrl || logoBase64,
    bannerUrl: bannerBase64,
    swachhUrl: overrides.swachhUrl || swachhBase64,

    studentName: overrides.studentName || student.name || "",

    course:
      overrides.course ||
      student.course ||
      "",

    year:
      overrides.year ||
      student.year ||
      "",

    branch:
      overrides.branch ||
      student.branch ||
      "",

    collegeName:
      overrides.collegeName ||
      student.collegeName ||
      "",

    collegeLocation:
      overrides.collegeLocation ||
      student.location ||
      "",

    collegeAddress:
      overrides.collegeAddress ||
      student.offerLetter?.collegeAddress ||
      student.collegeAddress ||
      "",

    internshipDuration: duration,
    duration: duration,

    issueDate: formatDate(issueDate),

    letterNumber:
      overrides.letterNumber ||
      student.offerLetter?.letterNumber ||
      defaultLetterNumber(student),
  };
}

async function readOfferLetterTemplate() {
  return await fsp.readFile(templatePath, "utf8");
}

async function generateOfferLetterHtml(student, overrides = {}) {
  const template = await readOfferLetterTemplate();
  const data = buildTemplateData(student, overrides);

  return template.replace(/{{(\w+)}}/g, (match, key) => {
    // Don't escape Base64 image URLs
    if (key === "logoUrl" || key === "bannerUrl" || key === "swachhUrl") {
      return data[key];
    }

    return escapeHtml(data[key] ?? "");
  });
}

module.exports = {
  buildTemplateData,
  defaultLetterNumber,
  generateOfferLetterHtml,
};
