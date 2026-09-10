import { useEffect, useRef, useState } from "react";
import AdminReviewForm from "../components/Admin/AdminReviewForm";
import StatusBadge from "../components/Admin/StatusBadge";
import StudentDivisionRecommendation from "../components/Admin/StudentDivisionRecommendation";
import {
  fetchAdminStudent,
  fetchAdministration,
  saveTrainingManagement,
  updateStudentDetails,
  deleteAdminStudents,
  updateStudentReview,
  fetchAdminStudents,
} from "../services/adminService";
import {
  generateOfferLetter,
  uploadOfferLetterPdf,
} from "../services/offerLetterService";
import { usePresignAndOpen } from "../utils/presignedFile";
import { branches as registeredBranchOptions } from "../data/branches";
import { internshipDurations } from "../data/internshipDurations";
import { sortDurations } from "../utils/durationSort";
import { indianStatesAndUnionTerritories } from "../data/states";
import "../styles/admin.css";

const courseOptions = [
  "B.Tech",
  "M.Tech",
  "M.Sc",
  "Ph.D",
];

const yearOptions = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
];

function normalizeCourse(course) {
  const value = String(course || "").trim();
  const comparableValue = value.replace(/\.$/, "").toLowerCase();

  return (
    courseOptions.find(
      (option) => option.replace(/\.$/, "").toLowerCase() === comparableValue,
    ) || value
  );
}

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

// Small "current file" preview link shown next to an edit-mode file input -
// same shape as DocumentButton but styled as an inline text link, not a
// button, to match this form's layout.
function CurrentFileLink({ url, label }) {
  const { open, busy, error } = usePresignAndOpen("admin");
  if (!url) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => open(url)}
        disabled={busy}
        style={{ marginTop: "4px", fontSize: "0.86rem", color: "var(--primary)", fontWeight: "bold", background: "none", border: "none", padding: 0, cursor: busy ? "default" : "pointer", textDecoration: "underline" }}
      >
        {busy ? "Opening…" : label}
      </button>
      {error && <span className="admin-error" style={{ display: "block", fontSize: "0.8rem" }}>{error}</span>}
    </>
  );
}

function CapacityErrorModal({ error, onClose }) {
  if (!error) return null;
  return <div className="capacity-error-modal-backdrop" role="presentation">
    <section className="capacity-error-modal" role="alertdialog" aria-modal="true" aria-labelledby="capacity-error-title">
      <h2 id="capacity-error-title">⚠ {error.title}</h2>
      <p>{error.message}</p>
      <button className="admin-primary-btn capacity-error-modal__close" type="button" onClick={onClose}>Close</button>
    </section>
  </div>;
}

function addDurationToDate(fromDate, duration) {
  if (!fromDate) return "";
  const date = new Date(fromDate);
  if (Number.isNaN(date.getTime())) return "";

  const monthMatch = String(duration || "").match(/(\d+)\s*month/i);
  const weekMatch = String(duration || "").match(/(\d+)\s*week/i);

  if (monthMatch) { date.setMonth(date.getMonth() + Number(monthMatch[1])); date.setDate(date.getDate() - 1); }
  else if (weekMatch) date.setDate(date.getDate() + Number(weekMatch[1]) * 7 - 1);
  else return "";

  return date.toISOString().slice(0, 10);
}

