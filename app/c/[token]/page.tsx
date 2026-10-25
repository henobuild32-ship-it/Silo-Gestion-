"use client";

import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Search, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";

type Department = { id: string; name: string };
type Match = { attendance_id: string; member_id: string; full_name: string; confirmed: boolean };
type LinkData = { meeting: { name: string; date: string }; departments: Department[]; matches: Match[] };

export default function AttendanceConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const [meeting, setMeeting] = useState<LinkData["meeting"] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [selected, setSelected] = useState<Match | null>(null);
  const [phoneSuffix, setPhoneSuffix] = useState("");
  const [attested, setAttested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/public/attendance-confirmations/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Ce lien n’est plus disponible.");
        if (active) { setMeeting(body.meeting); setDepartments(body.departments); }
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Impossible d’ouvrir le lien."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function searchWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSelected(null); setMatches([]);
    if (!departmentId || search.trim().length < 2) { setError("Choisissez votre département et saisissez au moins deux lettres de votre nom."); return; }
    setSearching(true);
    try {
      const params = new URLSearchParams({ department_id: departmentId, q: search.trim() });
      const response = await fetch(`/api/public/attendance-confirmations/${encodeURIComponent(token)}?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "La recherche n’a pas abouti.");
      setMatches(body.matches ?? []);
      if (!body.matches?.length) setError("Aucune présence correspondante. Vérifiez le département et l’orthographe du nom, ou demandez à l’administration de vérifier votre pointage.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "La recherche n’a pas abouti."); }
    finally { setSearching(false); }
  }

  async function confirmPresence() {
    if (!selected || !departmentId || !/^\d{4}$/.test(phoneSuffix)) { setError("Sélectionnez votre nom et saisissez les quatre derniers chiffres du téléphone enregistré."); return; }
    setError(""); setSubmitting(true);
    try {
      const response = await fetch(`/api/public/attendance-confirmations/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department_id: departmentId, attendance_id: selected.attendance_id, member_id: selected.member_id, phone_suffix: phoneSuffix }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "La confirmation n’a pas pu être enregistrée.");
      setAlreadyConfirmed(Boolean(body.already_confirmed)); setConfirmed(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "La confirmation n’a pas pu être enregistrée."); }
    finally { setSubmitting(false); }
  }

  const dateLabel = meeting ? new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${meeting.date}T12:00:00`)) : "";
  return <main className="confirmation-page">
    <header className="confirmation-brand"><img src="/silo-logo.png" alt="Logo du Centre Évangélique Silo" /><div><strong>SILO VERT OUVRIERS</strong><span>Centre Évangélique Silo · Campus de la Cité Verte</span></div></header>
    <section className="confirmation-card">
      {loading ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : error && !meeting ? <div className="notice error"><AlertCircle size={18} />{error}</div> : confirmed ? <div className="confirmation-success"><div className="confirmation-success-icon"><CheckCircle2 size={33} /></div><div className="eyebrow">Confirmation enregistrée</div><h1>{alreadyConfirmed ? "VOTRE PRÉSENCE EST DÉJÀ CONFIRMÉE" : "VOTRE PRÉSENCE EST CONFIRMÉE"}</h1><p>{selected?.full_name} · {meeting?.name} · {dateLabel}</p><div className="notice"><ShieldCheck size={17} />L’administration verra votre confirmation sur sa feuille de présence.</div></div> : meeting && <>
        <div className="eyebrow">Confirmation de présence</div><h1>{meeting.name}</h1><p className="confirmation-date">{dateLabel}</p>
        <div className="notice"><ShieldCheck size={17} /><span>Ce lien concerne uniquement les personnes déjà pointées présentes pour cette réunion. Choisissez votre département et votre nom. Les quatre derniers chiffres de votre téléphone servent à vérifier votre identité.</span></div>
        <form className="confirmation-form" onSubmit={(event) => void searchWorker(event)}>
          <div className="field"><label htmlFor="confirmation-department">Mon département *</label><select id="confirmation-department" required value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setMatches([]); setSelected(null); }}><option value="">Choisir un département</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></div>
          <div className="field"><label htmlFor="confirmation-name">Mon nom *</label><input id="confirmation-name" value={search} onChange={(event) => setSearch(event.target.value)} minLength={2} maxLength={80} placeholder="Nom, postnom ou numéro SILO" required /></div>
          <button className="button secondary" type="submit" disabled={searching}><Search size={16} />{searching ? "Recherche…" : "Rechercher mon nom"}</button>
        </form>
        {matches.length > 0 && <div className="confirmation-matches"><div className="field-label">Sélectionnez votre fiche</div>{matches.map((match) => <label className={`confirmation-match ${selected?.attendance_id === match.attendance_id ? "selected" : ""}`} key={match.attendance_id}><input type="radio" name="worker" checked={selected?.attendance_id === match.attendance_id} onChange={() => { setSelected(match); setAttested(false); setPhoneSuffix(""); }} /><span><strong>{match.full_name}</strong><small>{match.confirmed ? "Déjà confirmé" : ""}</small></span></label>)}</div>}
        {selected?.confirmed && <div className="notice" style={{ marginTop: 15 }}><CheckCircle2 size={17} />Votre présence pour cette réunion est déjà confirmée.</div>}
        {selected && !selected.confirmed && <div className="confirmation-verify"><label className="confirmation-attest"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} /><span>Je confirme que j’étais présent(e) à cette réunion.</span></label><div className="field"><label htmlFor="phone-suffix">Quatre derniers chiffres du téléphone enregistré *</label><input id="phone-suffix" inputMode="numeric" autoComplete="tel-national" pattern="[0-9]{4}" maxLength={4} value={phoneSuffix} onChange={(event) => setPhoneSuffix(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0000" required /></div><button className="button" type="button" onClick={() => void confirmPresence()} disabled={submitting || !attested}>{submitting ? "Confirmation…" : "Confirmer ma présence"}</button></div>}
        {error && <div className="notice error" style={{ marginTop: 14 }} role="alert"><AlertCircle size={17} />{error}</div>}
        <p className="confirmation-footnote">Si vous n’avez pas de téléphone ou d’accès internet, l’administration peut enregistrer votre présence manuellement.</p>
      </>}
    </section>
  </main>;
}
