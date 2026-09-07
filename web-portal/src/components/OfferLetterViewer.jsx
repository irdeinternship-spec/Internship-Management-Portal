import { usePresignedUrl } from "../utils/presignedFile";

function OfferLetterViewer({ html, pdfUrl, uploadType }) {
  const shouldPresign = uploadType === "Uploaded" && Boolean(pdfUrl);
  const { url: presignedUrl, error } = usePresignedUrl(shouldPresign ? pdfUrl : null, "admin");

  if (shouldPresign) {
    if (error) {
      return <div className="admin-empty-state">{error}</div>;
    }
    if (!presignedUrl) {
      return <div className="admin-empty-state">Loading document…</div>;
    }
    return (
      <div className="offer-letter-viewer">
        <iframe title="Uploaded Offer Letter" src={presignedUrl} />
      </div>
    );
  }

  if (!html) {
    return (
      <div className="admin-empty-state">
        Generate or upload an Offer Letter to preview it here.
      </div>
    );
  }

  return (
    <div className="offer-letter-viewer">
      <iframe title="Generated Offer Letter" srcDoc={html} />
    </div>
  );
}

export default OfferLetterViewer;
