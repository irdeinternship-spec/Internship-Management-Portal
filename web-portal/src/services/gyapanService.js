import { adminAuthHeader } from "./adminService";
import { handleUnauthorized } from "./authSession";

const API_BASE = `${import.meta.env.VITE_API_URL || "/api"}/admin`;
const headers = () => ({ ...adminAuthHeader(), "Content-Type": "application/json" });
async function parse(response) { const body = await response.json().catch(() => ({})); if (response.status === 401) handleUnauthorized("admin"); if (!response.ok) throw new Error(body.message || "Gyapan request failed."); return body; }
const apiUrl = (module = "gyapan") => `${API_BASE}/${module}`;
export async function fetchGyapanStudents(date = "", module = "gyapan", search = "") { const params = new URLSearchParams(); if (date) params.set("date", date); if (search) params.set("search", search); const query = params.toString(); return parse(await fetch(`${apiUrl(module)}/students${query ? `?${query}` : ""}`, { headers: headers() })); }
export async function createGyapanPreview(payload, module = "gyapan") { return parse(await fetch(`${apiUrl(module)}/preview`, { method: "POST", headers: headers(), body: JSON.stringify(payload) })); }
export async function getGyapan(id, module = "gyapan") { return parse(await fetch(`${apiUrl(module)}/${id}`, { headers: headers() })); }
export async function updateGyapan(id, payload, module = "gyapan") { return parse(await fetch(`${apiUrl(module)}/${id}/edit`, { method: "PUT", headers: headers(), body: JSON.stringify(payload) })); }
export async function generateGyapanPdf(id, module = "gyapan") { return parse(await fetch(`${apiUrl(module)}/${id}/generate`, { method: "POST", headers: headers() })); }
export async function removeGyapanBufferStudents(ids) { return parse(await fetch(`${apiUrl("gyapan1")}/students`, { method: "DELETE", headers: headers(), body: JSON.stringify({ ids }) })); }
