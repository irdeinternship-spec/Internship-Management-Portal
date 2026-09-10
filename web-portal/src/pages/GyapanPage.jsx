import { useEffect, useMemo, useState } from "react";
import { createGyapanPreview, fetchGyapanStudents } from "../services/gyapanService";
import "../styles/admin.css";

function GyapanPage({ bufferMode = false }) {
  const module = bufferMode ? "gyapan1" : "gyapan";
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    fetchGyapanStudents("", module)
      .then((response) => active && setStudents(response.students))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [module]);

  const visibleStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return students;
    return students.filter((student) => [student.name, student.referenceId, student.collegeName, student.branch, student.course]
      .some((value) => String(value || "").toLowerCase().includes(term)));
  }, [search, students]);
  const allVisibleSelected = visibleStudents.length > 0 && visibleStudents.every((student) => selected.includes(student._id));

  const toggle = (id, checked) => setSelected((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  const toggleAll = () => setSelected((current) => allVisibleSelected ? current.filter((id) => !visibleStudents.some((student) => student._id === id)) : [...new Set([...current, ...visibleStudents.map((student) => student._id)])]);

  const generate = async () => {
    if (!selected.length) return setError("Select at least one approved student.");
    const groups = selected.reduce((result, id) => {
      const student = students.find((item) => item._id === id);
      const division = student?.trainingManagement?.division?.trim();
      if (!division) return result;
      (result[division] ||= []).push(id);
      return result;
    }, {});
    const missingDivision = selected.filter((id) => !students.find((student) => student._id === id)?.trainingManagement?.division?.trim());
    if (missingDivision.length) return setError("Every selected student needs an allocated division before an ISM can be generated.");

    setBusy(true); setError("");
    try {
      const created = [];
      for (const ids of Object.values(groups)) {
        const response = await createGyapanPreview({ ids }, module);
        created.push(response.gyapan._id);
      }
      const queue = encodeURIComponent(created.join(","));
      window.history.pushState({}, "", `/admin/${module}/${created[0]}?queue=${queue}&index=0`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const back = () => { window.history.pushState({}, "", "/admin/approved-students"); window.dispatchEvent(new PopStateEvent("popstate")); };
  return <main className="admin-console admin-shell">
    <header className="admin-topbar"><div><p className="portal-eyebrow">Admin Panel</p><h1>Generate ISM</h1></div><button className="admin-secondary-btn" type="button" onClick={back}>Back to Dashboard</button></header>
    <section className="admin-panel">
      <div className="admin-actions-row"><label className="admin-field"><span>Search Approved Students</span><input type="search" placeholder="Name, application ID, college, branch, or course" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="admin-primary-btn" type="button" disabled={busy || !selected.length} onClick={generate}>{busy ? "Generating..." : `Generate ISM${selected.length ? ` (${selected.length})` : ""}`}</button></div>
      <p className="admin-muted">Select approved students. ISMs are automatically grouped by allocated division.</p>
      {error && <p className="admin-error">{error}</p>}
      {loading ? <div className="admin-loading">Loading approved students...</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} title="Select all listed students" /></th><th>Student Name</th><th>Application ID</th><th>Division</th><th>College</th><th>Branch</th><th>Course</th></tr></thead><tbody>{visibleStudents.map((student) => <tr key={student._id}><td><input type="checkbox" checked={selected.includes(student._id)} onChange={(event) => toggle(student._id, event.target.checked)} aria-label={`Select ${student.name}`} /></td><td>{student.name}</td><td>{student.referenceId || "-"}</td><td>{student.trainingManagement?.division || "-"}</td><td>{student.trainingManagement?.collegeName || student.collegeName || "-"}</td><td>{student.trainingManagement?.branch || student.branch || "-"}</td><td>{student.trainingManagement?.courseName || student.course || "-"}</td></tr>)}</tbody></table>{!visibleStudents.length && <div className="admin-empty-state">No approved students found.</div>}</div>}
    </section>
  </main>;
}
export default GyapanPage;
