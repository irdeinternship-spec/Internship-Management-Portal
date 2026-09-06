import { createDocumentUrl, readDocumentResponse } from "./documentFileService";
import { authHeader, clearToken, getToken, handleUnauthorized, setToken } from "./authSession";
import { API_URL as BASE_API_URL } from "../utils/apiUrl";

const API_URL = `${BASE_API_URL}/admin`;

export function getAdminToken() {
  return getToken("admin");
}

export function setAdminToken(token) {
  setToken("admin", token);
}

export function clearAdminToken() {
  clearToken("admin");
}

// Exported for the handful of page components that fetch /uploads/* files
// directly (not through this service) and need to attach the same header.
export function adminAuthHeader() {
  return authHeader("admin");
}

function authHeaders() {
  return adminAuthHeader();
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));

  if (response.status === 401) {
    handleUnauthorized("admin");
  }

  if (!response.ok) {
    throw new Error(body.message || "Admin request failed.");
  }

  return body;
}

export async function loginAdmin(credentials) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  return parseResponse(response);
}

export async function getAdminProfile() {
  const response = await fetch(`${API_URL}/auth/me`, {
    headers: authHeaders(),
  });

  return parseResponse(response);
}

export async function fetchAdminStudents(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) searchParams.set(key, value);
  });

  const response = await fetch(`${API_URL}/students?${searchParams}`, {
    headers: authHeaders(),
  });

  return parseResponse(response);
}

export async function fetchAdminStudent(id) {
  const response = await fetch(`${API_URL}/students/${id}`, {
    headers: authHeaders(),
  });

  return parseResponse(response);
}

export async function deleteAdminStudents(ids) {
  const response = await fetch(`${API_URL}/students`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ ids }),
  });

  return parseResponse(response);
}

export async function downloadAttendanceReportPdf(html) {
  const response = await fetch(`${API_URL}/attendance-report/pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ html }),
  });
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized("admin");
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Failed to generate PDF report.");
  }
  return readDocumentResponse(response);
}

export async function updateStudentReview(id, payload) {
  const response = await fetch(`${API_URL}/students/${id}/review`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  return parseResponse(response);
}

export async function saveTrainingManagement(id, payload) {
  const response = await fetch(`${API_URL}/students/${id}/training-management`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  return parseResponse(response);
}

export async function saveProformaConfig(payload) {
  const response = await fetch(`${API_URL}/administration/proforma`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  return parseResponse(response);
}

export async function fetchCertificateStudents(date = "", endpoint = "certificates") {
  const params = date ? `?date=${encodeURIComponent(date)}` : "";
  const response = await fetch(`${API_URL}/${endpoint}/students${params}`, {
    headers: authHeaders(),
  });

  return parseResponse(response);
}

export async function downloadCertificates(ids, endpoint = "certificates", renderMode = "full", signatureName = "", signatureDesignation = "") {
  const safeRenderMode = renderMode === "template" ? "template" : "full";
  const payload = {
    ids,
    renderMode: safeRenderMode,
    signatureName: signatureName || undefined,
    signatureDesignation: signatureDesignation || undefined,
  };
  const response = await fetch(`${API_URL}/${endpoint}/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) handleUnauthorized("admin");
    const error = new Error(body.message || "Certificate download failed.");
    error.status = response.status;
    error.response = body;
    throw error;
  }

  const blob = await readDocumentResponse(response);
  return {
    blob,
    filename:
  response.headers
    .get("content-disposition")
    ?.match(/filename="?([^";]+)"?/)?.[1] ||
  "DRDO-Certificate.pdf",
  };
}

export async function removeCertificateBufferStudents(ids) {
  const response = await fetch(`${API_URL}/certificate1/students`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  return parseResponse(response);
}

export async function uploadOfferLetter(id, file) {
  const formData = new FormData();
  formData.append("offerLetter", file);

  const response = await fetch(`${API_URL}/students/${id}/offer-letter`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });

  return parseResponse(response);
}

export async function fetchAdministration() {
  const response = await fetch(`${API_URL}/administration`, {
    headers: authHeaders(),
  });
  return parseResponse(response);
}

export async function addDivision(name) {
  const response = await fetch(`${API_URL}/administration/divisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  return parseResponse(response);
}

export async function renameDivision(name, newName) {
  const response = await fetch(`${API_URL}/administration/divisions/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name: newName }),
  });
  return parseResponse(response);
}

export async function removeDivision(name) {
  const response = await fetch(`${API_URL}/administration/divisions/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return parseResponse(response);
}

export async function updateTotalAllocatedSeats(paidSeatLimit, unpaidSeatLimit) {
  const response = await fetch(`${API_URL}/administration/seats`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ paidSeatLimit, unpaidSeatLimit }),
  });
  return parseResponse(response);
}

export async function fetchDivisionConfigurations() {
  const response = await fetch(`${API_URL}/administration/division-configurations`, { headers: authHeaders() });
  return parseResponse(response);
}

export async function saveDivisionConfigurations(configurations) {
  const response = await fetch(`${API_URL}/administration/division-configurations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ configurations }),
  });
  return parseResponse(response);
}

