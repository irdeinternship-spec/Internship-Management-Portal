const apiUrl = import.meta.env.VITE_API_URL || "/api";
const backendUrl = apiUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");

// TODO(storage-migration): URLs from here are used both as plain <a href>/
// <iframe src> navigation (can't attach an Authorization header - those
// consumers rely solely on the cookie, which is unreliable cross-origin) and
// as fetch() targets (which do attach the header at their call site). The
// query-param token path this used to fall back on was intentionally removed
// server-side, so the plain-navigation consumers are deliberately left
// broken until files move to Cloudflare R2 and presigned GET URLs become the
// real fix - see the matching TODO on studentDocumentUrl() in
// services/studentService.js for the other half of this decision.
export function getUploadUrl(fileUrl) {
  if (!fileUrl || /^https?:\/\//i.test(fileUrl)) return fileUrl;

  return `${backendUrl}/${fileUrl.replace(/^\/+/, "")}`;
}
