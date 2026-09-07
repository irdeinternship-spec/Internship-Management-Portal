import { useEffect, useState } from "react";
import OfferLetterViewer from "../components/OfferLetterViewer";
import {
  downloadOfferLetterPdf,
  getOfferLetter,
  sendOfferLetter,
} from "../services/offerLetterService";
import { getPresignedFileUrl } from "../utils/presignedFile";
import { readDocumentResponse } from "../services/documentFileService";
import "../styles/admin.css";

function OfferLetterPreview({ studentId }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadPreview() {
      setLoading(true);
      setError("");

      try {
        const response = await getOfferLetter(studentId);
        if (!ignore) setPreview(response);
      } catch (err) {
        if (!ignore) setError(err.message);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadPreview();

    return () => {
      ignore = true;
    };
  }, [studentId]);

  const goBack = () => {
    window.history.pushState({}, "", `/admin/students/${studentId}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const openEditor = () => {
    window.history.pushState({}, "", `/admin/students/${studentId}/offer-letter/edit`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const handleDownload = async () => {
    setBusy("download");
    setError("");
    setMessage("");

    try {
      const blob = await downloadOfferLetterPdf(studentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const refId = (preview?.student?.referenceId || "UNKNOWN").replace(/[^a-zA-Z0-9_-]/g, "");
      const nameNoSpaces = (preview?.student?.name || "Student").replace(/\s+/g, "").replace(/[^a-zA-Z0-9_-]/g, "");
      link.download = `OfferLetter_${refId}_${nameNoSpaces}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const handleDownloadUploaded = async () => {
    if (!preview?.pdfUrl) return;
    setBusy("download");
    setError("");
    setMessage("");
    try {
      const presignedUrl = await getPresignedFileUrl(preview.pdfUrl, "admin");
      const response = await fetch(presignedUrl);
      const blob = await readDocumentResponse(response);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const refId = (preview?.student?.referenceId || "UNKNOWN").replace(/[^a-zA-Z0-9_-]/g, "");
      const nameNoSpaces = (preview?.student?.name || "Student").replace(/\s+/g, "").replace(/[^a-zA-Z0-9_-]/g, "");
      link.download = `OfferLetter_${refId}_${nameNoSpaces}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Failed to download PDF.");
    } finally {
      setBusy("");
    }
  };

  const handleSend = async () => {
    setBusy("send");
    setError("");
    setMessage("");

    try {
      const response = await sendOfferLetter(studentId);
      setPreview((current) => ({ ...current, student: response.student }));
      setMessage(response.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <main className="admin-console admin-shell">
        <div className="admin-loading">Loading Offer Letter preview...</div>
      </main>
    );
  }

  return (
    <main className="admin-console admin-shell">
      <header className="admin-topbar">
        <div>
          <p className="portal-eyebrow">Offer Letter Preview</p>
          <h1>{preview?.student?.name || "Offer Letter"}</h1>
        </div>
        <button className="admin-secondary-btn" type="button" onClick={goBack}>
          Back to Student
        </button>
      </header>

      <section className="details-section">
        <div className="offer-letter-actions">
          <button className="admin-secondary-btn" type="button" onClick={openEditor}>
            Edit
          </button>
          <button
            className="admin-secondary-btn"
            disabled={busy === "download" || preview?.uploadType === "Uploaded"}
            type="button"
            onClick={handleDownload}
          >
            {busy === "download" ? "Preparing..." : "Download PDF"}
          </button>
          {preview?.uploadType === "Uploaded" && preview?.pdfUrl && (
            <button className="admin-secondary-btn" type="button" onClick={handleDownloadUploaded}>
              Download PDF
            </button>
          )}
          <button className="admin-primary-btn" disabled={busy === "send"} type="button" onClick={handleSend}>
            {busy === "send" ? "Sending..." : "Send Offer Letter"}
          </button>
        </div>

        {error && <p className="admin-error">{error}</p>}
        {message && <p className="admin-success">{message}</p>}

        <OfferLetterViewer
          html={preview?.html}
          pdfUrl={preview?.pdfUrl}
          uploadType={preview?.uploadType}
        />
      </section>
    </main>
  );
}

export default OfferLetterPreview;
