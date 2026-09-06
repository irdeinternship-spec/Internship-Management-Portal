// Single source of truth for the backend API base URL. Every service module
// imports API_URL from here instead of reading import.meta.env.VITE_API_URL
// itself - a missed spot would silently fall back to "/api", which resolves
// against Vercel's own domain (no backend there) and produces confusing
// "unexpected token '<'" JSON-parse errors on every request instead of a
// clear misconfiguration signal.
const rawApiUrl = import.meta.env.VITE_API_URL;

if (import.meta.env.PROD && !rawApiUrl) {
  throw new Error(
    "VITE_API_URL is not set — set it in the Vercel project and redeploy."
  );
}

// "/api" is a dev-only fallback: same-origin against the Vite dev server's
// proxy. It must never be reached in a production build - the check above
// guarantees that.
export const API_URL = rawApiUrl || "/api";