export async function fetchAdminColleges() {
  const response = await fetch(`${API_URL}/colleges`, { headers: authHeaders() });
  return parseResponse(response);
}

export async function addCollege(name) {
  const response = await fetch(`${API_URL}/colleges`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ name }),
  });
  return parseResponse(response);
}

export async function updateCollege(id, name) {
  const response = await fetch(`${API_URL}/colleges/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ name }),
  });
  return parseResponse(response);
}

export async function deleteCollege(id) {
  const response = await fetch(`${API_URL}/colleges/${id}`, { method: "DELETE", headers: authHeaders() });
  return parseResponse(response);
}

export async function fetchManagementItems(type) { const response = await fetch(`${API_URL}/management/${type}`, { headers: authHeaders() }); return parseResponse(response); }
export async function addManagementItem(type, name) { const response = await fetch(`${API_URL}/management/${type}`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ name }) }); return parseResponse(response); }
export async function updateManagementItem(type, id, name) { const response = await fetch(`${API_URL}/management/${type}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ name }) }); return parseResponse(response); }
export async function deleteManagementItem(type, id) { const response = await fetch(`${API_URL}/management/${type}/${id}`, { method: "DELETE", headers: authHeaders() }); return parseResponse(response); }

export async function changeAdminPassword(payload) {
  const response = await fetch(`${API_URL}/change-password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function createSubUser(payload) {
  const response = await fetch(`${API_URL}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function listSubUsers() {
  const response = await fetch(`${API_URL}/users`, {
    headers: authHeaders(),
  });
  return parseResponse(response);
}

export async function deleteSubUser(id) {
  const response = await fetch(`${API_URL}/users/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return parseResponse(response);
}

export async function createSubUserPassword(id, payload) {
  const response = await fetch(`${API_URL}/users/${id}/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function fetchUserActivityLog(id) {
  const response = await fetch(`${API_URL}/users/${id}/activity`, {
    headers: authHeaders(),
  });
  return parseResponse(response);
}

export async function downloadUserActivityExport(id, format) {
  const response = await fetch(`${API_URL}/users/${id}/activity/export?format=${format}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized("admin");
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Export failed.");
  }
  return response.blob();
}

export async function updateStudentDetails(id, formData) {
  const response = await fetch(`${API_URL}/students/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: formData,
  });

  return parseResponse(response);
}

export async function setupRecoveryInfo(payload) {
  const response = await fetch(`${API_URL}/auth/setup-recovery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function resetPasswordRecovery(payload) {
  const response = await fetch(`${API_URL}/auth/reset-password-recovery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function getSecurityQuestions() {
  const response = await fetch(`${API_URL}/auth/security-questions`, {
    headers: authHeaders(),
  });
  return parseResponse(response);
}

export async function saveSecurityQuestion(payload) {
  const response = await fetch(`${API_URL}/auth/security-questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function deleteSecurityQuestion(id) {
  const response = await fetch(`${API_URL}/auth/security-questions/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return parseResponse(response);
}

export async function getForgotPasswordQuestions(email) {
  const response = await fetch(`${API_URL}/auth/forgot-password-questions?email=${encodeURIComponent(email)}`);
  return parseResponse(response);
}

export async function resetPasswordQuestions(payload) {
  const response = await fetch(`${API_URL}/auth/reset-password-questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function updateNextCertificateNumber(nextCertificateNumber) {
  const response = await fetch(`${API_URL}/administration/certificate-number`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ nextCertificateNumber }),
  });
  return parseResponse(response);
}

export async function createPdfUrl(response) {
  let blob;
  if (response && response.data instanceof Blob) {
    blob = response.data;
  } else if (response instanceof Blob) {
    blob = response;
  } else if (response && typeof response.blob === "function") {
    blob = await response.blob();
  } else if (response && response.data) {
    blob = new Blob([response.data], { type: "application/pdf" });
  } else {
    blob = new Blob([response], { type: "application/pdf" });
  }
  if (!blob.size) throw new Error("Generated PDF is empty");
  return createDocumentUrl(blob);
}

export async function exportApplicationsExcel() {
  const response = await fetch(`${API_URL}/applications/export`, {
    headers: authHeaders(),
    credentials: "include",
  });

  if (!response.ok) {
    if (response.status === 401) handleUnauthorized("admin");
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || "Failed to download applications spreadsheet.");
  }

  const disposition = response.headers.get("Content-Disposition");
  let filename = `applications-${new Date().toISOString().slice(0, 10)}.xlsx`;
  if (disposition && disposition.includes("filename=")) {
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match && match[1]) filename = match[1];
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(downloadUrl);
}

