"use client";

import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, MailCheck, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { ChurchLogo } from "@/components/church-logo";

type Department = { id: string; name: string };
type Meeting = { name: string; date: string; radius_meters: number };
type CapturedLocation = { latitude: number; longitude: number; accuracy_meters: number };

export default function AttendanceConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [location, setLocation] = useState<CapturedLocation | null>(null);
  const [locationConsent, setLocationConsent] = useState(false);
  const [intent, setIntent] = useState<"confirm" | "decline">("confirm");
  const [phase, setPhase] = useState<"identify" | "code" | "done">("identify");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [attested, setAttested] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/public/attendance-confirmations/" + encodeURIComponent(token), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Ce lien n’est plus disponible.");
        if (active) {
          setMeeting(body.meeting);
          setDepartments(body.departments ?? []);
        }
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Impossible d’ouvrir le lien."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!resendIn) return;
    const timer = window.setTimeout(() => setResendIn((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  function captureLocation(): Promise<CapturedLocation> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("La géolocalisation n’est pas disponible sur cet appareil. Contactez l’administration pour un pointage manuel."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const captured = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy_meters: position.coords.accuracy,
          };
          if (!Number.isFinite(captured.accuracy_meters) || captured.accuracy_meters <= 0 || captured.accuracy_meters > 30) {
            reject(new Error("La position GPS n’est pas assez précise (30 m maximum). Activez la localisation précise et réessayez dehors, ou demandez un pointage manuel."));
            return;
          }
          resolve(captured);
        },
        (reason) => {
          const message = reason.code === reason.PERMISSION_DENIED
            ? "Autorisez la localisation précise dans les réglages du navigateur pour confirmer votre présence."
            : "Impossible d’obtenir une position GPS précise. Vérifiez le GPS et réessayez, ou demandez un pointage manuel.";
          reject(new Error(message));
        },
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
      );
    });
  }

  async function requestCode(event?: FormEvent<HTMLFormElement>, requestedIntent: "confirm" | "decline" = "confirm") {
    event?.preventDefault();
    setError("");
    setMessage("");
    if (!departmentId || fullName.trim().length < 3 || !email.trim()) {
      setError("Choisissez votre département et saisissez votre nom complet ainsi que l’adresse e-mail enregistrée.");
      return;
    }
    if (requestedIntent === "confirm" && !locationConsent) { setError("Autorisez la vérification ponctuelle de votre position, ou choisissez explicitement le refus qui sera marqué absent."); return; }
    setBusy(true);
    try {
      let captured: CapturedLocation | null = null;
      if (requestedIntent === "confirm") {
        setMessage("Recherche d’une position GPS précise…");
        captured = await captureLocation();
      }
      setLocation(captured);
      setIntent(requestedIntent);
      const response = await fetch("/api/public/attendance-confirmations/" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_code",
          intent: requestedIntent,
          department_id: departmentId,
          full_name: fullName.trim(),
          email: email.trim(),
          ...(captured ?? {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "La demande de code n’a pas abouti.");
      setChallengeId(body.challenge_id);
      setMessage(body.message);
      setCode("");
      setPhase("code");
      setResendIn(60);
    } catch (reason) {
      setMessage("");
      setError(reason instanceof Error ? reason.message : "La demande de code n’a pas abouti.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!challengeId || !/^\d{6}$/.test(code) || !attested) {
      setError("Saisissez le code à six chiffres et confirmez votre choix.");
      return;
    }
    setBusy(true);
    try {
      const currentLocation = intent === "confirm" ? await captureLocation() : null;
      if (currentLocation) setLocation(currentLocation);
      const response = await fetch("/api/public/attendance-confirmations/" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_code", intent, challenge_id: challengeId, code, ...(currentLocation ?? {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Le code est invalide ou expiré.");
      setAlreadyConfirmed(Boolean(body.already_confirmed));
      setDeclined(Boolean(body.declined));
      setPhase("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Le code est invalide ou expiré.");
    } finally {
      setBusy(false);
    }
  }

  const dateLabel = meeting
    ? new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(meeting.date + "T12:00:00"))
    : "";

  return <main className="confirmation-page">
    <header className="confirmation-brand"><ChurchLogo size={58} /><div><strong>SILO VERT OUVRIERS</strong><span>Centre Évangélique Silo · Campus de la Cité Verte</span></div></header>
    <section className="confirmation-card">
      {loading ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div>
        : error && !meeting ? <div className="notice error"><AlertCircle size={18} />{error}</div>
        : phase === "done" ? <div className="confirmation-success">
          <div className="confirmation-success-icon"><CheckCircle2 size={33} /></div>
          <div className="eyebrow">Confirmation enregistrée</div>
          <h1>{declined ? "VOTRE STATUT EST MARQUÉ ABSENT" : alreadyConfirmed ? "VOTRE PRÉSENCE EST DÉJÀ CONFIRMÉE" : "VOTRE PRÉSENCE EST CONFIRMÉE"}</h1>
          <p>{meeting?.name} · {dateLabel}</p>
          <div className="notice"><ShieldCheck size={17} />{declined ? "Après vérification de votre e-mail, votre statut a été marqué absent. L’administration verra cette modification." : "L’administration verra votre confirmation sur sa feuille de présence."}</div>
        </div>
        : meeting && <>
          <div className="eyebrow">Confirmation de présence par e-mail</div>
          <h1>{meeting.name}</h1>
          <p className="confirmation-date">{dateLabel}</p>
          <div className="notice"><ShieldCheck size={17} /><span>Le lien seul ne permet pas de confirmer. Il faut un code envoyé à l’adresse déjà enregistrée et une position GPS précise à moins de {meeting.radius_meters} m du lieu défini par l’administration. Aucune liste de noms n’est affichée.</span></div>

          {phase === "identify" && <form className="confirmation-form" onSubmit={(event) => void requestCode(event, "confirm")}>
            <div className="field">
              <label htmlFor="confirmation-department">Mon département *</label>
              <select id="confirmation-department" required value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
                <option value="">Choisir un département</option>
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="confirmation-name">Nom complet tel qu’enregistré *</label><input id="confirmation-name" autoComplete="name" maxLength={180} value={fullName} onChange={(event) => setFullName(event.target.value)} required /></div>
            <div className="field"><label htmlFor="confirmation-email">Adresse e-mail enregistrée *</label><input id="confirmation-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <label className="confirmation-attest confirmation-location-consent"><input type="checkbox" checked={locationConsent} onChange={(event) => setLocationConsent(event.target.checked)} /><span>J’autorise la vérification ponctuelle de ma position GPS précise pour cette réunion. Si ma confirmation réussit, ma position, sa précision et la distance au lieu seront enregistrées et visibles par les administrateurs généraux. Il n’y a aucun suivi en continu.</span></label>
            <button className="button" type="submit" disabled={busy}><MailCheck size={16} />{busy ? "Envoi de la demande…" : "Recevoir un code et confirmer avec ma position"}</button>
            <button className="button secondary confirmation-decline-button" type="button" disabled={busy} onClick={() => void requestCode(undefined, "decline")}>Je refuse la vérification de position — marquer absent</button>
          </form>}

          {phase === "code" && <>
            <div className="notice" style={{ marginTop: 16 }}><MailCheck size={17} /><span>{message}</span></div>
            <form className="confirmation-verify" onSubmit={(event) => void verifyCode(event)}>
              <div className="field"><label htmlFor="attendance-otp">Code reçu par e-mail *</label><input id="attendance-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required /><span className="field-hint">{intent === "confirm" ? "Position GPS requise à nouveau au moment de valider. Précision obtenue : " + (location ? Math.round(location.accuracy_meters) + " m." : "—") : "Ce code valide votre identité et enregistre un statut absent."}</span></div>
              <label className="confirmation-attest"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} /><span>{intent === "confirm" ? "Je confirme que j’étais présent(e) à cette réunion." : "Je comprends qu’après vérification de ce code, mon statut sera marqué absent."}</span></label>
              <button className="button" type="submit" disabled={busy || !attested}>{busy ? "Vérification…" : intent === "decline" ? "Vérifier le code et marquer absent" : "Vérifier le code et confirmer ma présence"}</button>
            </form>
            <div className="confirmation-secondary-actions">
              <button className="button secondary small" type="button" disabled={busy || resendIn > 0} onClick={() => void requestCode(undefined, intent)}>{resendIn > 0 ? "Renvoyer dans " + resendIn + " s" : "Demander un nouveau code"}</button>
              <button className="button ghost small" type="button" disabled={busy} onClick={() => { setPhase("identify"); setCode(""); setChallengeId(""); setMessage(""); setLocation(null); setIntent("confirm"); setAttested(false); setError(""); }}>Modifier mes informations</button>
            </div>
          </>}

          {error && <div className="notice error" style={{ marginTop: 14 }} role="alert"><AlertCircle size={17} />{error}</div>}
          <p className="confirmation-footnote">Pour confirmer une présence, activez la localisation précise dans les réglages du téléphone. Elle est vérifiée au moment de la demande du code et à nouveau lors de la validation. Si vous refusez la localisation, vous pouvez demander le code et choisir le statut absent. Si vous refusez aussi l’e-mail ou n’y avez pas accès, l’administration doit traiter le statut manuellement.</p>
        </>}
    </section>
  </main>;
}
