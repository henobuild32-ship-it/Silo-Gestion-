"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarDays, Plus, RefreshCw, Search } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type ActivityRow = { id: string; titre: string; description: string | null; department_name: string; type: string; date_debut: string; date_fin: string | null; lieu: string | null; responsable: string | null; status: string };
type Department = { id: string; name: string };
const types = ["Culte", "Réunion", "Répétition", "Séminaire", "Retraite de prière", "Évangélisation", "Formation", "Activité sociale", "Programme spécial"];

export default function ActivitiesPage() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { const [a, d, me] = await Promise.all([apiFetch<{ activities: ActivityRow[] }>("/api/admin/activities"), apiFetch<{ departments: Department[] }>("/api/admin/departments"), apiFetch<{ permissions: string[] }>("/api/admin/me")]); setRows(a.activities); setDepartments(d.departments); setPermissions(me.permissions); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger le calendrier."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const departmentId = String(form.get("department_id") || "");
    setBusy(true); setError("");
    try {
      await apiFetch("/api/admin/activities", { method: "POST", body: JSON.stringify({
        titre: form.get("titre"), description: form.get("description"), department_id: departmentId || null, type: form.get("type"),
        date_debut: new Date(String(form.get("date_debut"))).toISOString(), date_fin: form.get("date_fin") ? new Date(String(form.get("date_fin"))).toISOString() : null,
        lieu: form.get("lieu"), observations: form.get("observations"),
      }) });
      formElement.reset(); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer l’activité."); }
    finally { setBusy(false); }
  }
  const canCreate = permissions.includes("activities.manage") || permissions.includes("activities.manage_assigned");
  const visible = rows.filter((item) => `${item.titre} ${item.department_name} ${item.type}`.toLowerCase().includes(query.toLowerCase()));

  return <AdminShell title="Programmes & activités"><div className="admin-content">
    <div className="page-heading"><div><h1>Programmes & activités</h1><p>Calendrier des activités générales et des départements auxquels vous avez accès.</p></div><button className="button secondary small" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Actualiser</button></div>
    {error && <div className="notice error" style={{ marginBottom: 14 }}>{error}</div>}
    {canCreate && <form className="card panel" onSubmit={(event) => void create(event)} style={{ marginBottom: 17 }}><div className="panel-heading"><div><h2>Ajouter une activité</h2><div className="field-hint" style={{ marginTop: 3 }}>Les champs avec astérisque sont requis.</div></div><Plus size={18} color="#658775" /></div>
      <div className="form-grid">
        <div className="field"><label>Titre *</label><input name="titre" required maxLength={160} /></div>
        <div className="field"><label>Type *</label><select name="type" required>{types.map((type) => <option key={type}>{type}</option>)}</select></div>
        <div className="field"><label>Département organisateur</label><select name="department_id"><option value="">Activité générale de l’Église</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></div>
        <div className="field"><label>Lieu</label><input name="lieu" maxLength={200} /></div>
        <div className="field"><label>Date et heure de début *</label><input name="date_debut" type="datetime-local" required /></div>
        <div className="field"><label>Date et heure de fin</label><input name="date_fin" type="datetime-local" /></div>
        <div className="field span-2"><label>Description</label><textarea name="description" maxLength={3000} /></div>
      </div>
      <button className="button small" style={{ marginTop: 13 }} disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer l’activité"}</button>
    </form>}
    <section className="card panel"><div className="panel-heading"><div><h2>Calendrier</h2><div className="field-hint" style={{ marginTop: 3 }}>{rows.length} activité(s) disponible(s)</div></div><CalendarDays size={18} color="#658775" /></div>
      <div className="filter-row"><div className="search-box"><Search size={16} /><input className="input" placeholder="Titre, type ou département…" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div>
      {loading && !rows.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : visible.length ? <div style={{ display: "grid", gap: 9 }}>{visible.map((activity) => <article className="card" key={activity.id} style={{ padding: 15, display: "grid", gridTemplateColumns: "70px 1fr auto", alignItems: "center", gap: 14, boxShadow: "none" }}><div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#edf4ef", color: "var(--green)" }}><div style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 800 }}>{new Date(activity.date_debut).toLocaleDateString("fr-FR", { month: "short" })}</div><strong style={{ font: "800 24px Manrope" }}>{new Date(activity.date_debut).getDate()}</strong><div style={{ fontSize: 10 }}>{new Date(activity.date_debut).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div></div><div><div style={{ fontWeight: 800 }}>{activity.titre}</div><div className="field-hint">{activity.type} · {activity.department_name}{activity.lieu ? ` · ${activity.lieu}` : ""}</div>{activity.description && <div className="field-hint" style={{ marginTop: 5 }}>{activity.description}</div>}</div><span className={`badge ${activity.status}`}>{activity.status === "active" ? "Actif" : activity.status}</span></article>)}</div> : <div className="empty-state"><CalendarDays size={25} /><strong>Aucune activité</strong>Les activités programmées apparaîtront ici.</div>}
    </section>
  </div></AdminShell>;
}
