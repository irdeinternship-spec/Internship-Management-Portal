import { useEffect, useMemo, useState } from "react";
import { downloadCertificates, fetchCertificateStudents } from "../services/adminService";
import "../styles/admin.css";

const CERTIFICATE_DOWNLOADS_KEY = "drdoCertificateDownloadedStudentIds";

function savedCertificateDownloadIds() {
  try {
    const value = JSON.parse(localStorage.getItem(CERTIFICATE_DOWNLOADS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function Certificates({ bufferMode = false }) {
  const endpoint = bufferMode ? "certificate1" : "certificates";
  const [students, setStudents] = useState([]), [selectedIds, setSelectedIds] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [search, setSearch] = useState(""), [batch, setBatch] = useState(null), [preview, setPreview] = useState(null), [downloadedIds, setDownloadedIds] = useState(savedCertificateDownloadIds), [outputChoiceOpen, setOutputChoiceOpen] = useState(false);

  const [signature, setSignature] = useState(null);
  const [signatureDraft, setSignatureDraft] = useState({ name: "VAIBHAV GUPTA", designation: "TECHNICAL OFFICER 'C'" });
  const [signatureEditorOpen, setSignatureEditorOpen] = useState(false);
  const [signatureError, setSignatureError] = useState("");

  useEffect(() => { let active = true; fetchCertificateStudents("", endpoint).then((response) => active && setStudents(response.students)).catch((err) => active && setError(err.message)).finally(() => active && setLoading(false)); return () => { active = false; }; }, [endpoint]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  const visibleStudents = useMemo(() => { const term = search.trim().toLowerCase(); return term ? students.filter((student) => [student.name, student.referenceId, student.collegeName, student.branch, student.course].some((value) => String(value || "").toLowerCase().includes(term))) : students; }, [search, students]);
  const allSelected = visibleStudents.length > 0 && visibleStudents.every((student) => selectedIds.includes(student._id));
  const toggle = (id, checked) => setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  const toggleAll = () => setSelectedIds((current) => allSelected ? current.filter((id) => !visibleStudents.some((student) => student._id === id)) : [...new Set([...current, ...visibleStudents.map((student) => student._id)])]);
  const back = () => { window.history.pushState({}, "", "/admin/approved-students"); window.dispatchEvent(new PopStateEvent("popstate")); };
  const start = () => { if (!selectedIds.length) return setError("Select at least one approved student."); setError(""); setOutputChoiceOpen(true); };
  const chooseOutput = (renderMode) => { setOutputChoiceOpen(false); setSignature(null); setBatch({ ids: [...selectedIds], index: 0, renderMode }); };
  const currentStudent = batch && students.find((student) => student._id === batch.ids[batch.index]);
  const prepare = async () => {
    if (!currentStudent) return; setBusy(true); setError("");
    try {
      const { blob, filename } = await downloadCertificates(
        [currentStudent._id],
        endpoint,
        batch.renderMode,
        signature?.name || "",
        signature?.designation || ""
      );
      setPreview({ url: URL.createObjectURL(blob), filename });
    }
    catch (err) {
      const detail = import.meta.env.DEV ? ` Error: ${err.message}` : "";
      setError(`Unable to generate certificate for ${currentStudent.name}.${detail}`);
    }
    finally { setBusy(false); }
  };
  const download = () => {
    if (!preview) return;
    const link = document.createElement("a");
    link.href = preview.url;
    const refId = currentStudent.referenceId || "UNKNOWN";
    const nameNoSpaces = (currentStudent.name || "Student").replace(/\s+/g, "");
    link.download = `Certificate_${refId}_${nameNoSpaces}.pdf`;
    link.click();
    setDownloadedIds((current) => {
      const next = [...new Set([...current, currentStudent._id])];
      localStorage.setItem(CERTIFICATE_DOWNLOADS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const print = () => { const frame = document.getElementById("certificate-preview-frame"); frame?.contentWindow?.print(); };
  const resetCertificateOperation = () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null); setSignatureEditorOpen(false); setSignatureError(""); };
  const next = () => { if (!batch) return; if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null); setSignatureEditorOpen(false); setSignatureError(""); if (batch.index + 1 >= batch.ids.length) { setBatch(null); setSelectedIds([]); setSignature(null); } else setBatch((current) => ({ ...current, index: current.index + 1 })); };
  const openSignatureEditor = () => { setSignatureDraft(signature || { name: "VAIBHAV GUPTA", designation: "TECHNICAL OFFICER 'C'" }); setSignatureError(""); setSignatureEditorOpen(true); };
  const saveSignature = () => {
    const name = signatureDraft.name.trim();
    const designation = signatureDraft.designation.trim();
    if (!name) {
      setSignatureError("Name is required.");
      return;
    }
    if (!designation) {
      setSignatureError("Designation is required.");
      return;
    }
    setSignature({ name, designation });
    setSignatureEditorOpen(false);
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  return <main className="admin-console admin-shell">
    <header className="admin-topbar"><div><p className="portal-eyebrow">Admin Panel</p><h1>Generate Certificate</h1></div><button className="admin-secondary-btn" type="button" onClick={back}>Back to Dashboard</button></header>
    <section className="admin-panel"><div className="admin-actions-row"><label className="admin-field"><span>Search Approved Students</span><input type="search" placeholder="Name, application ID, college, branch, or course" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="admin-primary-btn" type="button" disabled={!selectedIds.length} onClick={start}>Generate Certificate{selectedIds.length ? ` (${selectedIds.length})` : ""}</button></div><p className="admin-muted">Select approved students to generate one certificate for each student.</p>{error && <p className="admin-error">{error}</p>}
      {loading ? <div className="admin-loading">Loading approved students...</div> : <div className="admin-table-wrap"><table className="admin-table certificates-table"><thead><tr><th><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all listed students" /></th><th>Application ID</th><th>Student Name</th><th>College Name</th><th>Course</th><th>Branch</th><th>Certificate Status</th></tr></thead><tbody>{visibleStudents.map((student) => <tr key={student._id} className={downloadedIds.includes(student._id) ? "certificate-downloaded-row" : ""}><td><input type="checkbox" checked={selectedIds.includes(student._id)} onChange={(event) => toggle(student._id, event.target.checked)} aria-label={`Select ${student.name}`} /></td><td>{student.referenceId || "-"}</td><td>{student.name}</td><td>{student.trainingManagement?.collegeName || student.collegeName || "-"}</td><td>{student.trainingManagement?.courseName || student.course || "-"}</td><td>{student.trainingManagement?.branch || student.branch || "-"}</td><td>{downloadedIds.includes(student._id) ? "Certificate Downloaded" : "-"}</td></tr>)}</tbody></table>{!visibleStudents.length && <div className="admin-empty-state">No approved students found.</div>}</div>}
    </section>
    {outputChoiceOpen && <div className="certificate-modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose certificate output"><section className="certificate-modal"><h2>Choose Certificate Output</h2><p className="admin-muted">Select how the certificate should be generated.</p><div className="admin-actions-row"><button className="admin-primary-btn" type="button" onClick={() => chooseOutput("full")}>Generate Certificate</button><button className="admin-secondary-btn" type="button" onClick={() => chooseOutput("template")}>Print on Template</button></div></section></div>}
    {currentStudent && <div className="certificate-modal-backdrop" role="dialog" aria-modal="true" aria-label="Certificate workflow"><section className="certificate-modal certificate-modal--wide"><h2>{batch.renderMode === "template" ? "Print on Template" : "Certificate"} {batch.index + 1} of {batch.ids.length}</h2><p style={{ margin: "4px 0" }}>Student: <strong>{currentStudent.name}</strong></p>

      {preview ? <iframe id="certificate-preview-frame" title={`Certificate preview for ${currentStudent.name}`} src={preview.url} className="certificate-preview-frame" /> : <p className="admin-muted">Prepare this certificate to preview, print, or download it.</p>}<div className="admin-actions-row">{!preview ? <button className="admin-primary-btn" type="button" disabled={busy} onClick={prepare}>{busy ? "Generating..." : "Preview Certificate"}</button> : <><button className="admin-secondary-btn" type="button" onClick={print}>Print</button><button className="admin-primary-btn" type="button" onClick={download}>Download</button><button className="admin-secondary-btn" type="button" disabled={busy} onClick={openSignatureEditor}>Edit</button></>}<button className="admin-secondary-btn" type="button" onClick={next}>{batch.index + 1 === batch.ids.length ? "Finish" : "Next Certificate"}</button><button className="admin-secondary-btn" type="button" disabled={busy} onClick={() => { resetCertificateOperation(); setSignature(null); setBatch(null); }}>Close</button></div></section></div>}
    {signatureEditorOpen && <div className="certificate-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit authorized officer"><form className="certificate-modal" onSubmit={(event) => { event.preventDefault(); saveSignature(); }}><h2>Edit Authorized Officer</h2><label className="admin-field"><span>Name</span><input autoFocus value={signatureDraft.name} onChange={(event) => setSignatureDraft((current) => ({ ...current, name: event.target.value }))} /></label><label className="admin-field"><span>Designation</span><input value={signatureDraft.designation} onChange={(event) => setSignatureDraft((current) => ({ ...current, designation: event.target.value }))} /></label>{signatureError && <p className="admin-error" style={{ color: "red" }}>{signatureError}</p>}<div className="admin-actions-row"><button className="admin-primary-btn" type="submit">Save</button><button className="admin-secondary-btn" type="button" onClick={() => setSignatureEditorOpen(false)}>Cancel</button></div></form></div>}
  </main>;
}
export default Certificates;
