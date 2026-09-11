import { useEffect, useMemo, useState } from "react";
import { addCollege, addManagementItem, deleteCollege, deleteManagementItem, fetchAdminColleges, fetchManagementItems, updateCollege, updateManagementItem } from "../services/adminService";
import { compareDurations } from "../utils/durationSort";
import "../styles/admin.css";

const sections = [
  { key: "colleges", singular: "College", list: fetchAdminColleges, add: (_, name) => addCollege(name), update: (_, id, name) => updateCollege(id, name), remove: (_, id) => deleteCollege(id) },
  { key: "courses", singular: "Course", hasLevel: true, list: fetchManagementItems, add: addManagementItem, update: updateManagementItem, remove: deleteManagementItem },
  { key: "branches", singular: "Branch", list: fetchManagementItems, add: addManagementItem, update: updateManagementItem, remove: deleteManagementItem },
  { key: "durations", singular: "Duration", list: fetchManagementItems, add: addManagementItem, update: updateManagementItem, remove: deleteManagementItem },
];

function ManagementSection({ config, initiallyOpen = true }) {
  const [items, setItems] = useState([]), [name, setName] = useState(""), [search, setSearch] = useState(""), [editing, setEditing] = useState(null), [editName, setEditName] = useState(""), [open, setOpen] = useState(initiallyOpen), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  // Course.level is required, so a course cannot be created without one. Only
  // the Courses section renders this; branches/durations have no level and the
  // service rejects one if sent.
  const [level, setLevel] = useState("undergraduate"), [editLevel, setEditLevel] = useState("");
  const load = async () => { setLoading(true); try { setItems(await config.list(config.key)); } catch (err) { setError(err.message); } finally { setLoading(false); } };
  useEffect(() => { Promise.resolve().then(load); }, []);
  const visible = useMemo(() => { const term = search.trim().toLowerCase(); return (term ? items.filter((item) => item.name.toLowerCase().includes(term)) : items).sort((a, b) => config.key === "durations" ? compareDurations(a.name, b.name) : a.name.localeCompare(b.name)); }, [config.key, items, search]);
  const durationName = (value) => `${String(value || "").replace(/\D/g, "")} Weeks`;
  const submit = async (event) => { event.preventDefault(); if (!name.trim()) return setError(`${config.singular} name is required.`); const value = config.key === "durations" ? durationName(name) : name; if (config.key === "durations" && value === " Weeks") return setError("Enter a numeric duration."); setSaving(true); setError(""); try { await config.add(config.key, value, config.hasLevel ? level : undefined); setName(""); await load(); } catch (err) { setError(err.message); } finally { setSaving(false); } };
  const saveEdit = async (item) => { if (!editName.trim()) return setError(`${config.singular} name is required.`); const value = config.key === "durations" ? durationName(editName) : editName; if (config.key === "durations" && value === " Weeks") return setError("Enter a numeric duration."); setSaving(true); setError(""); try { await config.update(config.key, item.id, value, config.hasLevel ? editLevel : undefined); setEditing(null); setEditName(""); await load(); } catch (err) { setError(err.message); } finally { setSaving(false); } };
  const remove = async (item) => { if (!window.confirm(`Delete "${item.name}"?`)) return; setError(""); try { await config.remove(config.key, item.id); await load(); } catch (err) { setError(err.message); setOpen(true); } };
  const listLabel = `${config.singular} List`;
  const searchPlaceholder = `Search ${config.key.charAt(0).toUpperCase() + config.key.slice(1)}`;
  const labelName = config.key === "durations" ? "Duration" : `${config.singular} Name`;

  return <section className="admin-panel">
    <div className="admin-panel__header"><button className="admin-secondary-btn" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "▲" : "▼"} {listLabel}</button></div>
    {/* Rendered OUTSIDE the {open && ...} body on purpose. Every section starts
        collapsed (initiallyOpen={false} below), so an error written into the
        body was invisible - a failed delete looked like nothing had happened. */}
    {error && <p className="admin-error" role="alert" style={{ marginBottom: "16px" }}>{error}</p>}
    {open && <>
      {/* 1. Search Bar at the very top */}
      <div style={{ marginBottom: "20px" }}>
        <input className="admin-search" style={{ width: "100%" }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
      </div>

      {/* 2. Add New Input + Add Button Section */}
      <form style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }} onSubmit={submit}>
        <div className="admin-field">
          <span>{labelName}</span>
          <input className="admin-search" style={{ width: "100%" }} value={name} inputMode={config.key === "durations" ? "numeric" : undefined} onChange={(event) => setName(config.key === "durations" ? event.target.value.replace(/\D/g, "") : event.target.value)} placeholder={config.key === "durations" ? "Number of weeks" : `${config.singular} name`} aria-label={`${config.singular} name`} />
          {config.key === "durations" && <span className="admin-muted">{name ? `${name} Weeks` : "Weeks"}</span>}
        </div>
        {config.hasLevel && <div className="admin-field">
          <span>Level</span>
          <select value={level} onChange={(event) => setLevel(event.target.value)} aria-label="Course level">
            <option value="undergraduate">Undergraduate</option>
            <option value="postgraduate">Postgraduate</option>
          </select>
        </div>}
        <button className="admin-primary-btn" style={{ alignSelf: "flex-start" }} disabled={saving} type="submit">{saving ? "Adding..." : `Add ${config.singular}`}</button>
      </form>


      {/* 3. Existing List Section */}
      {loading ? <div className="admin-loading">Loading {config.key}...</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Serial No.</th><th>{config.singular} Name</th>{config.hasLevel && <th>Level</th>}<th>Actions</th></tr></thead><tbody>{visible.length ? visible.map((item, index) => {
        const isEditing = editing && editing.id === item.id;
        return <tr key={item.id}>
          <td>{index + 1}</td>
          <td>
            {isEditing ? <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><input className="admin-search" style={{ minHeight: "34px", padding: "4px 8px", width: "100%" }} value={editName} inputMode={config.key === "durations" ? "numeric" : undefined} onChange={(event) => setEditName(config.key === "durations" ? event.target.value.replace(/\D/g, "") : event.target.value)} aria-label={`Edit ${config.singular} Name`} />{config.key === "durations" && <span className="admin-muted">{editName ? `${editName} Weeks` : "Weeks"}</span>}</div> : item.name}
          </td>
          {config.hasLevel && <td>
            {isEditing
              ? <select value={editLevel} onChange={(event) => setEditLevel(event.target.value)} aria-label="Edit course level"><option value="undergraduate">Undergraduate</option><option value="postgraduate">Postgraduate</option></select>
              : (item.level === "postgraduate" ? "Postgraduate" : item.level === "undergraduate" ? "Undergraduate" : "-")}
          </td>}
          <td>
            {isEditing ? <div style={{ display: "flex", gap: "8px" }}><button className="admin-primary-btn" style={{ minHeight: "34px", padding: "4px 10px", fontSize: "0.85rem" }} type="button" disabled={saving} onClick={() => saveEdit(item)}>{saving ? "Saving..." : "Save"}</button><button className="admin-secondary-btn" style={{ minHeight: "34px", padding: "4px 10px", fontSize: "0.85rem" }} type="button" onClick={() => { setEditing(null); setEditName(""); setEditLevel(""); }}>Cancel</button></div> : <div style={{ display: "flex", gap: "8px" }}><button className="admin-secondary-btn" type="button" onClick={() => { setEditing(item); setEditName(config.key === "durations" ? String(item.name).replace(/\D/g, "") : item.name); setEditLevel(item.level || "undergraduate"); }}>Edit</button><button className="admin-danger-btn" type="button" onClick={() => remove(item)}>Delete</button></div>}
          </td>
        </tr>;
      }) : <tr><td colSpan={config.hasLevel ? 4 : 3}>No {config.key} found.</td></tr>}</tbody></table></div>}
    </>}
  </section>;
}

export default function CollegeManagement() { return <main className="admin-console admin-shell"><header className="admin-topbar"><div><p className="portal-eyebrow">Admin Dashboard</p><h1>Management</h1></div><div style={{ display: "flex", gap: "10px" }}><button className="admin-secondary-btn" type="button" onClick={() => { window.history.pushState({}, "", "/admin/administration"); window.dispatchEvent(new PopStateEvent("popstate")); }}>Back to Dashboard</button><button className="admin-secondary-btn" type="button" onClick={() => { window.history.pushState({}, "", "/admin/dashboard"); window.dispatchEvent(new PopStateEvent("popstate")); }}>🏠 Home</button></div></header>{sections.map((section) => <ManagementSection key={section.key} config={section} initiallyOpen={false} />)}</main>; }
