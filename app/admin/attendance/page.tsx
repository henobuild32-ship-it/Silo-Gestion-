"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, RefreshCw, WifiOff } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";
import { PendingAttendance, queueAttendance, readAttendanceQueue, readAttendanceSnapshot, removeQueuedAttendance, saveAttendanceSnapshot } from "@/lib/offline-store";

type Department = { id: string; name: string };
type Member = { id: string; member_number: string; nom: string; postnom: string; prenom: string; departments?: Department[] };
type AttendanceStatus = "present" | "absent" | "justified";
type Attendance = { id: string; event_date: string; event_name?: string; statut_presence: AttendanceStatus; justification?: string | null; member_name: string; department_name: string; recorded_by_name: string | null };
type Payload = { departments: Department[]; members: Member[]; rows: Attendance[] };
type OfflineAttendanceCache = { data: Payload; permissions: string[]; role?: string };
const eventOptions = ["Culte", "Prière des Ouvriers", "Culte du Mercredi soir"];
const statusLabels: Record<AttendanceStatus, string> = { present: "Présent", absent: "Absent", justified: "Justifié" };
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function AttendancePage() {
  const [data, setData] = useState<Payload>({ departments: [], members: [], rows: [] });
  const [permissions, setPermissions] = useState<string[]>([]);
  const [role, setRole] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<PendingAttendance[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [department, setDepartment] = useState("");
  const [eventDate, setEventDate] = useState(localDate);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([eventOptions[0]]);
  const [customEvent, setCustomEvent] = useState("");
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus | "">>({});
  const [justifications, setJustifications] = useState<Record<string, string>>({});
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
        apiFetch<{ userId: string; role: string; permissions: string[] }>("/api/admin/me"),
      ]);
      setData(result); setPermissions(me.permissions); setRole(me.role); setUserId(me.userId); setOffline(false);
      localStorage.setItem("silo-offline-user-id", me.userId);
      await saveAttendanceSnapshot<OfflineAttendanceCache>(me.userId, { data: result, permissions: me.permissions, role: me.role }).catch(() => undefined);
      await refreshQueue(me.userId);
    } catch (reason) {
      const localUserId = localStorage.getItem("silo-offline-user-id") ?? "";
      if (localUserId) {
        const cached = await readAttendanceSnapshot<OfflineAttendanceCache>(localUserId).catch(() => null);
        if (cached) {
          const oldSnapshot = cached.data.data;
          const onlyCachedDepartment = oldSnapshot.departments.length === 1 ? oldSnapshot.departments : [];
          setUserId(localUserId); setData({ ...oldSnapshot, members: oldSnapshot.members.map((member) => ({ ...member, departments: member.departments ?? onlyCachedDepartment })) }); setPermissions(cached.data.permissions); setRole(cached.data.role ?? ""); setOffline(true); setError("");
          await refreshQueue(localUserId);
          setLoading(false); return;
        }
      }
      setError(reason instanceof Error ? reason.message : "Impossible de charger les présences.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(""); }, 0);
    return () => window.clearTimeout(timer);
  // The initial load uses the current department filter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!department) return;
    const timer = window.setTimeout(() => { void load(department); }, 0);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const eventNames = useMemo(() => [...new Set([...selectedEvents, customEvent.trim()].filter(Boolean))], [selectedEvents, customEvent]);
  const roster = useMemo(() => (department ? data.members.filter((member) => member.departments?.some((item) => item.id === department)) : data.members)
    .filter((member) => Boolean(member.departments?.length)), [data.members, department]);

  function toggleEvent(name: string) {
    setSelectedEvents((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  async function saveOffline(records: PendingAttendance["payload"][]) {
    if (!userId) throw new Error("Le compte hors ligne n’est pas identifié sur cet appareil.");
    const timestamp = new Date().toISOString();
    const queued = records.map((payload) => ({ id: crypto.randomUUID(), userId, createdAt: timestamp, payload }));
    for (const item of queued) await queueAttendance(item);
    await refreshQueue(userId);
    setOffline(true);
    setNotice(`${queued.length} pointage(s) gardé(s) sur cet appareil. Ils seront synchronisés au retour de la connexion.`);
    setStatuses({}); setJustifications({});
  }

  async function mark() {
    setError(""); setNotice("");
    if (!eventNames.length) { setError("Sélectionnez au moins un événement ou saisissez son nom."); return; }
    const markedMembers = roster.filter((member) => statuses[member.id]);
    if (!markedMembers.length) { setError("Choisissez Présent, Absent ou Justifié pour au moins un ouvrier."); return; }
    const missingJustification = markedMembers.find((member) => statuses[member.id] === "justified" && (justifications[member.id] ?? "").trim().length < 2);
    if (missingJustification) { setError(`Ajoutez le motif de justification pour ${missingJustification.prenom} ${missingJustification.nom}.`); return; }
    const records = markedMembers.flatMap((member) => (member.departments ?? [])
      .filter((item) => !department || item.id === department)
      .flatMap((item) => eventNames.map((event_name) => ({
        member_id: member.id,
        department_id: item.id,
        activity_id: null,
        event_name,
        event_date: eventDate,
        statut_presence: statuses[member.id] as AttendanceStatus,
        justification: statuses[member.id] === "justified" ? justifications[member.id].trim() : "",
      }))));
    if (!records.length) { setError("Aucun département autorisé n’est associé aux personnes sélectionnées."); return; }
    if (!window.confirm(`Enregistrer ${records.length} pointage(s) pour le ${new Date(`${eventDate}T12:00:00`).toLocaleDateString("fr-FR")} — ${eventNames.join(", ")}?`)) return;
    setBusy(true);
    try {
      if (!navigator.onLine || offline) {
        await saveOffline(records);
      } else {
        try {
          await apiFetch("/api/admin/attendance", { method: "POST", body: JSON.stringify({ records }) });
          setNotice(`${records.length} pointage(s) enregistré(s).`);
          setStatuses({}); setJustifications({});
          await load(department);
        } catch (reason) {
          if (reason instanceof TypeError || !navigator.onLine) await saveOffline(records);
          else if (reason instanceof Error && reason.message.includes("existe déjà")) {
            let saved = 0; let duplicates = 0;
            for (const record of records) {
              try { await apiFetch("/api/admin/attendance", { method: "POST", body: JSON.stringify(record) }); saved += 1; }
              catch (oneError) {
                if (oneError instanceof Error && oneError.message.includes("existe déjà")) duplicates += 1;
                else throw oneError;
              }
            }
            setNotice(`${saved} pointage(s) enregistré(s), ${duplicates} doublon(s) déjà présent(s).`);
            setStatuses({}); setJustifications({}); await load(department);
          } else throw reason;
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Les pointages n’ont pas été enregistrés.");
    } finally { setBusy(false); }
  }

  const canWrite = role === "super_admin" || permissions.includes("attendance.write");
  const selectedRecordCount = roster.reduce((count, member) => count + (statuses[member.id]
    ? (member.departments ?? []).filter((item) => !department || item.id === department).length * eventNames.length
    : 0), 0);
  return <AdminShell title="Présences & absences"><div className="admin-content">
    <div className="page-heading"><div><h1>Présences des ouvriers</h1><p>Choisissez un département, une date et un ou plusieurs événements, puis renseignez chaque personne.</p></div><button className="button secondary small" onClick={() => void load(department)} disabled={loading}><RefreshCw size={14} /> Actualiser</button></div>
    {offline && <div className="notice warn" style={{ marginBottom: 14 }}><WifiOff size={17} /> Mode hors ligne : les listes affichées proviennent de la dernière synchronisation de ce compte.</div>}
    {pending.length > 0 && <div className="notice warn" style={{ marginBottom: 14 }} role="status">{pending.length} pointage(s) attendent la synchronisation{syncing ? " en cours…" : navigator.onLine ? " — synchronisation en cours" : " — connexion requise"}.</div>}
    {notice && <div className="notice" style={{ marginBottom: 14 }} role="status">{notice}</div>}
    {error && <div className="notice error" style={{ marginBottom: 14 }} role="alert">{error}</div>}
    {canWrite && <section className="card panel attendance-editor">
      <div className="panel-heading"><div><h2>Feuille de présence</h2><div className="field-hint" style={{ marginTop: 3 }}>Les pointages hors connexion sont conservés sur cet appareil et synchronisés au retour du réseau.</div></div><Check size={18} color="#658775" /></div>
      <div className="form-grid attendance-controls">
        <div className="field"><label htmlFor="attendance-department">Département</label><select id="attendance-department" value={department} onChange={(event) => { setDepartment(event.target.value); setStatuses({}); setJustifications({}); }}><option value="">Tous les départements autorisés</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label htmlFor="attendance-date">Date *</label><input id="attendance-date" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} required /></div>
        <div className="field span-2"><label>Événements du jour * — sélection multiple</label><div className="dept-grid attendance-event-grid">{eventOptions.map((name) => <label className={`check-card ${selectedEvents.includes(name) ? "selected" : ""}`} key={name}><input type="checkbox" checked={selectedEvents.includes(name)} onChange={() => toggleEvent(name)} /><span>{name}</span></label>)}</div></div>
        <div className="field span-2"><label htmlFor="attendance-custom-event">Autre événement (facultatif)</label><input id="attendance-custom-event" value={customEvent} maxLength={120} onChange={(event) => setCustomEvent(event.target.value)} placeholder="Saisir le nom d’un autre événement" /></div>
      </div>
      <div className="attendance-roster-heading"><div><h3>{department ? `Ouvriers — ${data.departments.find((item) => item.id === department)?.name ?? "Département"}` : "Ouvriers de tous les départements autorisés"}</h3><p>{roster.length} ouvrier(s) actif(s){department ? " dans ce département" : " — les départements de chacun sont affichés"}</p></div>{roster.length > 0 && <button className="button ghost small" type="button" onClick={() => { const next: Record<string, AttendanceStatus | ""> = {}; roster.forEach((member) => { next[member.id] = "present"; }); setStatuses(next); }}>Tous présents</button>}</div>
      {loading && !roster.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : roster.length ? <div className="attendance-roster">{roster.map((member) => <article className="attendance-person" key={member.id}>
        <div className="attendance-person-identity"><strong>{member.nom} {member.postnom} {member.prenom}</strong><span>{member.member_number} · {member.departments?.map((item) => item.name).join(" · ") || "Département non disponible hors ligne — synchronisez à nouveau."}</span></div>
        <div className="field attendance-person-status"><label htmlFor={`attendance-${member.id}`}>Statut</label><select id={`attendance-${member.id}`} value={statuses[member.id] ?? ""} onChange={(event) => setStatuses((current) => ({ ...current, [member.id]: event.target.value as AttendanceStatus | "" }))}><option value="">Non renseigné</option><option value="present">Présent</option><option value="absent">Absent</option><option value="justified">Justifié</option></select></div>
        {statuses[member.id] === "justified" && <div className="field attendance-justification"><label htmlFor={`reason-${member.id}`}>Motif de justification *</label><textarea id={`reason-${member.id}`} value={justifications[member.id] ?? ""} maxLength={1000} rows={2} onChange={(event) => setJustifications((current) => ({ ...current, [member.id]: event.target.value }))} placeholder="Indiquez brièvement la raison" /></div>}
      </article>)}</div> : <div className="empty-state"><Activity size={24} /><strong>Aucun ouvrier actif dans ce périmètre</strong>Vérifiez les affectations ou les autorisations de département.</div>}
      {roster.length > 0 && <div className="attendance-save-row"><div className="field-hint">Événement(s) : {eventNames.length ? eventNames.join(" · ") : "aucun sélectionné"}</div><button className="button" type="button" onClick={() => void mark()} disabled={busy}>{busy ? "Enregistrement…" : offline ? "Garder les pointages hors ligne" : `Enregistrer les pointages (${selectedRecordCount})`}</button></div>}
    </section>}

    <section className="card panel" style={{ marginTop: 17 }}><div className="panel-heading"><div><h2>Historique récent</h2><div className="field-hint" style={{ marginTop: 3 }}>Les justifications sont visibles aux personnes autorisées pour ce département.</div></div><Activity size={18} color="#658775" /></div>
      <div className="filter-row"><select className="select-compact" value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filtrer par département"><option value="">Tous mes départements</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      {loading && !data.rows.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : data.rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Événement</th><th>Personne</th><th>Département</th><th>Statut</th><th>Motif</th><th>Pointé par</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{new Date(`${row.event_date}T12:00:00`).toLocaleDateString("fr-FR")}</td><td>{row.event_name || "Pointage quotidien"}</td><td><strong>{row.member_name}</strong></td><td>{row.department_name}</td><td><span className={`badge ${row.statut_presence === "present" ? "approved" : row.statut_presence === "justified" ? "pending" : "rejected"}`}>{statusLabels[row.statut_presence] ?? row.statut_presence}</span></td><td>{row.justification || "—"}</td><td>{row.recorded_by_name ?? "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><Activity size={25} /><strong>Aucun pointage</strong>Les présences enregistrées apparaîtront ici.</div>}
    </section>
  </div></AdminShell>;
}
