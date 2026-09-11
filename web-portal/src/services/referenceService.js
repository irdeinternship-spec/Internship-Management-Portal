import { API_URL } from "../utils/apiUrl";

// Public, unauthenticated reference data (branches, courses, durations,
// states) for every dropdown in the app. Replaces the hardcoded lists that
// used to live in web-portal/src/data/ - those were a second source of truth
// the admin panel could not edit, which is why branches deleted through the
// admin screen kept appearing on the application form.

// Module-level promise cache. Several components mount at once on the
// registration form and the admin student screen; without this each one fires
// its own request for the same tiny payload. Caching the PROMISE (not the
// result) means concurrent callers share the single in-flight request rather
// than racing to start their own.
let inFlight = null;

export async function fetchReferenceData() {
  if (!inFlight) {
    inFlight = (async () => {
      const response = await fetch(`${API_URL}/reference`);
      if (!response.ok) {
        throw new Error("Unable to load form options.");
      }
      return response.json();
    })();

    // A failed request must not be cached, or the Retry button would keep
    // handing back the same rejected promise forever.
    inFlight.catch(() => {
      inFlight = null;
    });
  }

  return inFlight;
}

// Used by the Retry affordance: drops the cache so the next call really does
// hit the network again.
export function clearReferenceDataCache() {
  inFlight = null;
}
