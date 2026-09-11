import { useCallback, useEffect, useState } from "react";
import { clearReferenceDataCache, fetchReferenceData } from "../services/referenceService";

const EMPTY = [];

// Single entry point for reference dropdown options.
//
// Returns name arrays (not {id,name} objects) because every consumer binds
// dropdowns to the NAME - that is what student records actually store
// (student.branch, student.course and collegeState are plain strings, never
// foreign keys). `courseOptions` keeps the full objects so the course level
// is available to the caller that will need it next.
//
// Callers MUST render the loading and error states. An empty dropdown reads
// to an applicant as "there are no branches", which is worse than an error.
export function useReferenceData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError("");

    fetchReferenceData()
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setError("Couldn't load the form options. Check your connection and try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(load, [load]);

  const retry = useCallback(() => {
    clearReferenceDataCache();
    load();
  }, [load]);

  const names = (key) => (data?.[key] ? data[key].map((item) => item.name) : EMPTY);

  return {
    branches: names("branches"),
    courses: names("courses"),
    durations: names("durations"),
    states: names("states"),
    courseOptions: data?.courses || EMPTY,
    loading,
    error,
    retry,
  };
}

export default useReferenceData;
