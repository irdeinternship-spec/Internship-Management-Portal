import { useEffect, useState } from "react";
import { API_URL } from "./apiUrl";
import { authHeader, handleUnauthorized } from "../services/authSession";

/**
 * Resolves a stored relative file path (e.g. "/uploads/students/ABC123/
 * photo/xyz.jpg", exactly as it comes back on a student/gyapan record) to a
 * fresh, time-boxed presigned R2 URL via GET /api/files/presign. Every call
 * is a live round-trip - never cache the result across renders or reuse an
 * old one, since a 15-minute-old link will 403 on fetch/open.
 *
 * `key` must be sent to the backend byte-for-byte as stored (including the
 * leading "/uploads/") - the backend's ownership check is an exact-equality
 * match against the same field, not a prefix/suffix match.
 *
 * `role` is "admin" or "student" - picks which session's Authorization
 * header to attach. `download: true` asks for an attachment
 * Content-Disposition instead of inline.
 */
export async function getPresignedFileUrl(fileUrl, role, { download = false } = {}) {
  if (!fileUrl) return null;
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl; // already absolute - nothing to presign

  const params = new URLSearchParams({ key: fileUrl });
  if (download) params.set("download", "1");

  const response = await fetch(`${API_URL}/files/presign?${params.toString()}`, {
    headers: authHeader(role),
  });
  const body = await response.json().catch(() => ({}));

  if (response.status === 401) handleUnauthorized(role);
  if (!response.ok || body.success === false) {
    throw new Error(body.message || "Could not get a download link for this file.");
  }

  return body.url;
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes - comfortably inside the 15-minute expiry

/**
 * For content that stays mounted and rendered for a while - an <iframe>
 * embedding a PDF - rather than being resolved once at the moment of use.
 * Proactively refreshes the presigned URL on an interval instead of
 * reacting to a failure, and that's a deliberate choice, not the simpler
 * default: a failure here can't actually be detected. The iframe's src
 * points at a different origin (*.r2.cloudflarestorage.com), so this page
 * can't read that cross-origin response's status - browsers block it via
 * the same-origin policy - and <iframe onError> only fires for
 * network-level failures (DNS, connection refused), never HTTP error
 * statuses. An expired presigned URL still "loads" successfully as far as
 * the DOM and the iframe are concerned; it just renders R2's XML error body
 * with no signal that reaches this component. So there's nothing to retry
 * on - the only way to keep an iframe-embedded document valid across
 * however long the tab stays open is to refresh the URL before it can ever
 * expire, not after it fails. (Lazy, click-triggered uses of
 * getPresignedFileUrl above don't need this: the whole fetch-then-open
 * happens within seconds, nowhere near the 15-minute window.)
 */
export function usePresignedUrl(fileUrl, role) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!fileUrl) return undefined;

    let cancelled = false;

    async function refresh() {
      try {
        const fresh = await getPresignedFileUrl(fileUrl, role);
        if (!cancelled) {
          setUrl(fresh);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [fileUrl, role]);

  // No fileUrl means nothing to show - derive this at render time instead of
  // syncing it into state from the effect above (avoids an extra render).
  if (!fileUrl) return { url: null, error: "" };
  return { url, error };
}

/**
 * For a click-triggered "View X" link/button: resolves a fresh presigned
 * URL at the moment of the click and opens it in a new tab. No expiry
 * handling needed here (unlike usePresignedUrl above) - the whole
 * fetch-then-open happens within seconds of the click, nowhere near the
 * 15-minute window, and a failure is directly visible in the button's own
 * state instead of needing to be inferred.
 */
export function usePresignAndOpen(role) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open(fileUrl) {
    setBusy(true);
    setError("");
    try {
      const url = await getPresignedFileUrl(fileUrl, role);
      if (url) window.open(url, "_blank", "noreferrer");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return { open, busy, error };
}
