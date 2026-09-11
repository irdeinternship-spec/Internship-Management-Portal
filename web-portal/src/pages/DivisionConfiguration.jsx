import { useEffect, useRef, useState } from "react";
import { useReferenceData } from "../hooks/useReferenceData";
import { fetchDivisionConfigurations, saveDivisionConfigurations } from "../services/adminService";
import { calculateTotalVacancy } from "../utils/administrationAnalytics";
import "../styles/admin.css";

const blankConfiguration = () => ({ allowedBranches: [], totalVacancy: 0, branchSeats: {} });

function DivisionConfiguration() {
  // Branches are live reference data now - editing them in the admin
  // Management screen changes this list immediately.
  const { branches } = useReferenceData();
  const [divisions, setDivisions] = useState([]);
  const [configurations, setConfigurations] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openDivision, setOpenDivision] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetchDivisionConfigurations().then(({ divisions: nextDivisions, configurations: nextConfigurations }) => {
      if (!active) return;
      setDivisions(nextDivisions);
      setConfigurations(nextConfigurations);
    }).catch((requestError) => active && setError(requestError.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const closeDropdown = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setOpenDivision("");
    };
    document.addEventListener("mousedown", closeDropdown);
    return () => document.removeEventListener("mousedown", closeDropdown);
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(() => setMessage(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const updateConfiguration = (division, update) => {
    setConfigurations((current) => {
      const existing = current[division] || blankConfiguration();
      const nextConfig = { ...existing, ...update };
      nextConfig.totalVacancy = calculateTotalVacancy(nextConfig);
      return { ...current, [division]: nextConfig };
    });
  };

  const toggleBranch = (division, branch) => {
    const configuration = configurations[division] || blankConfiguration();
    const selected = configuration.allowedBranches || [];
    const branchSeats = { ...(configuration.branchSeats || {}) };
    if (selected.includes(branch)) {
      delete branchSeats[branch];
    } else {
      branchSeats[branch] = branchSeats[branch] ?? 0;
    }
    const allowedBranches = selected.includes(branch)
      ? selected.filter((item) => item !== branch)
      : [...selected, branch];
    updateConfiguration(division, { allowedBranches, branchSeats });
  };

  const save = async () => {
    setSaving(true); setError("");
    try {
      const { configurations: saved } = await saveDivisionConfigurations(configurations);
      setConfigurations(saved);
      setMessage("Division configuration updated successfully.");
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  };

  const navigateBack = () => { window.history.pushState({}, "", "/admin/administration"); window.dispatchEvent(new PopStateEvent("popstate")); };
  const filteredBranches = branches.filter((branch) => branch.toLowerCase().includes(search.toLowerCase()));

  return <main className="admin-console admin-shell division-configuration-page">
    <header className="admin-topbar administration-topbar"><div><p className="portal-eyebrow">Administration</p><h1>Division wise Branch &amp; Vacancy Configuration</h1><p className="administration-subtitle">Configure the eligible branches and internship vacancies for every division.</p></div><button className="admin-secondary-btn" type="button" onClick={navigateBack}>← Administration</button></header>
    {message && <div className="administration-toast administration-toast--success" role="status">✓ {message}</div>}
    {error && <div className="administration-toast administration-toast--error" role="alert">{error}</div>}
    <section className="division-configuration-card">
      {loading ? <div className="division-configuration-skeleton" aria-label="Loading division configuration"><span /><span /><span /><span /><span /></div> : <>
        <div className="division-configuration-table-wrap"><table className="division-configuration-table"><thead><tr><th>Division Names</th><th>Allowed Branches</th><th>Total Vacancy</th></tr></thead><tbody>
          {[...divisions].sort((a, b) => a.localeCompare(b)).map((division) => {
            const configuration = configurations[division] || blankConfiguration();
            const isOpen = openDivision === division;
            return <tr key={division}><td><strong>{division}</strong></td><td><div className="branch-select" ref={isOpen ? dropdownRef : null}><button className="branch-select__trigger" type="button" aria-expanded={isOpen} onClick={() => { setOpenDivision(isOpen ? "" : division); setSearch(""); }}><span>{configuration.allowedBranches.length ? `${configuration.allowedBranches.length} branch${configuration.allowedBranches.length === 1 ? "" : "es"} selected` : "Select Branches"}</span><span className="branch-select__chevron" aria-hidden="true">⌄</span></button>{isOpen && <div className="branch-select__menu"><input className="branch-select__search" autoFocus placeholder="Search branches..." value={search} onChange={(event) => setSearch(event.target.value)} /> <div className="branch-select__options">{filteredBranches.map((branch) => <label key={branch} className="branch-select__option"><input type="checkbox" checked={configuration.allowedBranches.includes(branch)} onChange={() => toggleBranch(division, branch)} /><span>{branch}</span></label>)}{!filteredBranches.length && <p className="branch-select__empty">No branches found.</p>}</div></div>}</div></td><td><input className="vacancy-input" type="text" inputMode="numeric" readOnly value={configuration.totalVacancy} aria-label={`Total vacancy for ${division}`} /></td></tr>;
          })}
        </tbody></table></div>
        <div className="division-configuration-actions"><span>{divisions.length} divisions configured</span><button className="admin-primary-btn" type="button" disabled={saving} onClick={save}>{saving ? "Saving..." : "Save Configuration"}</button></div>
      </>}
    </section>
  </main>;
}

export default DivisionConfiguration;
