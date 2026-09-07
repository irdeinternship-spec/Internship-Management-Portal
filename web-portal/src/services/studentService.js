import axios from "axios";
import { authHeader, handleUnauthorized } from "./authSession";
import { API_URL } from "../utils/apiUrl";

function studentAuthHeader() {
  return authHeader("student");
}

// -------------------- Colleges --------------------

export async function fetchColleges() {
  const response = await axios.get(`${API_URL}/colleges`);
  return response.data;
}

// -------------------- Common --------------------

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));

  if (response.status === 401) {
    handleUnauthorized("student");
  }

  if (!response.ok || body.success === false) {
    throw new Error(body.message || "Student request failed.");
  }

  return body;
}

// -------------------- Student Registration --------------------

export async function submitStudentRegistration(formData) {
  const response = await fetch(`${API_URL}/students`, {
    method: "POST",
    body: formData,
  });

  return parseResponse(response);
}

export async function loginStudent(credentials) {
  const response = await fetch(`${API_URL}/students/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });

  return parseResponse(response);
}

export async function fetchStudentDashboard() {
  const response = await fetch(`${API_URL}/students/dashboard`, {
    headers: studentAuthHeader(),
  });

  return parseResponse(response);
}

// Declaration/character certificate PDFs are generated on request by
// Puppeteer, not stored in R2 - there's no object here to presign. The
// caller must fetch this with an Authorization header (see FileLink's
// download branch in StudentDashboard.jsx), not navigate to it directly.
export function studentDocumentUrl(type) {
  return `${API_URL}/students/documents/${type}`;
}

export async function uploadCompletedDocuments(file) {
  const formData = new FormData();
  formData.append("completedDocuments", file);

  const response = await fetch(
    `${API_URL}/students/completed-documents`,
    {
      method: "POST",
      headers: studentAuthHeader(),
      body: formData,
    }
  );

  return parseResponse(response);
}

export async function savePaidInternshipProjectDetails(details) {
  const response = await fetch(`${API_URL}/students/paid-project-details`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...studentAuthHeader(),
    },
    body: JSON.stringify(details),
  });

  return parseResponse(response);
}
