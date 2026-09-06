// Single source of truth for auth token storage/attachment across both
// portals (admin + student). Tokens live in sessionStorage only - they die
// with the tab, which is the right lifetime for a portal holding student PII.
// Nothing outside this file should touch sessionStorage for a token, and no
// service should build an `Authorization` header by hand.

const API_URL = import.meta.env.VITE_API_URL || "/api";

const ROLES = {
  admin: {
    storageKey: "webPortalAdminToken",
    logoutUrl: `${API_URL}/admin/auth/logout`,
    changeEvent: "admin-auth-changed",
    loginPath: "/admin/login",
  },
  student: {
    storageKey: "webPortalStudentToken",
    logoutUrl: `${API_URL}/students/logout`,
    changeEvent: "student-auth-changed",
    loginPath: "/student/login",
  },
};

export function getToken(role) {
  return sessionStorage.getItem(ROLES[role].storageKey);
}

export function setToken(role, token) {
  sessionStorage.setItem(ROLES[role].storageKey, token);
  window.dispatchEvent(new Event(ROLES[role].changeEvent));
}

export function clearToken(role) {
  sessionStorage.removeItem(ROLES[role].storageKey);
  // Best-effort: also drop the httpOnly cookie server-side for same-origin
  // local dev. Fire-and-forget - the token is already gone client-side.
  fetch(ROLES[role].logoutUrl, { method: "POST" }).catch(() => {});
  window.dispatchEvent(new Event(ROLES[role].changeEvent));
}

export function authHeader(role) {
  const token = getToken(role);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Admin route protection (auth/AdminAuth.jsx + components/ProtectedRoute.jsx)
// already redirects to /admin/login exactly once on any state change: it's
// driven by React state off the "admin-auth-changed" event, so however many
// times clearToken("admin") fires, ProtectedRoute renders one <Navigate>.
// The student portal has no equivalent reactive guard, so 401s there need an
// explicit, guarded redirect - guarded so two 401s that land back-to-back
// (e.g. two in-flight requests failing together) don't both navigate.
let studentRedirecting = false;

export function handleUnauthorized(role) {
  clearToken(role);
  if (role !== "student") return;

  const { loginPath } = ROLES.student;
  if (studentRedirecting || window.location.pathname === loginPath) return;

  studentRedirecting = true;
  window.history.pushState({}, "", loginPath);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.setTimeout(() => {
    studentRedirecting = false;
  }, 0);
}
