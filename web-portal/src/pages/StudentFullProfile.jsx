import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchAdminStudent } from "../services/adminService";
import { usePresignAndOpen } from "../utils/presignedFile";
import "../styles/admin.css";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN");
}

function calculateDaysRemaining(toDateStr) {
  if (!toDateStr) return "-";
  const toDate = new Date(toDateStr);
  if (isNaN(toDate.getTime())) return "-";
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  toDate.setHours(0, 0, 0, 0);
  
  const diffTime = toDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    return "Completed";
  } else if (diffDays === 0) {
    return "0 Days Remaining";
  } else {
    return `${diffDays} Days Remaining`;
  }
}

function DetailGrid({ title, rows }) {
  return (
    <section className="details-section">
      <h2>{title}</h2>
      <div className="details-grid">
        {rows.map(([label, value]) => (
          <div className="detail-item" key={label}>
            <span>{label}</span>
            <strong>{value || "-"}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function DocumentButton({ label, file }) {
  const { open, busy, error } = usePresignAndOpen("admin");
  if (!file?.url) return null;
  return (
    <>
      <button type="button" className="admin-secondary-btn admin-link-button" onClick={() => open(file.url)} disabled={busy}>
        {busy ? "Opening…" : `View ${label}`}
      </button>
      {error && <span className="admin-error">{error}</span>}
    </>
  );
}

function StudentFullProfile() {
  const { id } = useParams();
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadStudent() {
      setLoading(true);
      setError("");
      try {
        const response = await fetchAdminStudent(id);
        setStudent(response.student);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadStudent();
  }, [id]);

  if (loading) {
    return (
      <main className="admin-console admin-shell">
        <div className="admin-loading">Loading full profile...</div>
      </main>
    );
  }

  if (error || !student) {
    return (
      <main className="admin-console admin-shell">
        <p className="admin-error">{error || "Student not found."}</p>
      </main>
    );
  }

  return (
    <main className="admin-console admin-shell" style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
      <header className="admin-topbar" style={{ marginBottom: "24px" }}>
        <div>
          <p className="portal-eyebrow">DRDO Student Full Profile</p>
          <h1>{student.name}</h1>
          <p style={{ marginTop: "4px", color: "var(--text-muted)" }}>Application ID: {student.referenceId}</p>
        </div>
      </header>

      {/* Section 1: Personal Details */}
      <DetailGrid
        title="Section 1: Personal Details"
        rows={[
          ["Name", student.name],
          ["Email", student.email],
          ["Phone Number", student.phone],
          ["Gender", student.gender],
          ["Aadhaar Number", student.aadhaarNumber],
          ["Date of Birth", student.dob],
        ]}
      />

      {/* Section 2: Academic Details */}
      <DetailGrid
        title="Section 2: Academic Details"
        rows={[
          ["Course", student.course],
          ["Branch", student.branch],
          ["Branch Code", student.branchCode],
          ["Year", student.year],
          ["CGPA", student.cgpa],
        ]}
      />

      {/* Section 3: College Details */}
      <DetailGrid
        title="Section 3: College Details"
        rows={[
          ["College Name", student.collegeName],
          ["College Address", student.collegeAddress],
          ["College Location", student.location],
          ["College State", student.collegeState],
        ]}
      />

      {/* Section 4: Guardian Details */}
      <DetailGrid
        title="Section 4: Guardian Details"
        rows={[
          ["Father's Name", student.fatherName],
          ["Parent's Contact Number", student.fatherPhone],
          ["Parent's Occupation", student.fatherOccupation],
        ]}
      />

      {/* Section 5: Internship Information */}
      <DetailGrid
        title="Section 5: Internship Information"
        rows={[
          ["Internship Duration", student.internshipDuration],
          ["College Referral Letter Number", student.permissionLetterNumber],
          ["College Referral Letter Date", student.permissionLetterDate],
          ["Joining Month", student.internshipJoiningMonth],
        ]}
      />

      {/* Section 6: Student Joining Details and Completion */}
      <DetailGrid
        title="Section 6: Student Joining Details and Completion"
        rows={[
          ["Joined Status", student.trainingManagement?.joined || "-"],
          ["Joining Date (From Date)", student.trainingManagement?.fromDate || "-"],
          ["Completion Status (Completed)", student.trainingManagement?.completed || "-"],
          ["Completion Date (To Date)", student.trainingManagement?.toDate || "-"],
          ["Division", student.trainingManagement?.division || "-"],
          ["Days Remaining", calculateDaysRemaining(student.trainingManagement?.toDate)],
        ]}
      />

      {/* Section 7: Uploaded Documents */}
      <section className="details-section">
        <h2>Section 7: Uploaded Documents</h2>
        <div className="document-actions">
          <DocumentButton label="Student Photo" file={student.photo} />
          <DocumentButton label="Curriculum Vitae" file={student.resume} />
          <DocumentButton label="Marksheet" file={student.result} />
          <DocumentButton label="Aadhaar Card" file={student.aadhaarCard} />
          <DocumentButton label="College Referral Letter" file={student.permissionLetter} />
        </div>
      </section>
    </main>
  );
}

export default StudentFullProfile;
