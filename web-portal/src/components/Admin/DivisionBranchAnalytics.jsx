import { useMemo, useState } from "react";
import { useReferenceData } from "../../hooks/useReferenceData";
import { getAllocatedStudents } from "../../utils/administrationAnalytics";
import StudentDivisionRecommendation from "./StudentDivisionRecommendation";

const palette = ["#155eaa", "#2f8bd5", "#4da3e8", "#37a779", "#e4a33a", "#8b6bd9", "#df6b6b", "#2e8b8b"];

function PieChart({ data, mode, emptyLabel }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <div className="analytics-chart analytics-chart--empty"><div className="analytics-pie analytics-pie--empty" role="img" aria-label="No students allocated"><span>0</span><small>Students</small></div><p className="analytics-chart__empty-message">{emptyLabel}</p></div>;
  const visibleData = data.filter((item) => item.value > 0);
  const { stops } = visibleData.reduce((state, item, index) => {
    const next = state.cursor + (item.value / total) * 100;
    state.stops.push(`${palette[index % palette.length]} ${state.cursor}% ${next}%`);
    return { cursor: next, stops: state.stops };
  }, { cursor: 0, stops: [] });

  const sortedData = [...visibleData].sort((a, b) => {
    if (b.value !== a.value) {
      return b.value - a.value;
    }
    return a.label.localeCompare(b.label);
  });

  return (
    <div className="analytics-chart" style={{ display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap" }}>
      <div className="analytics-pie" style={{ background: `conic-gradient(${stops.join(", ")})` }} aria-label="Student distribution chart" role="img">
        <span>{total}</span>
        <small>Students</small>
      </div>
      <div style={{ flex: "1 1 240px", minWidth: "220px", maxHeight: "160px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem", textAlign: "left" }}>
          <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 1, borderBottom: "1px solid #e2e8f0" }}>
            <tr>
              <th style={{ padding: "6px 8px", fontWeight: "600", color: "#64748b", textTransform: "uppercase" }}>
                {mode === "branch" ? "Division" : "Branch"}
              </th>
              <th style={{ padding: "6px 8px", fontWeight: "600", color: "#64748b", textTransform: "uppercase", textAlign: "right" }}>Paid</th>
              <th style={{ padding: "6px 8px", fontWeight: "600", color: "#64748b", textTransform: "uppercase", textAlign: "right" }}>Unpaid</th>
              <th style={{ padding: "6px 8px", fontWeight: "600", color: "#64748b", textTransform: "uppercase", textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((item, index) => (
              <tr key={item.label} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: palette[index % palette.length] }} />
                  <span style={{ fontWeight: "500" }}>{item.label}</span>
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: "#475569" }}>{item.paid}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: "#475569" }}>{item.unpaid}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "700" }}>{item.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DivisionBranchAnalytics({ administration, students, loading, error, onModeChange }) {
  // Branches are live reference data now - editing them in the admin
  // Management screen changes this list immediately.
  const { branches } = useReferenceData();
  const [mode, setMode] = useState("branch");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedDivision, setSelectedDivision] = useState("");
  const activeDivision = administration.divisions.includes(selectedDivision) ? selectedDivision : administration.divisions[0] || "";
  // Derived, not seeded into useState: branches now arrive asynchronously, so
  // `useState(branches[0])` would capture the empty first render and never
  // update. Falling back to the first branch here also re-selects sensibly if
  // the chosen branch is deleted from the reference collection while open -
  // same shape as activeDivision directly above.
  const activeBranch = branches.includes(selectedBranch) ? selectedBranch : branches[0] || "";

  const analyticsStudents = useMemo(() => {
    return students.filter((s) => {
      const completion = String(s.completedStatus || s.trainingManagement?.completed || "").trim().toLowerCase();
      return completion !== "yes";
    });
  }, [students]);

  const allocated = useMemo(() => getAllocatedStudents(analyticsStudents, administration.divisions), [analyticsStudents, administration.divisions]);

  const branchRows = useMemo(() => administration.divisions.map((division) => {
    const matched = allocated.filter((student) => student.branch === activeBranch && student.trainingManagement?.division === division);
    const paid = matched.filter(s => (s.internshipType || "").toLowerCase() === "paid").length;
    const unpaid = matched.filter(s => (s.internshipType || "Unpaid").toLowerCase() === "unpaid").length;
    return { label: division, value: matched.length, paid, unpaid };
  }), [administration.divisions, allocated, activeBranch]);

  const divisionRows = useMemo(() => branches.map((branch) => {
    const matched = allocated.filter((student) => student.trainingManagement?.division === activeDivision && student.branch === branch);
    const paid = matched.filter(s => (s.internshipType || "").toLowerCase() === "paid").length;
    const unpaid = matched.filter(s => (s.internshipType || "Unpaid").toLowerCase() === "unpaid").length;
    return { label: branch, value: matched.length, paid, unpaid };
  }), [allocated, activeDivision, branches]);

  const activeRows = mode === "branch" ? branchRows : divisionRows;

  const sortedRows = useMemo(() => {
    return [...activeRows].sort((a, b) => {
      if (b.value !== a.value) {
        return b.value - a.value;
      }
      return a.label.localeCompare(b.label);
    });
  }, [activeRows]);

  return <section className="administration-card administration-card--analytics">
    <div className="administration-card__heading"><span className="administration-icon" aria-hidden="true">◔</span><div><h2>Division &amp; Branch Analytics</h2><p>View real-time internship allocation statistics and vacancy insights.</p></div></div>
    <div className="analytics-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode === "branch"} className={mode === "branch" ? "is-active" : ""} onClick={() => { setMode("branch"); onModeChange?.("branch"); }}>Branch Analytics</button><button type="button" role="tab" aria-selected={mode === "division"} className={mode === "division" ? "is-active" : ""} onClick={() => { setMode("division"); onModeChange?.("division"); }}>Division Analytics</button></div>
    {loading ? <div className="analytics-skeleton"><span /><span /><span /></div> : error ? <div className="analytics-empty"><span aria-hidden="true">!</span><p>{error}</p></div> : <>
      <div className="analytics-selector" aria-label={mode === "branch" ? "Select branch" : "Select division"}>{[...(mode === "branch" ? branches : administration.divisions)].sort((a, b) => a.localeCompare(b)).map((item) => <button type="button" key={item} className={(mode === "branch" ? activeBranch : activeDivision) === item ? "is-active" : ""} onClick={() => mode === "branch" ? setSelectedBranch(item) : setSelectedDivision(item)}>{item}</button>)}</div>
      <div className="analytics-content">
        <div className="analytics-table-wrap">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>{mode === "branch" ? "Division" : "Branch"}</th>
                <th>Allocated Students</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PieChart data={activeRows} mode={mode} emptyLabel="No students currently allocated." />
      </div>
      {mode === "division" && <p className="analytics-caption">Chart: current student distribution by branch for {activeDivision || "the selected division"}.</p>}
    </>}
    <div className="analytics-actions" style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end" }}>
      <StudentDivisionRecommendation students={students} administration={administration} />
    </div>
  </section>;
}
