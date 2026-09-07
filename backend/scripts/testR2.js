#!/usr/bin/env node
// Proves R2 credentials/bucket/endpoint work before deploying - standalone,
// no Express or Mongo needed. Uploads a small throwaway object, generates a
// presigned URL, downloads it back and checks the bytes match, deletes it,
// then confirms the delete actually took effect.
require("dotenv").config();

const {
  uploadFile,
  getFileStream,
  deleteFile,
  getPresignedDownloadUrl,
  isStorageConfigured,
  getMissingStorageEnv,
} = require("../services/s3StorageService");

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main() {
  if (!isStorageConfigured()) {
    console.error(`❌ R2 is not configured. Missing: ${getMissingStorageEnv().join(", ")}`);
    process.exit(1);
  }

  const testKey = `_test/r2-connectivity-${Date.now()}.txt`;
  const original = Buffer.from(`R2 connectivity test @ ${new Date().toISOString()}`);

  try {
    console.log(`1/5 Uploading test object: ${testKey}`);
    await uploadFile(original, testKey, "text/plain");

    console.log("2/5 Generating presigned URL...");
    const { url, expiresAt } = await getPresignedDownloadUrl(testKey, { expiresIn: 60 });
    console.log(`    Presigned URL expires at ${expiresAt}`);

    console.log("3/5 Fetching presigned URL and comparing bytes...");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Presigned URL fetch failed: ${response.status} ${response.statusText}`);
    }
    const downloaded = Buffer.from(await response.arrayBuffer());
    if (!downloaded.equals(original)) {
      throw new Error("Downloaded bytes do not match uploaded bytes.");
    }

    console.log("4/5 Deleting test object...");
    await deleteFile(testKey);

    console.log("5/5 Verifying deletion...");
    try {
      await streamToBuffer(await getFileStream(testKey));
      throw new Error("Object still exists after delete - deletion did not take effect.");
    } catch (err) {
      const isNotFound =
        err.name === "NoSuchKey" ||
        err.name === "NotFound" ||
        err.$metadata?.httpStatusCode === 404;
      if (!isNotFound) throw err;
    }

    console.log(
      "\n✅ R2 connectivity test passed: upload, presign, download-byte-match, delete, delete-verify all succeeded."
    );
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ R2 connectivity test FAILED: ${error.message}`);
    process.exit(1);
  }
}

main();
