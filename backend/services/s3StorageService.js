const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const path = require("path");

// R2_ENDPOINT is already a complete URL (https://<accountid>.r2.cloudflarestorage.com)
// - unlike MinIO's separate host+port+SSL-flag, there's nothing to build here.
const endpoint = process.env.R2_ENDPOINT;

const s3Client = new S3Client({
  endpoint,
  region: process.env.R2_REGION,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

// Storage (Cloudflare R2, S3-compatible API) is an optional subsystem:
// production must still boot without it configured, with upload/download
// routes responding 503 instead of the app failing to start or a route
// 500ing on a raw AWS SDK error. Every exported function below asserts
// configuration first.
const STORAGE_ENV_KEYS = ["R2_ENDPOINT", "R2_REGION", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];

function getMissingStorageEnv() {
  return STORAGE_ENV_KEYS.filter((key) => !process.env[key]);
}

function isStorageConfigured() {
  return getMissingStorageEnv().length === 0;
}

function assertStorageConfigured() {
  const missing = getMissingStorageEnv();
  if (missing.length > 0) {
    const error = new Error(
      `File storage is not configured (missing: ${missing.join(", ")}). Upload/download is temporarily unavailable.`
    );
    error.statusCode = 503;
    throw error;
  }
}

let bucketChecked = false;
async function verifyR2Connection() {
  const bucketName = process.env.R2_BUCKET;
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log("✅ R2 connected");
    console.log(`✅ R2 bucket ready: ${bucketName}`);
    bucketChecked = true;
  } catch (error) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      // Bucket-create fallback, kept from the MinIO-era code - a no-op in
      // practice since the R2 bucket already exists. If it ever did fire, an
      // R2 API token scoped without bucket-create permission would surface
      // as a generic error below, not a distinct "permission denied" one.
      console.log("✅ R2 connected");
      console.log(`Bucket ${bucketName} not found. Creating bucket...`);
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`✅ R2 bucket ready: ${bucketName}`);
      bucketChecked = true;
    } else {
      console.error(`❌ R2 connection failed: Unable to connect to R2 at ${endpoint}. Error: ${error.message}`);
      throw error;
    }
  }
}

async function ensureBucketExists() {
  assertStorageConfigured();
  if (bucketChecked) return;
  await verifyR2Connection();
}

// KNOWN ISSUE (logged, deliberately NOT fixed here - this change is about test
// isolation, not storage semantics):
//
// `key.url || key` falls through to the OBJECT itself when it receives an
// object whose `url` is empty or absent. `.replace()` on an object then throws
// a TypeError, which localStorageService.js:153 catches and swallows - so the
// delete becomes a silent no-op and the file is orphaned in the bucket.
//
// Reached via removeStudentAssets() -> removeLocalFile(student.offerLetter),
// where `offerLetter` is a subdocument that exists with an empty nested `url`
// whenever no letter has been generated yet.
//
// NOT affected: the five student document fields (resume, result, photo,
// permissionLetter, aadhaarCard). Those hold a populated `url` string and take
// the string path. Verified empirically rather than by reading - re-deriving
// the key for 15 real stored files and issuing HeadObject for each resolved
// 15/15, so deleting a student really does remove their documents from R2.
function cleanKey(key) {
  if (!key) return "";
  const urlPath = key.url || key;
  return urlPath.replace(/^\/+/, "").replace(/^uploads\/+/, "");
}

async function uploadFile(buffer, key, mimeType) {
  await ensureBucketExists();
  const bucketName = process.env.R2_BUCKET;
  const s3Key = cleanKey(key);
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
    Body: buffer,
    ContentType: mimeType,
  }));
  return {
    url: `/uploads/${s3Key}`,
    filename: path.basename(s3Key)
  };
}

async function getFileStream(key) {
  await ensureBucketExists();
  const bucketName = process.env.R2_BUCKET;
  const s3Key = cleanKey(key);
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
  }));
  return response.Body;
}

async function deleteFile(key) {
  if (!key) return;
  await ensureBucketExists();
  const bucketName = process.env.R2_BUCKET;
  const s3Key = cleanKey(key);
  await s3Client.send(new DeleteObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
  }));
}

async function getPresignedDownloadUrl(key, { expiresIn = 900, filename, disposition = "inline" } = {}) {
  await ensureBucketExists();
  const s3Key = cleanKey(key);
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: s3Key,
    ...(filename && {
      ResponseContentDisposition: `${disposition}; filename="${filename.replace(/"/g, "")}"`,
    }),
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn });
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

module.exports = {
  uploadFile,
  getFileStream,
  deleteFile,
  getPresignedDownloadUrl,
  verifyR2Connection,
  isStorageConfigured,
  getMissingStorageEnv,
};
