import { useEffect, useState } from "react";

import { years } from "../../data/years";

import { fetchColleges } from "../../services/studentService";

import SearchableDropdown from "../Inputs/SearchableDropdown";
import SelectInput from "../Inputs/SelectInput";
import TextInput from "../Inputs/TextInput";

// `reference` comes from StudentForm's useReferenceData() - branches, courses
// and states are live reference data now, not hardcoded lists. StudentForm
// owns the hook so the loading/error gate is decided once for the whole form
// rather than independently per section.
function AcademicSection({ form, errors, onChange, reference }) {
  const [collegeOptions, setCollegeOptions] = useState([]);

  const { branches, courses, states, loading, error } = reference;
  // A disabled control with an explicit "Loading..." placeholder, never an
  // empty enabled dropdown: an empty list reads as "there are no branches".
  const optionsUnavailable = loading || Boolean(error);
  const placeholderFor = (label) => (loading ? "Loading options..." : error ? "Unavailable" : label);

  useEffect(() => {
    async function loadColleges() {
      try {
        const data = await fetchColleges();

        const options = data.map((college) => college.name);

        // Add Other option at the end
        options.push("Other");

        setCollegeOptions(options);
      } catch (err) {
        console.error("Error loading colleges:", err);
      }
    }

    loadColleges();
  }, []);

  return (
    <section className="form-section">
      <h2>Academic Details</h2>

      <div className="form-grid">
        <SelectInput
          label="Course"
          name="course"
          value={form.course}
          onChange={onChange}
          options={courses}
          error={errors.course}
          disabled={optionsUnavailable}
          placeholder={placeholderFor("Select")}
          required
        />

        <SelectInput
          label="Branch / Specialisation"
          name="branch"
          value={form.branch}
          onChange={onChange}
          options={branches}
          error={errors.branch}
          disabled={optionsUnavailable}
          placeholder={placeholderFor("Select")}
          required
        />

        <SelectInput
          label="Current Year"
          name="currentYear"
          value={form.currentYear}
          onChange={onChange}
          options={years}
          error={errors.currentYear}
          required
        />

        <TextInput
          label="CGPA"
          name="cgpa"
          type="number"
          value={form.cgpa}
          onChange={onChange}
          error={errors.cgpa}
          required
        />

        <p className="field__warning">
          <span className="field__warning-icon" aria-hidden="true">&#9888;</span>
          <span>
            Warning: declaring a false CGPA will lead to blacklisting from
            future opportunities at this establishment.
          </span>
        </p>

        <SearchableDropdown
          label='College Name (If your college is not listed, select "Other")'
          name="collegeName"
          value={form.collegeName}
          onChange={onChange}
          options={collegeOptions}
          error={errors.collegeName}
          required
        />

        {form.collegeName === "Other" && (
          <TextInput
            label="Enter College Name"
            name="otherCollegeName"
            value={form.otherCollegeName || ""}
            onChange={onChange}
            required
          />
        )}

        <TextInput
          label="College Address"
          name="collegeAddress"
          value={form.collegeAddress}
          onChange={onChange}
          error={errors.collegeAddress}
          required
          as="textarea"
        />

        <TextInput
          label="College Location"
          name="collegeLocation"
          value={form.collegeLocation}
          onChange={onChange}
          error={errors.collegeLocation}
          required
        />

        <SearchableDropdown
          label="College State"
          name="collegeState"
          value={form.collegeState}
          onChange={onChange}
          options={states}
          error={errors.collegeState}
          disabled={optionsUnavailable}
          placeholder={placeholderFor("Search and select")}
          required
        />
      </div>
    </section>
  );
}

export default AcademicSection;
