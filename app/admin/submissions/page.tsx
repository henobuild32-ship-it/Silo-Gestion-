"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleAlert, ClipboardCheck, Copy, Eye, ExternalLink, FileText, MessageCircle, RotateCcw, Search, X } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type Submission = {
  id: string; reference_number: string; data: Record<string, string>; photo_url: string | null; status: string;
  date_soumission: string; date_traitement: string | null; motif_rejet: string | null; correction_note: string | null;
  departments: string[]; requested_department_ids: string[]; member_id: string | null;
};
type CorrectionLink = { url: string; name: string; phone: string; reference: string };
const labels: Record<string, string> = { pending: "En attente", reviewing: "En cours de vérification", needs_changes: "À compléter", approved: "Validé", rejected: "Rejeté" };

export default function SubmissionsPage() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [canValidate, setCanValidate] = useState(false);
  const [status, setStatus] = useState("to_review");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [correctionLink, setCorrectionLink] = useState<CorrectionLink | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const params = status === "all" ? "" : `?status=${encodeURIComponent(status)}`;
      const result = await apiFetch<{ submissions: Submission[]; canValidate: boolean }>(`/api/admin/submissions${params}`);
      setRows(result.submissions);
      setCanValidate(result.canValidate);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les formulaires."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function act(item: Submission, action: string) {
    let reason: string | undefined;
    if (action === "needs_changes" || action === "rejected") {
      reason = window.prompt(action === "rejected" ? "Motif du rejet :" : "Quelles corrections faut-il demander ?")?.trim();
      if (!reason) return;
    }
    if (action === "approved" && !window.confirm(`Valider le dossier de ${item.data.nom} ${item.data.postnom} ${item.data.prenom} et créer la fiche officielle dans ${item.departments.join(", ")} ?`)) return;
    if (action === "reviewing" && !window.confirm(`Passer le dossier ${item.reference_number} en vérification ?`)) return;
    setBusyId(item.id); setError(""); setNotice(""); setCorrectionLink(null); setCopied(false);
    try {
      const result = await apiFetch<{ result: { status: string; member_number?: string }; editLink?: string }>(`/api/admin/submissions/${item.id}/review`, {
        method: "POST", body: JSON.stringify({ action, reason, departmentIds: action === "approved" ? item.requested_department_ids : [] }),
      });
      setNotice(result.result.member_number ? `Dossier validé. Identifiant attribué : ${result.result.member_number}.` : `Dossier mis à jour : ${labels[action] ?? action}.`);
      if (action === "needs_changes" && result.editLink) {
        setCorrectionLink({
          url: result.editLink,
          name: `${item.data.nom} ${item.data.postnom} ${item.data.prenom}`.replace(/\s+/g, " ").trim(),
          phone: item.data.telephone ?? "",
          reference: item.reference_number,
        });
        setNotice("Demande de correction enregistrée. Le nouveau lien est prêt à être transmis à la bonne personne.");
      }
      await load();
    } catch (reasonError) { setError(reasonError instanceof Error ? reasonError.message : "Le dossier n’a pas pu être mis à jour."); }
    finally { setBusyId(""); }
  }

  async function copyCorrectionLink() {
    if (!correctionLink) return;
    try { await navigator.clipboard.writeText(correctionLink.url); setCopied(true); }
    catch { setError("La copie automatique n’a pas fonctionné. Sélectionnez le lien et copiez-le manuellement."); }
  }

  const visible = rows.filter((item) => `${item.reference_number} ${item.data.nom ?? ""} ${item.data.postnom ?? ""} ${item.data.prenom ?? ""} ${item.data.telephone ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  const correctionMessage = correctionLink ? `Bonjour ${correctionLink.name}, l’administration du Centre Évangélique Silo vous demande de compléter votre fiche (${correctionLink.reference}). Ouvrez ce lien personnel pour corriger uniquement votre formulaire : ${correctionLink.url}` : "";
  return <AdminShell title="Vérification"><div className="admin-content">
    <div className="page-heading"><div><h1>Vérification des inscriptions</h1><p>Chaque dossier doit être examiné par l’administration. Après votre contrôle, validez-le pour l’intégrer aux départements choisis.</p></div><span className="badge pending"><CircleAlert size={13} />{rows.filter((item) => ["pending", "reviewing"].includes(item.status)).length} à vérifier</span></div>
    {canValidate ? <div className="notice" style={{ marginBottom: 14 }}><ClipboardCheck size={16} /><span><strong>Action de l’administrateur requise :</strong> la soumission d’un formulaire ne valide rien automatiquement. Consultez la fiche, vérifiez les informations et les départements, puis validez vous-même le dossier pour créer la fiche officielle et ses affectations.</span></div> : <div className="notice warn" style={{ marginBottom: 14 }}><ClipboardCheck size={16} /><span>Vous pouvez consulter les dossiers de votre périmètre. La vérification finale et la validation doivent être effectuées par l’administrateur principal ou par un utilisateur autorisé à valider les inscriptions.</span></div>}
    {error && <div className="notice error" style={{ marginBottom: 14 }} role="alert">{error}</div>}
    {notice && <div className="notice" style={{ marginBottom: 14 }} role="status">{notice}</div>}
    {correctionLink && <section className="card panel" aria-label="Lien de correction à transmettre" style={{ marginBottom: 14, borderColor: "#e5c783" }}>
      <div className="section-title"><div className="section-title-icon"><MessageCircle size={17} /></div><div><h2>Lien personnel à transmettre à {correctionLink.name}</h2><p>Ce lien n’ouvre que son formulaire, expire dans 7 jours et ne peut être envoyé qu’une seule fois. Transmettez-le uniquement à cette personne.</p></div></div>
      <p className="field-hint" style={{ margin: "8px 0 0" }}>Destinataire à vérifier : {correctionLink.phone || "aucun numéro fourni"} · Référence {correctionLink.reference}</p>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="correction-link">Lien de correction — {correctionLink.reference}</label><input id="correction-link" className="input" readOnly value={correctionLink.url} onFocus={(event) => event.currentTarget.select()} /></div>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 11 }}>
        <button className="button secondary small" onClick={() => void copyCorrectionLink()}><Copy size={14} />{copied ? "Lien copié" : "Copier le lien"}</button>
        <a className="button small" href={`https://wa.me/?text=${encodeURIComponent(correctionMessage)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} />Préparer le message WhatsApp <ExternalLink size={13} /></a>
      </div>
      <p className="field-hint" style={{ margin: "10px 0 0" }}>WhatsApp s’ouvrira avec un message prérempli. L’administrateur doit encore appuyer sur « Envoyer » dans WhatsApp.</p>
    </section>}
    <div className="card panel">
      <div className="filter-row"><div className="search-box"><Search size={16} /><input className="input" placeholder="Rechercher par nom, référence ou téléphone…" aria-label="Rechercher un formulaire" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select className="select-compact" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrer par statut">{[["to_review","À vérifier"],["pending","En attente"],["reviewing","En vérification"],["needs_changes","À compléter"],["approved","Validés"],["rejected","Rejetés"],["all","Tous les statuts"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {loading && !rows.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : visible.length ? <div style={{ display: "grid", gap: 11 }}>
        {visible.map((item) => <article className="card" key={item.id} style={{ padding: 17, boxShadow: "none" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              {item.photo_url ? <img src={item.photo_url} alt="Photo de profil" style={{ width: 52, height: 61, borderRadius: 9, objectFit: "cover", background: "#edf1ed" }} /> : <div className="photo-preview" style={{ width: 52, height: 61, display: "grid", placeItems: "center" }}><Eye size={19} /></div>}
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 15 }}>{item.data.nom} {item.data.postnom} {item.data.prenom}</div><div className="field-hint" style={{ marginTop: 3 }}>{item.data.telephone} · {item.reference_number}</div><div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>{item.departments.map((name) => <span key={name} className="badge active">{name}</span>)}</div></div>
            </div>
            <div style={{ display: "grid", justifyItems: "end", gap: 7, flex: "none" }}><span className={`badge ${item.status}`}>{labels[item.status] ?? item.status}</span><span className="field-hint">{new Date(item.date_soumission).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span></div>
          </div>
          <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", color: "var(--green)", fontSize: 12, fontWeight: 700 }}><ChevronDown size={13} style={{ verticalAlign: "-2px" }} /> Consulter la fiche</summary>
            <div className="summary-list" style={{ marginTop: 9 }}>{[["Sexe", item.data.sexe], ["Date de naissance", item.data.date_naissance], ["Adresse", [item.data.adresse, item.data.commune, item.data.quartier].filter(Boolean).join(" · ")], ["Courriel", item.data.email], ["État civil", item.data.etat_civil], ["Fonction", item.data.fonction], ["Responsable", item.data.responsable_actuel], ["Fréquente depuis", item.data.frequentation_depuis], ["Observations", item.data.observations]].filter(([, value]) => value).map(([label, value]) => <div className="summary-row" key={label}><strong>{label}</strong><span>{value}</span></div>)}</div>
            {item.correction_note && <div className="notice warn" style={{ marginTop: 10 }}>Correction demandée : {item.correction_note}</div>}{item.motif_rejet && <div className="notice error" style={{ marginTop: 10 }}>Motif de rejet : {item.motif_rejet}</div>}
          </details>
          {item.status === "approved" && item.member_id && <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><a className="button secondary small" href={`/admin/members/${item.member_id}`}><FileText size={14} />Ouvrir la fiche officielle</a></div>}
          {canValidate && !(["approved", "rejected"].includes(item.status)) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", borderTop: "1px solid var(--line)", marginTop: 13, paddingTop: 12 }}>
            {item.status === "pending" && <button className="button secondary small" onClick={() => void act(item, "reviewing")} disabled={busyId === item.id}><ClipboardCheck size={14} />Commencer la vérification</button>}
            <button className="button ghost small" onClick={() => void act(item, "needs_changes")} disabled={busyId === item.id}><RotateCcw size={14} />Demander une correction</button>
            <button className="button danger small" onClick={() => void act(item, "rejected")} disabled={busyId === item.id}><X size={14} />Rejeter</button>
            <button className="button small" onClick={() => void act(item, "approved")} disabled={busyId === item.id}>{busyId === item.id ? "Traitement…" : <><Check size={14} />Valider le dossier</>}</button>
          </div>}
        </article>)}
      </div> : <div className="empty-state"><FileText size={25} /><strong>{search ? "Aucun formulaire correspondant" : "Aucun formulaire dans cette catégorie"}</strong>Les nouvelles soumissions apparaîtront ici.</div>}
    </div>
    <div className="notice" style={{ marginTop: 14 }}><ClipboardCheck size={16} />La validation crée une fiche unique dans tous les départements confirmés. Les doublons potentiels doivent être examinés manuellement avant toute validation.</div>
  </div></AdminShell>;
}
