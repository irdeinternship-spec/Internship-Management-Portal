import StudentRow from "./StudentRow";

function StudentTable({
  deleteMode = false,
  onSelect,
  onView,
  selectedIds = [],
  students,
  onStatusChange,
  certificateDownloadedIds = [],
  offerLetterMode = false,
  offerLetterIds = [],
  onOfferLetterSelect,
  sort,
  onSortChange,
}) {
  const handleHeaderClick = (columnKey) => {
    if (!onSortChange) return;
    if (sort?.sortBy === columnKey) {
      const nextOrder = sort.sortOrder === "asc" ? "desc" : "asc";
      onSortChange({ sortBy: columnKey, sortOrder: nextOrder });
    } else {
      onSortChange({ sortBy: columnKey, sortOrder: "asc" });
    }
  };

  const renderSortArrow = (columnKey) => {
    if (!sort || sort.sortBy !== columnKey) return " ▲▼";
    return sort.sortOrder === "asc" ? " ▲" : " ▼";
  };

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {deleteMode && <th>Select</th>}
            {offerLetterMode && <th>Select</th>}
            <th>Serial No.</th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("referenceId")}>
              Application ID{renderSortArrow("referenceId")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("name")}>
              Student Name{renderSortArrow("name")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("collegeName")}>
              College / University{renderSortArrow("collegeName")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("branch")}>
              Branch{renderSortArrow("branch")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("branchCode")}>
              Branch Code{renderSortArrow("branchCode")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("division")}>
              Division{renderSortArrow("division")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("year")}>
              Year{renderSortArrow("year")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("cgpa")}>
              CGPA{renderSortArrow("cgpa")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("submittedAt")}>
              Registration Date{renderSortArrow("submittedAt")}
            </th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("status")}>
              Current Status{renderSortArrow("status")}
            </th>
            <th>Offer Letter Status</th>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderClick("approvedDate")}>
              Approved Date{renderSortArrow("approvedDate")}
            </th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student, index) => (
            <StudentRow
              key={student._id}
              deleteMode={deleteMode}
              isSelected={selectedIds.includes(student._id)}
              onSelect={onSelect}
              serialNumber={index + 1}
              student={student}
              onView={onView}
              onStatusChange={onStatusChange}
              certificateDownloaded={certificateDownloadedIds.includes(student._id) || student.certificateGenerated}
              offerLetterMode={offerLetterMode}
              offerLetterSelected={offerLetterIds.includes(student._id)}
              onOfferLetterSelect={onOfferLetterSelect}
            />
          ))}
        </tbody>
      </table>
      {!students.length && (
        <div className="admin-empty-state">No students match the current view.</div>
      )}
    </div>
  );
}

export default StudentTable;
