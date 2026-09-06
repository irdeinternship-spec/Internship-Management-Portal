import { useEffect, useState } from "react";
import GyapanViewer from "../components/GyapanViewer";
import { generateGyapanPdf, getGyapan } from "../services/gyapanService";
import { getUploadUrl } from "../utils/uploadUrl";
import { adminAuthHeader, fetchAdminStudent } from "../services/adminService";
import { assertDownloadOk } from "../services/documentFileService";
import "../styles/admin.css";
function GyapanPreview({ gyapanId, bufferMode = false }) {
  const module = bufferMode ? "gyapan1" : "gyapan";
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const queue = new URLSearchParams(window.location.search).get("queue")?.split(",").filter(Boolean) || [];
  const queueIndex = Number(new URLSearchParams(window.location.search).get("index") || 0);
  const hasNext = queueIndex + 1 < queue.length;
  useEffect(() => {
    getGyapan(gyapanId, module)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [gyapanId, module]);
  const back = () => {
    if (hasNext) {
      const nextIndex = queueIndex + 1;
      window.history.pushState({}, "", `/admin/${module}/${queue[nextIndex]}?queue=${encodeURIComponent(queue.join(","))}&index=${nextIndex}`);
    } else {
      window.history.pushState({}, "", `/admin/${module}`);
    }
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const edit = () => {
    window.history.pushState({}, "", `/admin/${module}/${gyapanId}/edit`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await generateGyapanPdf(gyapanId, module);
      setData((current) => ({
        ...current,
        gyapan: next.gyapan,
        html: next.gyapan.html,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const printPreview = () => {
    const frame = document.getElementById("gyapan-frame");
    if (!frame) return;

    const printDocument = () => {
      if (frame.contentDocument && !frame.contentDocument.getElementById("ism-print-fit")) {
        const style = frame.contentDocument.createElement("style");
        style.id = "ism-print-fit";
        style.textContent = "@media print { .document-container { min-height: 297mm !important; } .cc-section { margin-bottom: 0 !important; } .system-footer { position: absolute !important; left: 20mm !important; right: 20mm !important; bottom: 10mm !important; width: auto !important; margin: 0 !important; } }";
        frame.contentDocument.head.appendChild(style);
      }
      frame.contentWindow?.print();
    };
    if (frame.contentDocument?.readyState === "complete") {
      printDocument();
    } else {
      frame.addEventListener("load", printDocument, { once: true });
    }
  };

  const handleDownloadPdf = async () => {
    if (!data?.gyapan?.pdfUrl) return;
    setBusy(true);
    setError("");
    try {
      const firstStudentId = data.gyapan.selectedStudents?.[0];
      let refId = "UNKNOWN";
      let studentName = "Student";
      if (firstStudentId) {
        try {
          const { student } = await fetchAdminStudent(firstStudentId);
          if (student) {
            refId = student.referenceId || "UNKNOWN";
            studentName = student.name || "Student";
          }
        } catch (err) {
          console.error("Failed to fetch student details for download naming", err);
        }
      }

      const response = await fetch(getUploadUrl(data.gyapan.pdfUrl), { headers: adminAuthHeader() });
      await assertDownloadOk(response, "admin");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const nameNoSpaces = studentName.replace(/\s+/g, "");
      link.download = `ISM_${refId}_${nameNoSpaces}.pdf`;
      link.click();
      URL.revokeObjectURL(url);

      const studentIds = data.gyapan?.selectedStudents || [];
      if (studentIds.length) {
        try {
          const key = "drdoIsmDownloadedStudentIds";
          const current = JSON.parse(localStorage.getItem(key) || "[]");
          const next = [...new Set([...current, ...studentIds])];
          localStorage.setItem(key, JSON.stringify(next));
        } catch (err) {
          console.error("Failed to save downloaded ISM IDs to local storage", err);
        }
      }
    } catch (err) {
      setError(err.message || "Failed to download PDF.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (data) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("print") === "true") {
        printPreview();
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }
    }
  }, [data]);

  if (!data && !error)
    return (
      <main className="admin-console admin-shell">
        <div className="admin-loading">Loading Joining ISM preview...</div>
      </main>
    );
  return (
    <main className="admin-console admin-shell">
      <header className="admin-topbar">
        <div>
          <p className="portal-eyebrow">Joining ISM Preview</p>
          <h1>{data?.gyapan?.letterNumber || "Joining ISM"}</h1>
        </div>
        <button className="admin-secondary-btn" type="button" onClick={back}>
          {hasNext ? "Next ISM" : "Back"}
        </button>
      </header>
      <section className="details-section">
        <div className="offer-letter-actions">
          <button className="admin-secondary-btn" type="button" onClick={edit}>
            Edit
          </button>
          {data?.gyapan?.pdfUrl ? (
            <button
              className="admin-secondary-btn"
              type="button"
              disabled={busy}
              onClick={handleDownloadPdf}
            >
              {busy ? "Preparing..." : "Download"}
            </button>
          ) : (
            <button
              className="admin-secondary-btn"
              type="button"
              onClick={printPreview}
            >
              Print
            </button>
          )}
          <button
            className="admin-primary-btn"
            type="button"
            disabled={busy || data?.gyapan?.generated}
            onClick={generate}
          >
            {data?.gyapan?.generated
              ? "Final PDF Generated"
              : busy
                ? "Generating PDF..."
                : "Generate Final PDF"}
          </button>
          {hasNext && (
            <button className="admin-secondary-btn" type="button" onClick={back}>
              Next ISM
            </button>
          )}
        </div>
        {error && <p className="admin-error">{error}</p>}
        <GyapanViewer html={data?.html} pdfUrl={data?.gyapan?.pdfUrl} />
      </section>
    </main>
  );
}
export default GyapanPreview;
