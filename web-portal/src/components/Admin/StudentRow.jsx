import { memo, useState } from "react";
import StatusBadge from "./StatusBadge";
import { updateStudentReview } from "../../services/adminService";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN");
}

function StatusDropdown({ value, onChange, disabled }) {
  const getClassName = (val) => {
    if (val === "Pending") return "status-badge status-badge--pending";
    if (val === "Approved") return "status-badge status-badge--approved";
    if (val === "Rejected") return "status-badge status-badge--rejected";
    return "status-badge status-badge--muted";
  };

  return (
    <select
      className={getClassName(value)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        border: "none",
        outline: "none",
        fontWeight: "800",
        cursor: "pointer",
        paddingRight: "8px",
      }}
    >
      <option value="Pending">Pending</option>
      <option value="Approved">Approved</option>
      <option value="Rejected">Rejected</option>
    </select>
  );
}

const StudentRow = memo(function StudentRow({
  deleteMode = false,
  isSelected = false,
  onSelect,
  serialNumber,
  student,
  onView,
  onStatusChange,
  certificateDownloaded = false,
  offerLetterMode = false,
  offerLetterSelected = false,
  onOfferLetterSelect,
}) {
  const [updating, setUpdating] = useState(false);

  const handleSelectChange = (event) => {
    if (onSelect) {
      onSelect(student._id, event.target.checked);
    }
  };

  const handleViewClick = () => {
    if (onView) {
      onView(student._id);
    }
  };

  const handleStatusChange = async (nextStatus) => {
    if (nextStatus === student.status) return;
    const confirmed = window.confirm(`Are you sure you want to change the status of ${student.name} to ${nextStatus}?`);
    if (!confirmed) return;

    setUpdating(true);
    try {
      const payload = {
        status: nextStatus,
        remark: student.remark || "",
        referenceBy: student.referenceBy || "",
        recommendedBy: student.recommendedBy || "",
      };
      const response = await updateStudentReview(student._id, payload);
      if (onStatusChange) {
        onStatusChange(student._id, response.student);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <tr>
      {deleteMode && (
        <td>
          <input
            checked={isSelected}
            type="checkbox"
            onChange={handleSelectChange}
            aria-label={`Select ${student.name}`}
          />
        </td>
      )}
      {offerLetterMode && <td><input checked={offerLetterSelected} type="checkbox" onChange={(event) => onOfferLetterSelect?.([student._id], event.target.checked)} aria-label={`Select ${student.name} for offer letter`} /></td>}
      <td>{serialNumber}</td>
      <td>{student.referenceId || "-"}</td>
      <td>{student.name}</td>
      <td>{student.collegeName}</td>
      <td>{student.branch}</td>
      <td>{student.branchCode || "-"}</td>
      <td>{student.trainingManagement?.division || "-"}</td>
      <td>{student.year}</td>
      <td>{student.cgpa}</td>
      <td>{formatDate(student.submittedAt)}</td>
      <td>
        <StatusDropdown
          value={student.status}
          onChange={handleStatusChange}
          disabled={updating}
        />
      </td>
      <td>
        <StatusBadge value={student.offerLetterStatus || "Not Sent"} />
      </td>
      <td>{formatDate(student.approvedDate)}</td>
      <td>
        <button className="admin-secondary-btn admin-table-action" type="button" onClick={handleViewClick}>
          View Details
        </button>
      </td>
    </tr>
  );
});

export default StudentRow;
