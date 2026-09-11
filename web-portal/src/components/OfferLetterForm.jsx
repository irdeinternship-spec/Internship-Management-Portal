import { sortDurations } from "../utils/durationSort";
import { useReferenceData } from "../hooks/useReferenceData";

function OfferLetterForm({ form, saving, onChange, onSubmit }) {
  // Durations are live reference data now, from /api/reference.
  const { durations } = useReferenceData();
  const updateField = (key, value) => {
    onChange({ ...form, [key]: value });
  };

  const courses = ["B.Tech", "M.Tech", "M.Sc", "PhD"];

  const years = [
    "1st Year",
    "2nd Year",
    "3rd Year",
    "4th Year",
  ];

  const branches = [
    "Computer Science and Engineering",
    "Information Technology",
    "Electronics and Communication Engineering",
    "Electrical Engineering",
    "Mechanical Engineering",
    "Civil Engineering",
    "Chemical Engineering",
    "Aerospace Engineering",
    "Biotechnology",
    "Artificial Intelligence and Data Science",
  ];

  return (
    <form className="admin-review-form" onSubmit={onSubmit}>
      <h2>Edit Offer Letter</h2>

      <div className="admin-control-grid">

        <label className="admin-field">
          <span>Student Name</span>
          <input
            value={form.studentName || ""}
            onChange={(e) => updateField("studentName", e.target.value)}
          />
        </label>

        <label className="admin-field">
          <span>College Name</span>
          <input
            value={form.collegeName || ""}
            onChange={(e) => updateField("collegeName", e.target.value)}
          />
        </label>

        <label className="admin-field">
          <span>College Location</span>
          <input
            value={form.collegeLocation || ""}
            onChange={(e) => updateField("collegeLocation", e.target.value)}
          />
        </label>

        {/* Course */}
        <label className="admin-field">
          <span>Course</span>
          <select
            value={form.course || ""}
            onChange={(e) => updateField("course", e.target.value)}
          >
            <option value="">Select Course</option>
            {courses.map((course) => (
              <option key={course} value={course}>
                {course}
              </option>
            ))}
          </select>
        </label>

        {/* Year */}
        <label className="admin-field">
          <span>Year</span>
          <select
            value={form.year || ""}
            onChange={(e) => updateField("year", e.target.value)}
          >
            <option value="">Select Year</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        {/* Branch */}
        <label className="admin-field">
          <span>Branch</span>
          <select
            value={form.branch || ""}
            onChange={(e) => updateField("branch", e.target.value)}
          >
            <option value="">Select Branch</option>
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </label>

        {/* Internship Duration */}
        <label className="admin-field">
          <span>Internship Duration</span>
          <select
            value={form.internshipDuration || ""}
            onChange={(e) =>
              updateField("internshipDuration", e.target.value)
            }
          >
            <option value="">Select Duration</option>
            {sortDurations(durations).map((duration) => (
              <option key={duration} value={duration}>
                {duration}
              </option>
            ))}
          </select>
        </label>

        {/* Issue Date */}
        <label className="admin-field">
          <span>Issue Date</span>
          <input
            type="date"
            value={form.issueDate || ""}
            onChange={(e) => updateField("issueDate", e.target.value)}
          />
        </label>

      </div>

      <button className="admin-primary-btn" disabled={saving} type="submit">
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </form>
  );
}

export default OfferLetterForm;