function TrainingManagementForm({ student, divisions, onUpdated, alwaysOpen = false, saveRef = null }) {
  const existing = student.trainingManagement || {};
  const branchOptions = [...new Set([
    ...registeredBranchOptions,
    existing.branch,
    student.branch,
  ].filter(Boolean))];
  const [form, setForm] = useState({
    studentName: existing.studentName || student.name || "",
    courseName: normalizeCourse(existing.courseName || student.course),
    courseYear: existing.courseYear || student.year || "",
    branch: existing.branch || student.branch || "",
    collegeName: existing.collegeName || student.collegeName || "",
    collegeLocation: existing.collegeLocation || student.location || "",
    trainingDuration: existing.trainingDuration || student.internshipDuration || "",
    fromDate: existing.fromDate || "",
    toDate: existing.toDate || "",
    joined: existing.joined || student.joinedStatus || "",
    division: existing.division || "",
    projectTitle: existing.projectTitle || "",
    projectGuide: existing.projectGuide || "",
    designation: existing.designation || "",
    leaveAvailed: existing.leaveAvailed || "",
    completed: existing.completed || student.completedStatus || "",
    resignationStatus: student.resignationStatus || "No",
    resignationDate: student.resignationDate ? String(student.resignationDate).slice(0, 10) : "",
  });
  const [open, setOpen] = useState(alwaysOpen);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const initialRender = useRef(true);
  const savedForm = useRef(form);
  const [divisionStats, setDivisionStats] = useState({});
  const [capacityError, setCapacityError] = useState(null);

  const loadStats = async () => {
    try {
      const [{ administration }, { students }] = await Promise.all([
        fetchAdministration(),
        fetchAdminStudents({ sortBy: "submittedAt", sortOrder: "desc" })
      ]);
      const stats = {};
      const branch = form.branch;
      divisions.forEach((div) => {
        const config = administration.divisionConfigurations?.[div];
        const isPaidStudent = (student.internshipType || "Unpaid").toLowerCase() === "paid";
        const paidVacancy = (config?.allowedBranches || []).reduce((sum, b) => sum + Math.max(0, Number(config?.branchSeats?.[b]?.paid) || 0), 0);
        const unpaidVacancy = (config?.allowedBranches || []).reduce((sum, b) => sum + Math.max(0, Number(config?.branchSeats?.[b]?.unpaid ?? config?.branchSeats?.[b]) || 0), 0);
        const totalVacancy = paidVacancy + unpaidVacancy;
        
        const activeStudents = students.filter(s =>
          s.status === "Approved" &&
          s.trainingManagement?.division === div &&
          s.trainingManagement?.completed !== "Yes" &&
          (s.internshipType || "Unpaid").toLowerCase() === (student.internshipType || "Unpaid").toLowerCase() &&
          s._id !== student._id
        );
        
        const branchSeatObj = config?.branchSeats?.[branch];
        let branchCapacity = 0;
        if (branchSeatObj && typeof branchSeatObj === "object") {
          branchCapacity = isPaidStudent ? (Number(branchSeatObj.paid) || 0) : (Number(branchSeatObj.unpaid) || 0);
        } else {
          branchCapacity = isPaidStudent ? 0 : (Number(branchSeatObj) || 0);
        }
        
        const allocatedForBranch = activeStudents.filter((assignedStudent) => assignedStudent.branch === branch).length;
        const typeCapacity = isPaidStudent ? paidVacancy : unpaidVacancy;
        const availableSeats = Math.max(0, typeCapacity - activeStudents.length);
        const branchAvailableSeats = Math.max(0, branchCapacity - allocatedForBranch);
        const acceptsBranch = Boolean(branch && config?.allowedBranches?.includes(branch) && branchCapacity > 0);
        stats[div] = {
          isFull: typeCapacity > 0 && availableSeats === 0,
          isBranchFull: !acceptsBranch || branchAvailableSeats === 0,
          availableSeats,
          branchAvailableSeats,
        };
      });
      setDivisionStats(stats);
      return stats;
    } catch (err) {
      console.error("Failed to load division stats:", err);
    }
  };

  useEffect(() => {
    loadStats();
  }, [divisions, student._id, form.branch]);

  const availableDivisionSummary = () => Object.entries(divisionStats)
    .filter(([, stats]) => !stats.isFull && !stats.isBranchFull)
    .map(([division, stats]) => `${division} (${Math.min(stats.availableSeats, stats.branchAvailableSeats)} Seats Available)`)
    .join(", ");

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "fromDate" || name === "trainingDuration") {
        next.toDate = addDurationToDate(
          name === "fromDate" ? value : current.fromDate,
          name === "trainingDuration" ? value : current.trainingDuration
        );
      }
      if (name === "resignationStatus" && value === "No") next.resignationDate = "";
      return next;
    });
    setMessage("");
    setDirty(true);
  };

  const handlePaidMonthsChange = (event) => {
    const months = event.target.value.replace(/\D/g, "");
    handleChange({ target: { name: "trainingDuration", value: months ? `${months} Months` : "" } });
  };

  const save = async (payload = form) => {
    const latestStats = await loadStats() || divisionStats;
    const selectedDivisionStats = latestStats[payload.division];
    if (payload.division && selectedDivisionStats?.isBranchFull && !selectedDivisionStats.isFull) {
      const alternatives = availableDivisionSummary();
      const errorMessage = `No available seat for ${payload.branch} in ${payload.division}. This division is currently full.`;
      setCapacityError({ title: "Cannot Assign Student", message: errorMessage });
      setMessage(errorMessage);
      // Keep the branch edit pending. The stored allocation is unchanged until
      // the administrator selects a division with capacity for that branch.
      setDirty(false);
      return;
    }
    if (payload.division && selectedDivisionStats?.isFull) {
      const errorMessage = `${payload.division} has no available seats. This division is currently full.`;
      setCapacityError({ title: "Cannot Assign Student", message: errorMessage });
      setMessage(errorMessage);
      setForm(savedForm.current);
      setDirty(false);
      return;
    }
    if (payload.completed === "Yes") {
      const required = [
        { key: "joined", label: "Joined Status" },
        { key: "fromDate", label: "Joined Date" },
        { key: "toDate", label: "Completion Date" },
        { key: "trainingDuration", label: "Duration" },
        { key: "projectTitle", label: "Project Title" },
        { key: "projectGuide", label: "Project Guide" },
        { key: "designation", label: "Guide Designation" },
        { key: "leaveAvailed", label: "Performance" }
      ];
      const missing = required.filter(r => !String(payload[r.key] || "").trim());
      if (missing.length > 0) {
        setForm(current => ({ ...current, completed: existing.completed || "" }));
        setDirty(false);
        setMessage("🔴 Please complete all Student Joining Details before marking Completion Status as Yes.");
        return;
      }
    }
    if (student.internshipType === "Paid" && payload.resignationStatus === "Yes" && !payload.resignationDate) {
      setMessage("Please enter a resignation date when resignation is Yes.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await saveTrainingManagement(student._id, payload);
      savedForm.current = payload;
      onUpdated(response.student);
      window.dispatchEvent(new Event("student-division-updated"));
      setMessage(response.message);
      loadStats();
    } catch (err) {
      if (/no available seat|cannot be assigned|is full/i.test(err.message || "")) setCapacityError({ title: "Cannot Assign Student", message: err.message });
      if (!/no available seat|cannot be assigned|is full/i.test(err.message || "")) {
        setForm(savedForm.current);
      }
      setDirty(false);
      const alternatives = availableDivisionSummary();
      setMessage(`${err.message}${alternatives ? ` Available divisions: ${alternatives}.` : ""}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDivisionChange = async (event) => {
    const division = event.target.value;
    const latestStats = await loadStats() || divisionStats;
    if (division && latestStats[division]?.isBranchFull && !latestStats[division]?.isFull) {
      const errorMessage = `No available seat for ${form.branch} in ${division}. This division is currently full.`;
      setCapacityError({ title: "Cannot Assign Student", message: errorMessage });
      setMessage(errorMessage);
      event.target.value = form.division;
      return;
    }
    if (division && latestStats[division]?.isFull) {
      const errorMessage = `${division} has no available seats. This division is currently full.`;
      setCapacityError({ title: "Cannot Assign Student", message: errorMessage });
      setMessage(errorMessage);
      event.target.value = form.division;
      return;
    }
    const next = { ...form, division };

    setSaving(true);
    setMessage("");
    try {
      const response = await saveTrainingManagement(student._id, next);
      savedForm.current = next;
      setForm(next);
      onUpdated(response.student);
      window.dispatchEvent(new Event("student-division-updated"));
      setMessage(response.message);
      loadStats();
    } catch (err) {
      setForm(savedForm.current);
      setMessage(err.message);
      if (/no available seat|cannot be assigned|is full/i.test(err.message || "")) setCapacityError({ title: "Cannot Assign Student", message: err.message });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (initialRender.current) { initialRender.current = false; return undefined; }
    if (!dirty) return undefined;
    const timer = window.setTimeout(() => { setDirty(false); save(form); }, 750);
    return () => window.clearTimeout(timer);
  }, [form, dirty]);

  // Expose explicit save via ref for the approved-view action bar
  useEffect(() => {
    if (saveRef) {
      saveRef.current = () => save(form);
    }
  }, [saveRef, form]);

  return (
    <section className="details-section">
      <CapacityErrorModal error={capacityError} onClose={() => setCapacityError(null)} />
      <div className="details-section__header">
        <h2>Student Joining Details and Completion</h2>
        {!alwaysOpen && (
          <button className="admin-primary-btn" type="button" onClick={() => setOpen((value) => !value)}>
            Student Joining Details and Completion
          </button>
        )}
      </div>

      {open && (
        <form className="training-form" onSubmit={(event) => event.preventDefault()}>
          <label className="admin-field">
  <span>Student Name</span>
      <input
        name="studentName"
        value={form.studentName}
        onChange={handleChange}
      />
    </label>

    <label className="admin-field">
      <span>Course</span>
      <select
        name="courseName"
        value={form.courseName}
        onChange={handleChange}
      >
        <option value="">Select Course</option>
        {courseOptions.map((course) => (
          <option key={course} value={course}>
            {course}
          </option>
        ))}
      </select>
    </label>

    <label className="admin-field">
      <span>Course Year</span>
      <select
        name="courseYear"
        value={form.courseYear}
        onChange={handleChange}
      >
        <option value="">Select Year</option>
        {yearOptions.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </label>

    <label className="admin-field">
      <span>Branch</span>
      <select
        name="branch"
        value={form.branch}
        onChange={handleChange}
      >
        <option value="">Select Branch</option>
        {branchOptions.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
    </label>

    <label className="admin-field">
      <span>Division</span>
      <select name="division" value={form.division} onChange={handleDivisionChange} disabled={saving}>
        <option value="">Select Division</option>
        {[...divisions].sort((a, b) => a.localeCompare(b)).map((division) => (
          <option key={division} value={division}>
            {divisionStats[division]?.isFull || divisionStats[division]?.isBranchFull ? `${division} (Seats Full)` : division}
          </option>
        ))}
      </select>
    </label>

    <label className="admin-field">
      <span>College Name</span>
      <input
        name="collegeName"
        value={form.collegeName}
        onChange={handleChange}
      />
    </label>

    <label className="admin-field">
      <span>College Location</span>
      <input
        name="collegeLocation"
        value={form.collegeLocation}
        onChange={handleChange}
      />
    </label>

    <label className="admin-field">
      <span>From Date</span>
      <input
        type="date"
        name="fromDate"
        value={form.fromDate}
        onChange={handleChange}
      />
    </label>

    <label className="admin-field">
      <span>To Date</span>
      <input
        type="date"
        name="toDate"
        value={form.toDate}
        onChange={handleChange}
      />
    </label>

    <label className="admin-field">
      <span>Days Remaining</span>
      <input
        type="text"
        value={calculateDaysRemaining(form.toDate)}
        readOnly
        disabled
      />
    </label>

    <label className="admin-field training-form__project-title">
      <span>Project Title</span>
      <input
        name="projectTitle"
        value={form.projectTitle}
        onChange={handleChange}
      />
    </label>

    <label className="admin-field">
      <span>Project Guide</span>
      <input
        name="projectGuide"
        value={form.projectGuide}
        onChange={handleChange}
      />
    </label>

    <label className="admin-field">
      <span>Designation</span>
      <input
        name="designation"
        value={form.designation}
        onChange={handleChange}
      />
    </label>

    <label className="admin-field">
      <span>Leave Availed</span>
      <input
        name="leaveAvailed"
        value={form.leaveAvailed}
        onChange={handleChange}
      />
    </label>

          {student.internshipType === "Paid" ? (
            <label className="admin-field">
              <span>Number of Months</span>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={String(form.trainingDuration || "").match(/\d+/)?.[0] || ""}
                onChange={handlePaidMonthsChange}
              />
            </label>
          ) : (
            <label className="admin-field">
              <span>Training Duration</span>
              <select name="trainingDuration" value={form.trainingDuration} onChange={handleChange}>
                <option value="">Select duration</option>
                {sortDurations(internshipDurations).map((duration) => <option key={duration} value={duration}>{duration}</option>)}
              </select>
            </label>
          )}

          {[
            ["joined", "Joined"],
            ["completed", "Completed"],
          ].map(([name, label]) => (
            <label className="admin-field" key={name}>
              <span>{label}</span>
              <select name={name} value={form[name]} onChange={handleChange}>
                <option value="">Select</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
          ))}

          {student.internshipType === "Paid" && (
            <label className="admin-field">
              <span>Resignation</span>
              <select name="resignationStatus" value={form.resignationStatus} onChange={handleChange}>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
          )}
          {student.internshipType === "Paid" && form.resignationStatus === "Yes" && (
            <label className="admin-field">
              <span>Resignation Date</span>
              <input type="date" name="resignationDate" value={form.resignationDate} onChange={handleChange} required />
            </label>
          )}

          <p className={message.startsWith("Unable") || message.startsWith("No ") || message.startsWith("Select ") || message.startsWith("🔴") || message.startsWith("Please") ? "admin-error" : "admin-muted"} role="status" style={message.startsWith("🔴") || message.startsWith("Please") ? { color: "red", fontWeight: "bold" } : {}}>{saving ? "Saving..." : message || (dirty ? "Changes pending..." : "Saved")}</p>
        </form>
      )}
    </section>
  );
}

function StudentDetails({ id, onClose, onDirtyChange, saveTrigger, onSaveSuccess, onSaveFailure, onDeleteSuccess, inSplitView, source = "approved" }) {
  const isApprovedView = source === "approved" && !window.location.pathname.startsWith("/admin/student-management");
  const trainingFormSaveRef = useRef(null);
  const [student, setStudent] = useState(null);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [letterFile, setLetterFile] = useState(null);
  const [letterBusy, setLetterBusy] = useState("");
  const [error, setError] = useState("");
  const [letterError, setLetterError] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [newFiles, setNewFiles] = useState({});
  const [editError, setEditError] = useState("");
  const [courseBranchError, setCourseBranchError] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  const isFormDirty = () => {
    if (!isEditing) return false;
    const fields = [
      "name", "gender", "phone", "email", "aadhaarNumber", "dob",
      "collegeName", "collegeAddress", "collegeLocation", "collegeState",
      "course", "branch", "year", "cgpa", "collegeId",
      "currentAddress", "permanentAddress", "fatherName", "fatherPhone", "fatherOccupation",
      "internshipDuration", "permissionLetterNumber", "permissionLetterDate", "internshipJoiningMonth"
    ];
    const hasTextChanges = fields.some(key => {
      let original = student[key] || "";
      if (key === "collegeLocation") original = student.location || "";
      const current = editForm[key] || "";
      return String(original).trim() !== String(current).trim();
    });
    const hasFileChanges = Object.values(newFiles).some(f => !!f);
    return hasTextChanges || hasFileChanges;
  };

  useEffect(() => {
    if (onDirtyChange && student) {
      onDirtyChange(isFormDirty());
    }
  }, [isEditing, editForm, newFiles, student]);

  useEffect(() => {
    if (saveTrigger > 0 && isEditing) {
      handleSaveDetails();
    }
  }, [saveTrigger]);

  const handleApprove = async () => {
    if (window.confirm(`Are you sure you want to approve ${student.name}?`)) {
      try {
        const payload = {
          status: "Approved",
          remark: student.remark || "Approved via details panel",
          referenceBy: student.referenceBy || "",
          recommendedBy: student.recommendedBy || "",
        };
        const response = await updateStudentReview(student._id, payload);
        setStudent(response.student);
        if (onSaveSuccess) onSaveSuccess(response.student);
        window.dispatchEvent(new Event("student-division-updated"));
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleReject = async () => {
    if (window.confirm(`Are you sure you want to reject ${student.name}?`)) {
      try {
        const payload = {
          status: "Rejected",
          remark: student.remark || "Rejected via details panel",
          referenceBy: student.referenceBy || "",
          recommendedBy: student.recommendedBy || "",
        };
        const response = await updateStudentReview(student._id, payload);
        setStudent(response.student);
        if (onSaveSuccess) onSaveSuccess(response.student);
        window.dispatchEvent(new Event("student-division-updated"));
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this student?\nThis action cannot be undone.")) {
      try {
        await deleteAdminStudents([student._id]);
        if (onDeleteSuccess) onDeleteSuccess(student._id);
        window.dispatchEvent(new Event("student-division-updated"));
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleStartEdit = () => {
    setEditForm({
      name: student.name || "",
      gender: student.gender || "",
      phone: student.phone || "",
      email: student.email || "",
      aadhaarNumber: student.aadhaarNumber || "",
      dob: student.dob || "",
      
      collegeName: student.collegeName || "",
      collegeAddress: student.collegeAddress || "",
      collegeLocation: student.location || "",
      collegeState: student.collegeState || "",
      
      course: student.course || "",
      branch: student.branch || "",
      year: student.year || "",
      cgpa: student.cgpa || "",
      collegeId: student.collegeId || "",
      
      currentAddress: student.currentAddress || "",
      permanentAddress: student.permanentAddress || "",
      
      fatherName: student.fatherName || "",
      fatherPhone: student.fatherPhone || "",
      fatherOccupation: student.fatherOccupation || "",
      
      internshipDuration: student.internshipDuration || "",
      permissionLetterNumber: student.permissionLetterNumber || "",
      permissionLetterDate: student.permissionLetterDate || "",
      internshipJoiningMonth: student.internshipJoiningMonth || "",
    });
    setNewFiles({});
    setEditError("");
    setIsEditing(true);
  };

  const handleEditChange = (name, value) => {
    setEditForm(current => ({ ...current, [name]: value }));
  };

  const handleFileChange = (name, file) => {
    setNewFiles(current => ({ ...current, [name]: file }));
  };

  const handleSaveDetails = async () => {
    setEditSaving(true);
    setEditError("");
    setCourseBranchError(null);
    try {
      const payload = new FormData();
      Object.entries(editForm).forEach(([key, value]) => {
        payload.append(key, value);
      });
      Object.entries(newFiles).forEach(([key, value]) => {
        if (value) {
          payload.append(key, value);
        }
      });

      const response = await updateStudentDetails(student._id, payload);
      setStudent(response.student);
      setIsEditing(false);
      setNewFiles({});
      if (onSaveSuccess) onSaveSuccess(response.student);
      window.dispatchEvent(new Event("student-division-updated"));
    } catch (err) {
      setEditError(err.message);
      if (/No available division\/seat is currently available|capacity|full/i.test(err.message || "")) {
        setCourseBranchError({ title: "Cannot Change Course/Branch", message: err.message });
      }
      setEditForm(current => ({
        ...current,
        course: student.course,
        branch: student.branch,
      }));
      if (onSaveFailure) onSaveFailure(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(() => {
    let ignore = false;

    async function loadStudent() {
      setLoading(true);
      setError("");

      try {
        const response = await fetchAdminStudent(id);
        if (!ignore) setStudent(response.student);
      } catch (err) {
        if (!ignore) setError(err.message);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadStudent();

    return () => {
      ignore = true;
    };
  }, [id]);

  useEffect(() => {
    fetchAdministration().then((response) => setDivisions(response.administration?.divisions || [])).catch(() => setDivisions([]));
  }, []);

  const goBack = () => {
    const dest = window.location.pathname.startsWith("/admin/student-management")
      ? "/admin/student-management"
      : "/admin/approved-students";
    window.history.pushState({}, "", dest);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const openOfferLetterPreview = () => {
    window.history.pushState({}, "", `/admin/students/${id}/offer-letter`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const handleGenerateOfferLetter = async () => {
    setLetterBusy("generate");
    setLetterError("");

    try {
      const response = await generateOfferLetter(id);
      setStudent(response.student);
      openOfferLetterPreview();
    } catch (err) {
      setLetterError(err.message);
    } finally {
      setLetterBusy("");
    }
  };

  const handleUploadOfferLetter = async (event) => {
    event.preventDefault();

    if (!letterFile) {
      setLetterError("Select the official Offer Letter PDF.");
      return;
    }

    setLetterBusy("upload");
    setLetterError("");

    try {
      const response = await uploadOfferLetterPdf(id, letterFile);
      setStudent(response.student);
      openOfferLetterPreview();
    } catch (err) {
      setLetterError(err.message);
    } finally {
      setLetterBusy("");
    }
  };

  if (loading) {
    return (
      <main className="admin-console admin-shell">
        <div className="admin-loading">Loading student details...</div>
      </main>
    );
  }

  if (error || !student) {
    return (
      <main className="admin-console admin-shell">
        <button className="admin-secondary-btn" type="button" onClick={goBack}>
          Back
        </button>
        <p className="admin-error">{error || "Student not found."}</p>
      </main>
    );
  }

  return (
    <main className="admin-console admin-shell">
      <CapacityErrorModal
        error={courseBranchError}
        onClose={() => {
          setCourseBranchError(null);
          setEditForm(current => ({
            ...current,
            course: student.course,
            branch: student.branch,
          }));
        }}
      />
      <header className="admin-topbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p className="portal-eyebrow">Student Details</p>
          <h1>{student.name}</h1>
          <div className="student-status-line">
            <StatusBadge value={student.status} />
            <span>{student.email}</span>
          </div>
        </div>
        {!inSplitView && (
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            {isEditing ? (
              <>
                <button
                  className="admin-primary-btn"
                  type="button"
                  onClick={handleSaveDetails}
                  disabled={editSaving}
                  style={{ padding: "6px 16px", fontSize: "0.875rem", height: "36px", minWidth: "120px" }}
                >
                  {editSaving ? "Saving..." : "Save Changes"}
                </button>
                <button
                  className="admin-secondary-btn"
                  type="button"
                  onClick={() => setIsEditing(false)}
                  style={{ padding: "6px 16px", fontSize: "0.875rem", height: "36px", minWidth: "100px" }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {!isApprovedView && (
                  <button
                    className="admin-primary-btn"
                    type="button"
                    onClick={handleStartEdit}
                    style={{ padding: "6px 16px", fontSize: "0.875rem", height: "36px", minWidth: "120px" }}
                  >
                    Edit Details
                  </button>
                )}
                <button
                  className="admin-secondary-btn"
                  type="button"
                  onClick={goBack}
                  style={{ padding: "6px 16px", fontSize: "0.875rem", height: "36px", minWidth: "220px" }}
                >
                  {window.location.pathname.startsWith("/admin/student-management")
                    ? "Back to Student Management"
                    : "Back to Approved Students"}
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {editError && (
        <div className="administration-toast administration-toast--error" style={{ marginBottom: "16px" }} role="alert">
          {editError}
        </div>
      )}      {!isApprovedView && (isEditing ? (
        <section className="details-section">
          <h2>Personal Details</h2>
          <div className="details-grid">
            <label className="admin-field">
              <span>Name</span>
              <input
                value={editForm.name}
                onChange={(e) => handleEditChange("name", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Gender</span>
              <select
                value={editForm.gender}
                onChange={(e) => handleEditChange("gender", e.target.value)}
              >
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label className="admin-field">
              <span>Date of Birth</span>
              <input
                type="date"
                value={editForm.dob}
                onChange={(e) => handleEditChange("dob", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Phone Number</span>
              <input
                type="tel"
                value={editForm.phone}
                onChange={(e) => handleEditChange("phone", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Email</span>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => handleEditChange("email", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Aadhaar Number</span>
              <input
                value={editForm.aadhaarNumber}
                onChange={(e) => handleEditChange("aadhaarNumber", e.target.value)}
              />
            </label>
          </div>
        </section>
      ) : (
        <DetailGrid
          title="Personal Details"
          rows={[
            ["Name", student.name || "Not Provided"],
            ["Gender", student.gender || "Not Provided"],
            ["Date of Birth", student.dob || "Not Provided"],
            ["Phone Number", student.phone || "Not Provided"],
            ["Email", student.email || "Not Provided"],
            ["Aadhaar Number", student.aadhaarNumber || "Not Provided"],
          ]}
        />
      ))}

      {!isApprovedView && (isEditing ? (
        <section className="details-section">
          <h2>College Details</h2>
          <div className="details-grid">
            <label className="admin-field">
              <span>College Name</span>
              <input
                value={editForm.collegeName}
                onChange={(e) => handleEditChange("collegeName", e.target.value)}
              />
            </label>
            <label className="admin-field" style={{ gridColumn: "span 3" }}>
              <span>College Address</span>
              <textarea
                rows={4}
                value={editForm.collegeAddress}
                onChange={(e) => handleEditChange("collegeAddress", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>College Location</span>
              <input
                value={editForm.collegeLocation}
                onChange={(e) => handleEditChange("collegeLocation", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>College State</span>
              <select
                value={editForm.collegeState}
                onChange={(e) => handleEditChange("collegeState", e.target.value)}
              >
                <option value="">Select State</option>
                {indianStatesAndUnionTerritories.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      ) : (
        <DetailGrid
          title="College Details"
          rows={[
            ["College / University", student.collegeName],
            ["College Address", student.collegeAddress || "-"],
            ["College Location", student.location],
            ["College State", student.collegeState],
          ]}
        />
      ))}

      {!isApprovedView && (isEditing ? (
        <section className="details-section">
          <h2>Academic Details</h2>
          <div className="details-grid">
            <label className="admin-field">
              <span>Course</span>
              <select
                value={editForm.course}
                onChange={(e) => handleEditChange("course", e.target.value)}
              >
                <option value="">Select Course</option>
                {courseOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Branch</span>
              <select
                value={editForm.branch}
                onChange={(e) => handleEditChange("branch", e.target.value)}
              >
                <option value="">Select Branch</option>
                {registeredBranchOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Year</span>
              <select
                value={editForm.year}
                onChange={(e) => handleEditChange("year", e.target.value)}
              >
                <option value="">Select Year</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>CGPA</span>
              <input
                type="number"
                min="0"
                max="10"
                step="0.01"
                value={editForm.cgpa}
                onChange={(e) => handleEditChange("cgpa", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>College ID</span>
              <input
                value={editForm.collegeId}
                onChange={(e) => handleEditChange("collegeId", e.target.value)}
              />
            </label>
          </div>
        </section>
      ) : (
        <DetailGrid
          title="Academic Details"
          rows={[
            ["Course", student.course],
            ["Branch", student.branch],
            ["Year", student.year],
            ["CGPA", student.cgpa],
            ["College ID", student.collegeId],
          ]}
        />
      ))}

      {!isApprovedView && (isEditing ? (
        <section className="details-section">
          <h2>Address Details</h2>
          <div className="details-grid">
            <label className="admin-field" style={{ gridColumn: "span 3" }}>
              <span>Current Address</span>
              <textarea
                rows={4}
                value={editForm.currentAddress}
                onChange={(e) => handleEditChange("currentAddress", e.target.value)}
              />
            </label>
            <label className="admin-field" style={{ gridColumn: "span 3" }}>
              <span>Permanent Address</span>
              <textarea
                rows={4}
                value={editForm.permanentAddress}
                onChange={(e) => handleEditChange("permanentAddress", e.target.value)}
              />
            </label>
          </div>
        </section>
      ) : (
        <DetailGrid
          title="Address Details"
          rows={[
            ["Current Address", student.currentAddress],
            ["Permanent Address", student.permanentAddress],
          ]}
        />
      ))}

      {!isApprovedView && (isEditing ? (
        <section className="details-section">
          <h2>Parent / Guardian Details</h2>
          <div className="details-grid">
            <label className="admin-field">
              <span>Father's Name</span>
              <input
                value={editForm.fatherName}
                onChange={(e) => handleEditChange("fatherName", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Parent's Contact Number</span>
              <input
                value={editForm.fatherPhone}
                onChange={(e) => handleEditChange("fatherPhone", e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Parent's Occupation</span>
              <input
                value={editForm.fatherOccupation}
                onChange={(e) => handleEditChange("fatherOccupation", e.target.value)}
              />
            </label>
          </div>
        </section>
      ) : (
        <DetailGrid
          title="Parent / Guardian Details"
          rows={[
            ["Father's Name", student.fatherName],
            ["Parent's Contact Number", student.fatherPhone],
            ["Parent's Occupation", student.fatherOccupation],
          ]}
        />
      ))}


      {!isApprovedView && (isEditing ? (
        <section className="details-section">
          <h2>Student Documents</h2>
          <div className="details-grid">
            <label className="admin-field">
              <span>Student Photo</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => handleFileChange("photo", e.target.files[0])}
              />
              <CurrentFileLink url={student.photo?.url} label="Current Photo" />
            </label>
            <label className="admin-field">
              <span>Curriculum Vitae</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => handleFileChange("resume", e.target.files[0])}
              />
              <CurrentFileLink url={student.resume?.url} label="Current Curriculum Vitae" />
            </label>
            <label className="admin-field">
              <span>Marksheet</span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/jpg"
                onChange={(e) => handleFileChange("result", e.target.files[0])}
              />
              <CurrentFileLink url={student.result?.url} label="Current Marksheet" />
            </label>
            <label className="admin-field">
              <span>College Referral Letter</span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/jpg,image/png"
                onChange={(e) => handleFileChange("permissionLetter", e.target.files[0])}
              />
              <CurrentFileLink url={student.permissionLetter?.url} label="Current Referral Letter" />
            </label>
          </div>
        </section>
      ) : (
        <section className="details-section">
          <h2>Student Documents</h2>
          <div className="document-actions">
            <DocumentButton label="Student Photo" file={student.photo} />
            <DocumentButton label="Curriculum Vitae" file={student.resume} />
            <DocumentButton label="Marksheet" file={student.result} />
            <DocumentButton label="Aadhaar Card" file={student.aadhaarCard} />
            <DocumentButton
              label="College Referral Letter"
              file={student.permissionLetter}
            />
            <DocumentButton
              label="Upload Form 1 and Form 2 (Single PDF)"
              file={student.completedDocuments}
            />
          </div>
        </section>
      ))}

      {!isEditing && isApprovedView && <TrainingManagementForm student={student} divisions={divisions} onUpdated={setStudent} alwaysOpen={isApprovedView} saveRef={isApprovedView ? trainingFormSaveRef : null} />}

      {/* Approved-view action bar: Save Changes + Suggest Division */}
      {isApprovedView && !isEditing && (
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", margin: "16px 0", padding: "16px 0", borderTop: "1px solid var(--border-color, #e2e8f0)", borderBottom: "1px solid var(--border-color, #e2e8f0)" }}>
          <button
            className="admin-primary-btn"
            type="button"
            onClick={() => trainingFormSaveRef.current?.()}
            style={{ padding: "6px 20px", fontSize: "0.875rem", height: "36px", minWidth: "140px" }}
          >
            Save Changes
          </button>
          <StudentDivisionRecommendation student={student} />
        </div>
      )}

      {false && isApprovedView && student.status === "Approved" && !isEditing && (
        <section className="offer-letter-box offer-letter-box--actions">
          <div>
            <h2>Offer Letter</h2>
            <p>Generate from the DRDO template or upload an official PDF, then review it before sending.</p>
          </div>

          <div className="offer-letter-actions">
            <button
              className="admin-primary-btn"
              disabled={letterBusy === "generate"}
              type="button"
              onClick={handleGenerateOfferLetter}
            >
              {letterBusy === "generate" ? "Generating..." : "Generate Offer Letter"}
            </button>

            {(student.offerLetter?.html || student.offerLetter?.url || student.offerLetterUrl) && (
              <button className="admin-secondary-btn" type="button" onClick={openOfferLetterPreview}>
                Preview Offer Letter
              </button>
            )}
          </div>

          <form className="offer-letter-upload-inline" onSubmit={handleUploadOfferLetter}>
            <label className="admin-field">
              <span>Upload Offer Letter PDF</span>
              <input
                accept="application/pdf"
                type="file"
                onChange={(event) => setLetterFile(event.target.files?.[0] || null)}
              />
            </label>
            <button className="admin-secondary-btn" disabled={letterBusy === "upload"} type="submit">
              {letterBusy === "upload" ? "Uploading..." : "Upload Offer Letter"}
            </button>
          </form>

          {letterError && <p className="admin-error">{letterError}</p>}
        </section>
      )}


    </main>
  );
}

export default StudentDetails;
