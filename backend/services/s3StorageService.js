const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand } = require("@aws-sdk/client-s3");
const path = require("path");

const endpoint = process.env.MINIO_USE_SSL === "true"
  ? `https://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`
  : `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`;

const s3Client = new S3Client({
  endpoint,
  region: process.env.MINIO_REGION,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Storage (MinIO today, R2 later) is an optional subsystem: production must
// still boot without it configured, with upload/download routes responding
// 503 instead of the app failing to start or a route 500ing on a raw AWS SDK
// error. Every exported function below asserts configuration first.
const STORAGE_ENV_KEYS = ["MINIO_ENDPOINT", "MINIO_PORT", "MINIO_REGION", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET"];

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
async function verifyMinioConnection() {
  const bucketName = process.env.MINIO_BUCKET;
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log("✅ MinIO connected");
    console.log(`✅ MinIO bucket ready: ${bucketName}`);
    bucketChecked = true;
  } catch (error) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      console.log("✅ MinIO connected");
      console.log(`Bucket ${bucketName} not found. Creating bucket...`);
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`✅ MinIO bucket ready: ${bucketName}`);
      bucketChecked = true;
    } else {
      console.error(`❌ MinIO connection failed: Unable to connect to S3/MinIO server at ${endpoint}. Error: ${error.message}`);
      throw error;
    }
  }
}

async function ensureBucketExists() {
  assertStorageConfigured();
  if (bucketChecked) return;
  await verifyMinioConnection();
}

function cleanKey(key) {
  if (!key) return "";
  const urlPath = key.url || key;
  return urlPath.replace(/^\/+/, "").replace(/^uploads\/+/, "");
}

async function uploadFile(buffer, key, mimeType) {
  await ensureBucketExists();
  const bucketName = process.env.MINIO_BUCKET;
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
  const bucketName = process.env.MINIO_BUCKET;
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
  const bucketName = process.env.MINIO_BUCKET;
  const s3Key = cleanKey(key);
  await s3Client.send(new DeleteObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
  }));
}

module.exports = {
  uploadFile,
  getFileStream,
  deleteFile,
  verifyMinioConnection,
  isStorageConfigured,
  getMissingStorageEnv,
};
