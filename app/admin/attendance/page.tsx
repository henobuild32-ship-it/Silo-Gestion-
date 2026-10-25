"use client";

import { FormEvent, useEffect, useState } from "react";
import { Activity, Check, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type Department = { id: string; name: string };
type Member = { id: string; member_number: string; nom: string; postnom: string; prenom: string };
type ActivityOption = { id: string; titre: string; department_id: string; date_debut: string };
type Attendance = { id: string; event_date: string; statut_presence: string; member_name: string; department_name: string; recorded_by_name: string | null };
type Payload = { departments: Department[]; members: Member[]; activities: ActivityOption[]; rows: Attendance[] };

export default function AttendancePage() {
  const [data, setData] = useState<Payload>({ departments: [], members: [], activities: [], rows: [] });
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [department, setDepartment] = useState("");

  async function load(selectedDepartment = department) {
    setLoading(true); setError("");
    try {
      const [result, me] = await Promise.all([apiFetch<Payload>(`/api/admin/attendance${selectedDepartment ? `?department=${selectedDepartment}` : ""}`), apiFetch<{ permissions: string[] }>("/api/admin/me")]);
      setData(result); setPermissions(me.permissions); if (!selectedDepartment && result.departments.length === 1) setDepartment(result.departments[0].id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les présences."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(""); }, []);
  useEffect(() => { if (department) void load(department); }, [department]);

  async function mark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      await apiFetch("/api/admin/attendance", { method: "POST", body: JSON.stringify({ member_id: form.get("member_id"), department_id: form.get("department_id"), activity_id: form.get("activity_id") || null, event_date: form.get("event_date"), statut_presence: form.get("statut_presence") }) });
      await load(department);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Le pointage n’a pas été enregistré."); }
    finally { setBusy(false); }
  }
  const canWrite = permissions.includes("attendance.write");
  const relevantActivities = data.activities.filter((item) => item.department_id === department);
  return <AdminShell title="Présences & absences"><div className="admin-content">
    <div className="page-heading"><div><h1>Présences & absences</h1><p>Les pointages sont associés à une activité ou à une date et à un département.</p></div><button className="button secondary small" onClick={() => void load(department)} disabled={loading}><RefreshCw size={14} /> Actualiser</button></div>
    {error && <div className="notice error" style={{ marginBottom: 14 }}>{error}</div>}
    {canWrite && <form className="card panel" onSubmit={(event) => void mark(event)} style={{ marginBottom: 17 }}><div className="panel-heading"><div><h2>Enregistrer un pointage</h2><div className="field-hint" style={{ marginTop: 3 }}>Un seul pointage est accepté par personne et par activité.</div></div><Check size={18} color="#658775" /></div>
      <div className="form-grid"><div className="field"><label>Département *</label><select name="department_id" value={department} required onChange={(event) => setDepartment(event.target.value)}><option value="">Sélectionner</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label>Membre ou ouvrier *</label><select name="member_id" required disabled={!department}><option value="">Sélectionner</option>{data.members.map((member) => <option value={member.id} key={member.id}>{member.member_number} — {member.nom} {member.postnom} {member.prenom}</option>)}</select></div>
        <div className="field"><label>Activité</label><select name="activity_id"><option value="">Pointage de la journée</option>{relevantActivities.map((activity) => <option value={activity.id} key={activity.id}>{activity.titre}</option>)}</select></div>
        <div className="field"><label>Date *</label><input name="event_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></div>
        <div className="field"><label>Statut *</label><select name="statut_presence"><option value="present">Présent</option><option value="absent">Absent</option></select></div></div>
      <button className="button small" style={{ marginTop: 13 }} disabled={busy || !department}>{busy ? "Enregistrement…" : "Enregistrer le pointage"}</button>
    </form>}
    <section className="card panel"><div className="panel-heading"><div><h2>Historique récent</h2><div className="field-hint" style={{ marginTop: 3 }}>Les corrections administratives gardent une trace distincte.</div></div><Activity size={18} color="#658775" /></div>
      <div className="filter-row"><select className="select-compact" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">Tous mes départements</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      {loading && !data.rows.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : data.rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Personne</th><th>Département</th><th>Statut</th><th>Pointé par</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{new Date(row.event_date).toLocaleDateString("fr-FR")}</td><td><strong>{row.member_name}</strong></td><td>{row.department_name}</td><td><span className={`badge ${row.statut_presence === "present" ? "approved" : "rejected"}`}>{row.statut_presence === "present" ? "Présent" : "Absent"}</span></td><td>{row.recorded_by_name ?? "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><Activity size={25} /><strong>Aucun pointage</strong>Les présences enregistrées apparaîtront ici.</div>}
    </section>
  </div></AdminShell>;
}
