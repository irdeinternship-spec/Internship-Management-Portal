import { useEffect, useRef, useState } from "react";
import { useReferenceData } from "../../hooks/useReferenceData";
import { saveDivisionConfigurations } from "../../services/adminService";
import { calculateTotalVacancy } from "../../utils/administrationAnalytics";

const emptyConfiguration = () => ({ allowedBranches: [], paidSeats: 0, unpaidSeats: 0, totalVacancy: 0, branchSeats: {} });

export default function DivisionBranchVacancyConfiguration({ administration, onSaved, onError }) {
  // Branches are live reference data now - editing them in the admin
  // Management screen changes this list immediately.
  const { branches } = useReferenceData();
  const [configurations, setConfigurations] = useState(() => administration.divisionConfigurations || {});
  const [openDivision, setOpenDivision] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const close = (event) => { if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setOpenDivision(""); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const update = (division, changes) => setConfigurations((current) => {
    const existing = current[division] || emptyConfiguration();
    const nextConfig = { ...existing, ...changes };
    nextConfig.totalVacancy = calculateTotalVacancy(nextConfig);
    return { ...current, [division]: nextConfig };
  });
  const toggleBranch = (division, branch) => {
    const configuration = configurations[division] || emptyConfiguration();
    const selected = configuration.allowedBranches;
    const branchSeats = { ...(configuration.branchSeats || {}) };
    if (selected.includes(branch)) delete branchSeats[branch];
    else branchSeats[branch] = branchSeats[branch] ?? { paid: 0, unpaid: 0 };
    update(division, { allowedBranches: selected.includes(branch) ? selected.filter((item) => item !== branch) : [...selected, branch], branchSeats });
  };
  const save = async () => {
    setSaving(true);
    try { const { configurations: saved } = await saveDivisionConfigurations(configurations); setConfigurations(saved); onSaved(saved); }
    catch (error) { onError(error.message); }
    finally { setSaving(false); }
  };
  const filteredBranches = branches.filter((branch) => branch.toLowerCase().includes(search.toLowerCase()));
  const updateSeats = (division, branch, type, value) => {
    if (!/^\d*$/.test(value)) return;
    const configuration = configurations[division] || emptyConfiguration();
    const existingBranchSeats = configuration.branchSeats?.[branch];
    let branchSeatsObj = { paid: 0, unpaid: 0 };
    if (existingBranchSeats && typeof existingBranchSeats === "object") {
      branchSeatsObj = { ...existingBranchSeats };
    } else {
      branchSeatsObj.unpaid = Number(existingBranchSeats ?? 0);
    }
    branchSeatsObj[type] = value === "" ? 0 : Number(value);
    update(division, { branchSeats: { ...(configuration.branchSeats || {}), [branch]: branchSeatsObj } });
  };
  const updateTypeSeats = (division, key, value) => {
    if (!/^\d*$/.test(value)) return;
    update(division, { [key]: value === "" ? 0 : Number(value) });
  };

  return <section className="administration-card administration-card--configuration">
    <div className="administration-card__heading"><span className="administration-icon" aria-hidden="true">⚙</span><div><h2>Division wise Branch &amp; Vacancy Configuration</h2><p>Configure eligible branches and branch-wise internship seats for every division.</p></div></div>

    <div className="division-configuration-table-wrap"><table className="division-configuration-table"><thead><tr><th>Division Names</th><th>Allowed Branches</th><th>Branch Seats</th><th>Total Vacancy</th></tr></thead><tbody>
      {[...administration.divisions].sort((a, b) => a.localeCompare(b)).map((division) => {
        const configuration = configurations[division] || emptyConfiguration();
        const isOpen = openDivision === division;
        return <tr key={division}><td><strong>{division}</strong></td><td><div className="branch-select" ref={isOpen ? dropdownRef : null}><button className="branch-select__trigger" type="button" aria-expanded={isOpen} onClick={() => { setOpenDivision(isOpen ? "" : division); setSearch(""); }}><span>{configuration.allowedBranches.length ? `${configuration.allowedBranches.length} branch${configuration.allowedBranches.length === 1 ? "" : "es"} selected` : "Select Branches"}</span><span className="branch-select__chevron" aria-hidden="true">⌄</span></button><div className={`branch-select__menu ${isOpen ? "branch-select__menu--open" : ""}`} aria-hidden={!isOpen}><input className="branch-select__search" tabIndex={isOpen ? 0 : -1} placeholder="Search branches..." value={search} onChange={(event) => setSearch(event.target.value)} /><div className="branch-select__options">{filteredBranches.map((branch) => <label key={branch} className="branch-select__option"><input type="checkbox" checked={configuration.allowedBranches.includes(branch)} onChange={() => toggleBranch(division, branch)} /><span>{branch}</span></label>)}{!filteredBranches.length && <p className="branch-select__empty">No branches found.</p>}</div></div></div></td><td><div className="branch-seat-inputs">{configuration.allowedBranches.length ? configuration.allowedBranches.map((branch) => {
          const val = configuration.branchSeats?.[branch];
          let paid = 0;
          let unpaid = 0;
          if (val && typeof val === "object") {
            paid = val.paid ?? 0;
            unpaid = val.unpaid ?? 0;
          } else {
            unpaid = val ?? 0;
          }
          return <div key={branch} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", margin: "6px 0" }}>
            <span style={{ fontSize: "0.9rem", flex: 1, minWidth: "150px" }}>{branch}</span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", margin: 0 }}>
                <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Paid:</span>
                <input className="vacancy-input" type="text" inputMode="numeric" style={{ width: "50px", padding: "2px 4px" }} value={paid} onChange={(event) => updateSeats(division, branch, "paid", event.target.value)} aria-label={`${branch} Paid seats for ${division}`} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", margin: 0 }}>
                <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Unpaid:</span>
                <input className="vacancy-input" type="text" inputMode="numeric" style={{ width: "50px", padding: "2px 4px" }} value={unpaid} onChange={(event) => updateSeats(division, branch, "unpaid", event.target.value)} aria-label={`${branch} Unpaid seats for ${division}`} />
              </label>
            </div>
          </div>;
        }) : <span className="branch-seat-inputs__empty">Select branches to set seats.</span>}</div></td><td><input className="vacancy-input" type="text" inputMode="numeric" readOnly value={configuration.totalVacancy} aria-label={`Total vacancy for ${division}`} /></td></tr>;
      })}
    </tbody></table></div>
    <div className="division-configuration-actions"><span>{administration.divisions.length} divisions configured</span><button className="admin-primary-btn" type="button" disabled={saving} onClick={save}>{saving ? "Saving..." : "Save Configuration"}</button></div>
  </section>;
}
