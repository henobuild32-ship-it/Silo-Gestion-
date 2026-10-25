"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, Copy, Link2, MapPin, MessageCircle, Printer, RefreshCw, WifiOff } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";
import { PendingAttendance, queueAttendance, readAttendanceQueue, readAttendanceSnapshot, removeQueuedAttendance, saveAttendanceSnapshot } from "@/lib/offline-store";

type Department = { id: string; name: string };
type Member = { id: string; member_number: string; nom: string; postnom: string; prenom: string; departments?: Department[] };
type AttendanceStatus = "present" | "absent" | "justified";
type Attendance = { id: string; event_date: string; event_name?: string; department_id: string; statut_presence: AttendanceStatus; justification?: string | null; self_confirmed_at?: string | null; self_declined_at?: string | null; confirmation_latitude?: number | null; confirmation_longitude?: number | null; confirmation_accuracy_meters?: number | null; confirmation_distance_meters?: number | null; confirmation_location_at?: string | null; member_name: string; department_name: string; recorded_by_name: string | null };
type Payload = { departments: Department[]; members: Member[]; rows: Attendance[] };
type OfflineAttendanceCache = { data: Payload; permissions: string[]; role?: string };
const eventOptions = ["Culte", "Prière des Ouvriers", "Culte du Mercredi soir"];
const statusLabels: Record<AttendanceStatus, string> = { present: "Présent", absent: "Absent", justified: "Justifié" };
const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim();
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
  const [rosterSearch, setRosterSearch] = useState("");
  const [showMeetingLink, setShowMeetingLink] = useState(false);
  const [meetingName, setMeetingName] = useState(customEvent || eventOptions[0]);
  const [meetingLink, setMeetingLink] = useState("");
  const [meetingBusy, setMeetingBusy] = useState(false);
  const [meetingError, setMeetingError] = useState("");
  const [meetingNotice, setMeetingNotice] = useState("");
  const [meetingCenter, setMeetingCenter] = useState<{ latitude: number; longitude: number; accuracy_meters: number } | null>(null);
  const [meetingRadius, setMeetingRadius] = useState(90);
  const [locatingAdmin, setLocatingAdmin] = useState(false);
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
      const cacheRows = result.rows.map((row) => ({
        id: row.id,
        event_date: row.event_date,
        event_name: row.event_name,
        department_id: row.department_id,
        statut_presence: row.statut_presence,
        justification: row.justification,
        self_confirmed_at: row.self_confirmed_at,
        self_declined_at: row.self_declined_at,
        member_name: row.member_name,
        department_name: row.department_name,
        recorded_by_name: row.recorded_by_name,
      }));
      await saveAttendanceSnapshot<OfflineAttendanceCache>(me.userId, { data: { ...result, rows: cacheRows }, permissions: me.permissions, role: me.role }).catch(() => undefined);
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
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible") void load(department);
    }, 30_000);
    return () => window.clearInterval(timer);
  // Keep public meeting confirmations in the administrator's attendance list fresh.
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
  const visibleRoster = useMemo(() => {
    const query = normalizeSearch(rosterSearch);
    return query ? roster.filter((member) => normalizeSearch(`${member.member_number} ${member.nom} ${member.postnom} ${member.prenom} ${member.departments?.map((item) => item.name).join(" ")}`).includes(query)) : roster;
  }, [roster, rosterSearch]);

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
    const markedMembers = visibleRoster.filter((member) => statuses[member.id]);
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

  async function createMeetingConfirmationLink() {
    setMeetingError(""); setMeetingNotice(""); setMeetingLink(""); setMeetingBusy(true);
    try {
      if (!meetingCenter) throw new Error("Enregistrez d’abord la position GPS précise du lieu de réunion.");
      const result = await apiFetch<{ url: string; attendee_count: number; expires_at: string }>("/api/admin/attendance/confirmations", {
        method: "POST",
        body: JSON.stringify({ event_name: meetingName.trim(), event_date: eventDate, department_id: department || null, center_latitude: meetingCenter.latitude, center_longitude: meetingCenter.longitude, center_accuracy_meters: meetingCenter.accuracy_meters, radius_meters: meetingRadius }),
      });
      setMeetingLink(result.url);
      setMeetingNotice(`Lien créé pour ${result.attendee_count} pointage(s) « Présent », dans un rayon de ${meetingRadius} m. Il expire le ${new Date(result.expires_at).toLocaleDateString("fr-FR")}.`);
    } catch (reason) {
      setMeetingError(reason instanceof Error ? reason.message : "Impossible de créer le lien de confirmation.");
    } finally { setMeetingBusy(false); }
  }

  async function captureMeetingCenter() {
    setMeetingError(""); setMeetingNotice(""); setMeetingLink("");
    if (!navigator.geolocation) { setMeetingError("La géolocalisation n’est pas disponible sur cet appareil."); return; }
    setLocatingAdmin(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }));
      const center = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_meters: position.coords.accuracy };
      if (!Number.isFinite(center.accuracy_meters) || center.accuracy_meters <= 0 || center.accuracy_meters > 30) throw new Error("La position du lieu n’est pas assez précise (30 m maximum). Activez la localisation précise et réessayez.");
      setMeetingCenter(center);
      setMeetingNotice("Position GPS actuelle enregistrée comme centre du périmètre pour ce lien.");
    } catch (reason) {
      const message = reason instanceof GeolocationPositionError && reason.code === reason.PERMISSION_DENIED
        ? "Autorisez la localisation précise pour définir le lieu de réunion."
        : reason instanceof Error ? reason.message : "Impossible d’obtenir la position GPS du lieu.";
      setMeetingError(message);
    } finally { setLocatingAdmin(false); }
  }

  async function copyMeetingLink() {
    try { await navigator.clipboard.writeText(meetingLink); setMeetingNotice("Lien copié. Vous pouvez le partager aux ouvriers présents."); }
    catch { setMeetingError("La copie automatique est indisponible. Sélectionnez le lien et copiez-le manuellement."); }
  }

  async function markRefusalAbsent(row: Attendance) {
    if (!window.confirm(`Marquer ${row.member_name} comme absent(e) pour « ${row.event_name || "Pointage quotidien"} » ? Cette action sera inscrite dans l’historique administratif.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch("/api/admin/attendance", { method: "PATCH", body: JSON.stringify({ attendance_id: row.id }) });
      setNotice(`${row.member_name} a été marqué(e) absent(e).`);
      await load(department);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de marquer ce pointage absent.");
    } finally { setBusy(false); }
  }

  const canWrite = role === "super_admin" || permissions.includes("attendance.write");
  const selectedRecordCount = visibleRoster.reduce((count, member) => count + (statuses[member.id]
    ? (member.departments ?? []).filter((item) => !department || item.id === department).length * eventNames.length
    : 0), 0);
  return <AdminShell title="Présences & absences"><div className="admin-content">
    <div className="page-heading"><div><h1>Présences des ouvriers</h1><p>Choisissez un département, une date et un ou plusieurs événements, puis renseignez chaque personne.</p></div><button className="button secondary small" onClick={() => void load(department)} disabled={loading}><RefreshCw size={14} /> Actualiser</button></div>
    {offline && <div className="notice warn" style={{ marginBottom: 14 }}><WifiOff size={17} /> Mode hors ligne : les listes affichées proviennent de la dernière synchronisation de ce compte.</div>}
    {pending.length > 0 && <div className="notice warn" style={{ marginBottom: 14 }} role="status">{pending.length} pointage(s) attendent la synchronisation{syncing ? " en cours…" : navigator.onLine ? " — synchronisation en cours" : " — connexion requise"}.</div>}
    {notice && <div className="notice" style={{ marginBottom: 14 }} role="status">{notice}</div>}
    {error && <div className="notice error" style={{ marginBottom: 14 }} role="alert">{error}</div>}
    {canWrite && <section className="card panel attendance-editor">
      <div className="panel-heading"><div><h2>Feuille de présence</h2><div className="field-hint" style={{ marginTop: 3 }}>Recherchez un nom et saisissez vous-même son statut, même si l’ouvrier n’a pas de téléphone. Les pointages hors connexion se synchronisent au retour du réseau.</div></div><Check size={18} color="#658775" /></div>
      <div className="form-grid attendance-controls">
        <div className="field"><label htmlFor="attendance-department">Département</label><select id="attendance-department" value={department} onChange={(event) => { setDepartment(event.target.value); setStatuses({}); setJustifications({}); setMeetingLink(""); setMeetingNotice(""); }}><option value="">Tous les départements autorisés</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label htmlFor="attendance-date">Date *</label><input id="attendance-date" type="date" value={eventDate} onChange={(event) => { setEventDate(event.target.value); setMeetingLink(""); setMeetingNotice(""); }} required /></div>
        <div className="field span-2"><label>Événements du jour * — sélection multiple</label><div className="dept-grid attendance-event-grid">{eventOptions.map((name) => <label className={`check-card ${selectedEvents.includes(name) ? "selected" : ""}`} key={name}><input type="checkbox" checked={selectedEvents.includes(name)} onChange={() => toggleEvent(name)} /><span>{name}</span></label>)}</div></div>
        <div className="field span-2"><label htmlFor="attendance-custom-event">Autre événement (facultatif)</label><input id="attendance-custom-event" value={customEvent} maxLength={120} onChange={(event) => setCustomEvent(event.target.value)} placeholder="Saisir le nom d’un autre événement" /></div>
      </div>
      <div className="attendance-roster-heading"><div><h3>{department ? `Ouvriers — ${data.departments.find((item) => item.id === department)?.name ?? "Département"}` : "Ouvriers de tous les départements autorisés"}</h3><p>{visibleRoster.length}{rosterSearch ? ` sur ${roster.length}` : ""} ouvrier(s) affiché(s){department ? " dans ce département" : " — les départements de chacun sont affichés"}</p></div>{visibleRoster.length > 0 && <button className="button ghost small" type="button" onClick={() => setStatuses((current) => { const next = { ...current }; visibleRoster.forEach((member) => { next[member.id] = "present"; }); return next; })}>Tous présents</button>}</div>
      {roster.length > 0 && <div className="field attendance-roster-search no-print"><label htmlFor="attendance-worker-search">Rechercher un ouvrier à pointer</label><input id="attendance-worker-search" type="search" value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} placeholder="Saisir un nom ou un numéro SILO" autoComplete="off" /></div>}
      {loading && !roster.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : visibleRoster.length ? <div className="attendance-roster">{visibleRoster.map((member) => <article className="attendance-person" key={member.id}>
        <div className="attendance-person-identity"><strong>{member.nom} {member.postnom} {member.prenom}</strong><span>{member.member_number} · {member.departments?.map((item) => item.name).join(" · ") || "Département non disponible hors ligne — synchronisez à nouveau."}</span></div>
        <div className="field attendance-person-status"><label htmlFor={`attendance-${member.id}`}>Statut</label><select id={`attendance-${member.id}`} value={statuses[member.id] ?? ""} onChange={(event) => setStatuses((current) => ({ ...current, [member.id]: event.target.value as AttendanceStatus | "" }))}><option value="">Non renseigné</option><option value="present">Présent</option><option value="absent">Absent</option><option value="justified">Justifié</option></select></div>
        {statuses[member.id] === "justified" && <div className="field attendance-justification"><label htmlFor={`reason-${member.id}`}>Motif de justification *</label><textarea id={`reason-${member.id}`} value={justifications[member.id] ?? ""} maxLength={1000} rows={2} onChange={(event) => setJustifications((current) => ({ ...current, [member.id]: event.target.value }))} placeholder="Indiquez brièvement la raison" /></div>}
      </article>)}</div> : <div className="empty-state"><Activity size={24} /><strong>{roster.length ? "Aucun nom ne correspond à votre recherche" : "Aucun ouvrier actif dans ce périmètre"}</strong>{roster.length ? "Modifiez votre recherche pour continuer." : "Vérifiez les affectations ou les autorisations de département."}</div>}
      {roster.length > 0 && <div className="attendance-save-row"><div className="field-hint">Événement(s) : {eventNames.length ? eventNames.join(" · ") : "aucun sélectionné"}</div><button className="button" type="button" onClick={() => void mark()} disabled={busy || !visibleRoster.some((item) => statuses[item.id])}>{busy ? "Enregistrement…" : offline ? "Garder les pointages hors ligne" : `Enregistrer les pointages (${selectedRecordCount})`}</button></div>}
    </section>}

    {canWrite && <section className="card panel meeting-link-panel" style={{ marginTop: 17 }}>
      <button className="meeting-link-trigger" type="button" aria-expanded={showMeetingLink} onClick={() => { setShowMeetingLink((visible) => !visible); setMeetingError(""); if (!showMeetingLink) setMeetingName(customEvent.trim() || selectedEvents[0] || eventOptions[0]); }}><span><Link2 size={18} /><strong>Réunion — lien de confirmation</strong></span><span>{showMeetingLink ? "Fermer" : "Créer un lien court"}</span></button>
      {showMeetingLink && <div className="meeting-link-content"><div className="notice"><Link2 size={17} /><span>Après le pointage, le lien n’est utilisable que par les ouvriers déjà marqués présents pour cette réunion. Ils vérifient leur identité avec le nom et l’adresse e-mail enregistrés, puis un code leur est envoyé. Ils doivent autoriser la position GPS précise dans le périmètre défini ici. Toute personne qui refuse cette vérification peut choisir le statut absent; si elle ne peut pas valider le code e-mail, l’administration doit enregistrer l’absence manuellement. Le lien dure 30 jours.</span></div>
        <div className="form-grid attendance-controls" style={{ marginTop: 16 }}><div className="field"><label htmlFor="meeting-name">Nom de la réunion *</label><input id="meeting-name" value={meetingName} maxLength={120} onChange={(event) => { setMeetingName(event.target.value); setMeetingLink(""); setMeetingNotice(""); }} placeholder="Ex. Réunion des ouvriers" required /></div><div className="field"><label>Date de la réunion</label><input type="date" value={eventDate} onChange={(event) => { setEventDate(event.target.value); setMeetingLink(""); setMeetingNotice(""); }} /></div><div className="field"><label>Département</label><select value={department} onChange={(event) => { setDepartment(event.target.value); setMeetingLink(""); setMeetingNotice(""); }}><option value="">Tous les départements autorisés</option>{data.departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div><div className="field"><label htmlFor="meeting-radius">Rayon autorisé (mètres)</label><input id="meeting-radius" type="number" min={30} max={500} step={10} value={meetingRadius} onChange={(event) => { setMeetingRadius(Number(event.target.value)); setMeetingLink(""); }} /><span className="field-hint">Réglage initial : 90 m. Limites : 30 à 500 m.</span></div><div className="field meeting-link-action"><span className="field-label">Lieu de la réunion *</span><button className="button secondary" type="button" onClick={() => void captureMeetingCenter()} disabled={locatingAdmin || offline}><MapPin size={15} />{locatingAdmin ? "Lecture GPS précise…" : meetingCenter ? "Actualiser la position du lieu" : "Utiliser la position actuelle"}</button>{meetingCenter && <span className="field-hint">Centre : {meetingCenter.latitude.toFixed(6)}, {meetingCenter.longitude.toFixed(6)} · précision {Math.round(meetingCenter.accuracy_meters)} m</span>}</div><div className="field meeting-link-action"><span className="field-label">Ouvriers concernés</span><button className="button" type="button" onClick={() => void createMeetingConfirmationLink()} disabled={meetingBusy || offline || !meetingName.trim() || !meetingCenter || meetingRadius < 30 || meetingRadius > 500}><Link2 size={15} />{meetingBusy ? "Création…" : offline ? "Connexion requise" : "Créer le lien"}</button></div></div>
        {meetingNotice && <div className="notice" style={{ marginTop: 13 }} role="status">{meetingNotice}</div>}{meetingError && <div className="notice error" style={{ marginTop: 13 }} role="alert">{meetingError}</div>}
        {meetingLink && <div className="meeting-link-result"><div className="field"><label htmlFor="meeting-link-url">Lien court de confirmation</label><input id="meeting-link-url" value={meetingLink} readOnly onFocus={(event) => event.currentTarget.select()} /></div><div className="meeting-link-buttons"><button className="button secondary small" type="button" onClick={() => void copyMeetingLink()}><Copy size={14} />Copier</button><a className="button small" href={`https://wa.me/?text=${encodeURIComponent(`Bonjour, merci de confirmer votre présence à ${meetingName} du ${new Date(`${eventDate}T12:00:00`).toLocaleDateString("fr-FR")}. Lien de confirmation : ${meetingLink}`)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} />Partager sur WhatsApp</a></div></div>}
      </div>}
    </section>}

    <div className="attendance-print-header"><div className="attendance-print-brand"><img src="/silo-logo.png" alt="Logo Silo" /><div><strong>SILO VERT OUVRIERS</strong><span>Centre Évangélique Silo · Campus de la Cité Verte</span></div></div><h1>Historique des présences</h1><p>{department ? data.departments.find((item) => item.id === department)?.name : "Tous les départements autorisés"} · Imprimé le {new Date().toLocaleDateString("fr-FR")}</p></div>
    <section className="card panel attendance-history" style={{ marginTop: 17 }}><div className="panel-heading"><div><h2>Historique récent</h2><div className="field-hint" style={{ marginTop: 3 }}>Les justifications et confirmations en ligne sont visibles selon vos autorisations.</div></div><div className="attendance-history-actions"><Activity size={18} color="#658775" /><button className="button secondary small no-print" type="button" onClick={() => window.print()}><Printer size={14} />Imprimer / PDF</button></div></div>
      <div className="filter-row no-print"><select className="select-compact" value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filtrer par département"><option value="">Tous mes départements</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      {loading && !data.rows.length ? <div className="empty-state no-print"><div className="spinner" style={{ margin: "auto" }} /></div> : data.rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Événement</th><th>Personne</th><th>Département</th><th>Statut</th><th>Motif</th><th>Confirmation en ligne</th>{role === "super_admin" && <th className="no-print">Position GPS exacte</th>}<th>Pointé par</th>{canWrite && <th className="no-print">Action</th>}</tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{new Date(`${row.event_date}T12:00:00`).toLocaleDateString("fr-FR")}</td><td>{row.event_name || "Pointage quotidien"}</td><td><strong>{row.member_name}</strong></td><td>{row.department_name}</td><td><span className={`badge ${row.statut_presence === "present" ? "approved" : row.statut_presence === "justified" ? "pending" : "rejected"}`}>{statusLabels[row.statut_presence] ?? row.statut_presence}</span></td><td>{row.justification || "—"}</td><td>{row.self_confirmed_at ? `Confirmé le ${new Date(row.self_confirmed_at).toLocaleString("fr-FR")}` : row.self_declined_at ? `Refusé · marqué absent le ${new Date(row.self_declined_at).toLocaleString("fr-FR")}` : "En attente / pointage manuel"}</td>{role === "super_admin" && <td className="no-print">{row.confirmation_latitude != null && row.confirmation_longitude != null ? <><a href={`https://maps.google.com/?q=${row.confirmation_latitude},${row.confirmation_longitude}`} target="_blank" rel="noreferrer">{row.confirmation_latitude.toFixed(6)}, {row.confirmation_longitude.toFixed(6)}</a><div className="field-hint">Précision ±{Math.round(row.confirmation_accuracy_meters ?? 0)} m · {Math.round(row.confirmation_distance_meters ?? 0)} m du centre</div></> : row.self_declined_at ? "Refus GPS" : "Non relevée"}</td>}<td>{row.recorded_by_name ?? "—"}</td>{canWrite && <td className="no-print">{row.statut_presence === "present" && !row.self_confirmed_at && !row.self_declined_at ? <button className="button secondary small" type="button" disabled={busy} onClick={() => void markRefusalAbsent(row)}>Marquer absent</button> : "—"}</td>}</tr>)}</tbody></table></div> : <div className="empty-state"><Activity size={25} /><strong>Aucun pointage</strong>Les présences enregistrées apparaîtront ici.</div>}
    </section>
  </div></AdminShell>;
}
