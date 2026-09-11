import { useEffect, useMemo, useRef, useState } from "react";

import { years } from "../../data/years";

import { fetchColleges } from "../../services/studentService";

import SearchableDropdown from "../Inputs/SearchableDropdown";
import SelectInput from "../Inputs/SelectInput";
import TextInput from "../Inputs/TextInput";

// `reference` comes from StudentForm's useReferenceData() - branches, courses
// and states are live reference data now, not hardcoded lists. StudentForm
// owns the hook so the loading/error gate is decided once for the whole form
// rather than independently per section.
// The four codes, mirroring Student.branchCode's enum and the server check in
// backend/controllers/studentController.js. Declared here rather than in
// StudentForm because StudentForm already imports this file - importing back
// the other way would make the pair circular.
export const BRANCH_CODES = ["EE", "ME", "CS", "PH"];

function AcademicSection({ form, errors, onChange, reference }) {
  const [collegeOptions, setCollegeOptions] = useState([]);

  const { branches, courses, courseOptions, states, loading, error } = reference;

  // Year options follow the selected course's level (Course.level, served by
  // /api/reference): an undergraduate course offers only "Final Year"; a
  // postgraduate one offers 1st and 2nd Year. Until a course is chosen, or if
  // its level is unknown, fall back to the full list rather than an empty one.
  const yearOptions = useMemo(() => {
    const level = courseOptions.find((option) => option.name === form.course)?.level;
    if (level === "undergraduate") return ["Final Year"];
    if (level === "postgraduate") return ["1st Year", "2nd Year"];
    return years;
  }, [courseOptions, form.course]);
  // A disabled control with an explicit "Loading..." placeholder, never an
  // empty enabled dropdown: an empty list reads as "there are no branches".
  const optionsUnavailable = loading || Boolean(error);
  const placeholderFor = (label) => (loading ? "Loading options..." : error ? "Unavailable" : label);

  // Clearing the year when the course changes is a side effect of the course
  // field, so it must not fire on first render or when re-validating - only
  // when the selected year is no longer offered.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!form.currentYear) return;
    if (yearOptions.includes(form.currentYear)) return;
    onChangeRef.current({ target: { name: "currentYear", value: "", type: "text" } });
  }, [yearOptions, form.currentYear]);

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
          label="Branch Code"
          name="branchCode"
          value={form.branchCode}
          onChange={onChange}
          options={BRANCH_CODES}
          error={errors.branchCode}
          required
        />

        <SelectInput
          label="Current Year"
          name="currentYear"
          value={form.currentYear}
          onChange={onChange}
          options={yearOptions}
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
