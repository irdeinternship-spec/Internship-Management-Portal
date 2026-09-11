import { sortDurations } from "../../utils/durationSort";
import FileInput from "../Inputs/FileInput";
import SelectInput from "../Inputs/SelectInput";
import TextInput from "../Inputs/TextInput";

// `reference` comes from StudentForm's useReferenceData() - durations are live
// reference data now, editable from the admin Management screen.
function DocumentForm({ form, errors, onChange, reference }) {
  const today = new Date().toISOString().split("T")[0];
  const { durations, loading, error } = reference;
  const optionsUnavailable = loading || Boolean(error);

  return (
    <>
      <section className="form-section">
        <h2>Internship Details</h2>
        <div className="form-grid">
          {form.internshipType === "Paid" ? (
            <TextInput
              label="Internship Duration"
              name="internshipDuration"
              value="6 Months"
              onChange={onChange}
              disabled
            />
          ) : (
            <SelectInput
              label="Internship Duration"
              name="internshipDuration"
              value={form.internshipDuration}
              onChange={onChange}
              options={sortDurations(durations)}
              error={errors.internshipDuration}
              disabled={optionsUnavailable}
              placeholder={loading ? "Loading options..." : error ? "Unavailable" : "Select"}
              required
            />
          )}
          {form.internshipType !== "Paid" && (
            <TextInput
              label="Joining Month"
              name="internshipJoiningMonth"
              type="month"
              value={form.internshipJoiningMonth}
              onChange={onChange}
              error={errors.internshipJoiningMonth}
              required
            />
          )}
          <TextInput
            label="College Referral Letter Number"
            name="permissionLetterNumber"
            value={form.permissionLetterNumber}
            onChange={onChange}
            error={errors.permissionLetterNumber}
          />
          <TextInput
            label="College Referral Letter Date"
            name="permissionLetterDate"
            type="date"
            value={form.permissionLetterDate}
            onChange={onChange}
            error={errors.permissionLetterDate}
            max={today}
            required
          />
          <FileInput
            label="College Referral Letter (Maximum File Size: 10 MB)"
            name="permissionLetter"
            onChange={onChange}
            error={errors.permissionLetter}
            accept="application/pdf,image/jpeg,image/jpg,image/png"
            required
          />
          <FileInput
            label="Aadhaar Card (Maximum File Size: 10 MB)"
            name="aadhaarCard"
            onChange={onChange}
            error={errors.aadhaarCard}
            accept="application/pdf,image/jpeg,image/jpg,image/png"
            required
          />
        </div>
      </section>

      <section className="form-section">
        <h2>Upload Documents</h2>
        <div className="form-grid">
          <FileInput
            label="Curriculum Vitae (Maximum File Size: 10 MB)"
            name="resume"
            onChange={onChange}
            error={errors.resume}
            accept="application/pdf"
            required
          />
          <FileInput
            label="Marksheet (Last Declared Result showing CGPA) (Maximum File Size: 10 MB)"
            name="result"
            onChange={onChange}
            error={errors.result}
            accept="application/pdf,image/jpeg,image/jpg"
            required
          />
          <FileInput
            label="Upload Passport Size Photograph (Maximum File Size: 1 MB)"
            name="photo"
            onChange={onChange}
            error={errors.photo}
            accept="image/png,image/jpeg,image/jpg"
            required
          />
          <TextInput
            label="College Identity Card Number"
            name="collegeId"
            value={form.collegeId}
            onChange={onChange}
            error={errors.collegeId}
            required
          />
        </div>
      </section>
    </>
  );
}

export default DocumentForm;
