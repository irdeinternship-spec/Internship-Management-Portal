import { usePresignAndOpen } from "../../utils/presignedFile";

function OfferLetterPreview({ student }) {
  const { open, busy, error } = usePresignAndOpen("admin");
  if (!student.offerLetterUrl) return null;

  return (
    <>
      <button
        type="button"
        className="admin-secondary-btn admin-link-button"
        onClick={() => open(student.offerLetterUrl)}
        disabled={busy}
      >
        {busy ? "Opening…" : "View Offer Letter"}
      </button>
      {error && <span className="admin-error">{error}</span>}
    </>
  );
}

export default OfferLetterPreview;
