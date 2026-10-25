"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Activity, Check, RefreshCw, WifiOff } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";
import { PendingAttendance, queueAttendance, readAttendanceQueue, readAttendanceSnapshot, removeQueuedAttendance, saveAttendanceSnapshot } from "@/lib/offline-store";

type Department = { id: string; name: string };
type Member = { id: string; member_number: string; nom: string; postnom: string; prenom: string };
type ActivityOption = { id: string; titre: string; department_id: string; date_debut: string };
type Attendance = { id: string; event_date: string; statut_presence: string; member_name: string; department_name: string; recorded_by_name: string | null };
type Payload = { departments: Department[]; members: Member[]; activities: ActivityOption[]; rows: Attendance[] };
type OfflineAttendanceCache = { data: Payload; permissions: string[] };

export default function AttendancePage() {
  const [data, setData] = useState<Payload>({ departments: [], members: [], activities: [], rows: [] });
  const [permissions, setPermissions] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<PendingAttendance[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [department, setDepartment] = useState("");
  const syncLock = useRef(false);

  async function refreshQueue(id = userId) {
    if (!id) return;
    try { setPending(await readAttendanceQueue(id)); } catch { /* IndexedDB may be unavailable in private browsing. */ }
  }

  async function load(selectedDepartment = department) {
    setLoading(true); setError("");
    try {
      const [result, me] = await Promise.all([
        apiFetch<Payload>(`/api/admin/attendance${selectedDepartment ? `?department=${encodeURIComponent(selectedDepartment)}` : ""}`),
        apiFetch<{ userId: string; permissions: string[] }>("/api/admin/me"),
      ]);
      setData(result); setPermissions(me.permissions); setUserId(me.userId); setOffline(false);
      localStorage.setItem("silo-offline-user-id", me.userId);
      await saveAttendanceSnapshot<OfflineAttendanceCache>(me.userId, { data: result, permissions: me.permissions }).catch(() => undefined);
      await refreshQueue(me.userId);
      if (!selectedDepartment && result.departments.length === 1) setDepartment(result.departments[0].id);
    } catch (reason) {
      const localUserId = localStorage.getItem("silo-offline-user-id") ?? "";
      if (localUserId) {
        const cached = await readAttendanceSnapshot<OfflineAttendanceCache>(localUserId).catch(() => null);
        if (cached) {
          setUserId(localUserId); setData(cached.data.data); setPermissions(cached.data.permissions); setOffline(true); setError("");
          await refreshQueue(localUserId);
          if (!selectedDepartment && cached.data.data.departments.length === 1) setDepartment(cached.data.data.departments[0].id);
          setLoading(false); return;
        }
      }
      setError(reason instanceof Error ? reason.message : "Impossible de charger les présences.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(""); }, []);
  useEffect(() => { if (department) void load(department); }, [department]);

  async function syncPending() {
    if (!userId || syncLock.current || !navigator.onLine) return;
    syncLock.current = true; setSyncing(true);
    let synced = 0; let duplicate = 0;
    try {
      const entries = await readAttendanceQueue(userId);
      for (const entry of entries) {
        try {
          await apiFetch("/api/admin/attendance", { method: "POST", body: JSON.stringify(entry.payload) });
          await removeQueuedAttendance(entry.id); synced += 1;
        } catch (reason) {
          if (reason instanceof Error && reason.message.includes("existe déjà")) {
            await removeQueuedAttendance(entry.id); duplicate += 1; continue;
          }
          break;
        }
      }
      await refreshQueue(userId);
      if (synced || duplicate) {
        setOffline(false);
        const duplicateMessage = duplicate ? `; ${duplicate} doublon(s) ignoré(s)` : "";
        setNotice(`${synced} pointage(s) synchronisé(s)${duplicateMessage}.`);
        await load(department);
      }
    } finally { syncLock.current = false; setSyncing(false); }
  }

  useEffect(() => {
    const onOnline = () => { setOffline(false); void syncPending(); };
    window.addEventListener("online", onOnline);
    if (navigator.onLine) void syncPending();
    return () => window.removeEventListener("online", onOnline);
  }, [userId]);

  async function mark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      member_id: String(form.get("member_id") ?? ""),
      department_id: String(form.get("department_id") ?? ""),
      activity_id: String(form.get("activity_id") || "") || null,
      event_date: String(form.get("event_date") ?? ""),
      statut_presence: String(form.get("statut_presence") ?? "present") as "present" | "absent",
    };
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch("/api/admin/attendance", { method: "POST", body: JSON.stringify(payload) });
      setNotice("Pointage enregistré.");
      await load(department);
    } catch (reason) {
      const networkFailure = !navigator.onLine || reason instanceof TypeError;
      if (networkFailure && userId) {
        const item: PendingAttendance = { id: crypto.randomUUID(), userId, createdAt: new Date().toISOString(), payload };
        try {
          await queueAttendance(item); await refreshQueue(userId); setOffline(true);
          setNotice("Pointage gardé sur cet appareil. Il sera envoyé automatiquement au retour de la connexion.");
          formElement.reset();
        } catch {
          setError("Le pointage n’a pas pu être conservé hors ligne. Libérez de l’espace sur l’appareil puis réessayez.");
        }
      } else {
        setError(reason instanceof Error ? reason.message : "Le pointage n’a pas été enregistré.");
      }
    } finally { setBusy(false); }
  }

  const canWrite = permissions.includes("attendance.write");
  const relevantActivities = data.activities.filter((item) => item.department_id === department);
  return <AdminShell title="Présences & absences"><div className="admin-content">
    <div className="page-heading"><div><h1>Présences & absences</h1><p>Les pointages en attente seront synchronisés dès le retour du réseau.</p></div><button className="button secondary small" onClick={() => void load(department)} disabled={loading}><RefreshCw size={14} /> Actualiser</button></div>
    {offline && <div className="notice warn" style={{ marginBottom: 14 }}><WifiOff size={17} /> Mode hors ligne : les listes affichées proviennent de la dernière synchronisation de ce compte.</div>}
    {pending.length > 0 && <div className="notice warn" style={{ marginBottom: 14 }} role="status">{pending.length} pointage(s) attendent la synchronisation{syncing ? " en cours…" : navigator.onLine ? " — synchronisation en cours" : " — connexion requise"}.</div>}
    {notice && <div className="notice" style={{ marginBottom: 14 }} role="status">{notice}</div>}
    {error && <div className="notice error" style={{ marginBottom: 14 }}>{error}</div>}
    {canWrite && <form className="card panel" onSubmit={(event) => void mark(event)} style={{ marginBottom: 17 }}><div className="panel-heading"><div><h2>Enregistrer un pointage</h2><div className="field-hint" style={{ marginTop: 3 }}>En mode hors ligne, le pointage est conservé localement puis synchronisé.</div></div><Check size={18} color="#658775" /></div>
      <div className="form-grid"><div className="field"><label>Département *</label><select name="department_id" value={department} required onChange={(event) => setDepartment(event.target.value)}><option value="">Sélectionner</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label>Membre ou ouvrier *</label><select name="member_id" required disabled={!department}><option value="">Sélectionner</option>{data.members.map((member) => <option value={member.id} key={member.id}>{member.member_number} — {member.nom} {member.postnom} {member.prenom}</option>)}</select></div>
        <div className="field"><label>Activité</label><select name="activity_id"><option value="">Pointage de la journée</option>{relevantActivities.map((activity) => <option value={activity.id} key={activity.id}>{activity.titre}</option>)}</select></div>
        <div className="field"><label>Date *</label><input name="event_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></div>
        <div className="field"><label>Statut *</label><select name="statut_presence"><option value="present">Présent</option><option value="absent">Absent</option></select></div></div>
      <button className="button small" style={{ marginTop: 13 }} disabled={busy || !department}>{busy ? "Enregistrement…" : offline ? "Garder le pointage hors ligne" : "Enregistrer le pointage"}</button>
      {offline && <div className="field-hint" style={{ marginTop: 9 }}>Les nouveaux pointages attendent la connexion avant d’être enregistrés dans la base.</div>}
    </form>}
    <section className="card panel"><div className="panel-heading"><div><h2>Historique récent</h2><div className="field-hint" style={{ marginTop: 3 }}>Données conservées sur cet appareil : 30 jours maximum.</div></div><Activity size={18} color="#658775" /></div>
      <div className="filter-row"><select className="select-compact" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">Tous mes départements</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      {loading && !data.rows.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : data.rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Personne</th><th>Département</th><th>Statut</th><th>Pointé par</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{new Date(row.event_date).toLocaleDateString("fr-FR")}</td><td><strong>{row.member_name}</strong></td><td>{row.department_name}</td><td><span className={`badge ${row.statut_presence === "present" ? "approved" : "rejected"}`}>{row.statut_presence === "present" ? "Présent" : "Absent"}</span></td><td>{row.recorded_by_name ?? "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><Activity size={25} /><strong>Aucun pointage</strong>Les présences enregistrées apparaîtront ici.</div>}
    </section>
  </div></AdminShell>;
}
