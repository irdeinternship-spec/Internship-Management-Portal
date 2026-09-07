import { usePresignedUrl } from "../utils/presignedFile";

function GyapanViewer({ html, pdfUrl }) {
  const { url: presignedUrl, error } = usePresignedUrl(pdfUrl, "admin");

  if (pdfUrl) {
    if (error) {
      return <div className="admin-empty-state">{error}</div>;
    }
    if (!presignedUrl) {
      return <div className="admin-empty-state">Loading document…</div>;
    }
    return (
      <iframe
        id="gyapan-frame"
        className="offer-letter-viewer"
        title="Joining ISM PDF"
        src={presignedUrl}
      />
    );
  }

  return (
    <iframe
      id="gyapan-frame"
      className="offer-letter-viewer"
      title="Joining ISM preview"
      srcDoc={html || "<p>Preview unavailable.</p>"}
    />
  );
}

export default GyapanViewer;
