"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleAlert, ClipboardCheck, Eye, FileText, RotateCcw, Search, X } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type Submission = {
  id: string; reference_number: string; data: Record<string, string>; photo_url: string | null; status: string;
  date_soumission: string; date_traitement: string | null; motif_rejet: string | null; correction_note: string | null;
  departments: string[]; requested_department_ids: string[];
};
const labels: Record<string, string> = { pending: "En attente", reviewing: "En cours de vérification", needs_changes: "À compléter", approved: "Validé", rejected: "Rejeté" };

export default function SubmissionsPage() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const params = status === "all" ? "" : `?status=${encodeURIComponent(status)}`;
      const result = await apiFetch<{ submissions: Submission[] }>(`/api/admin/submissions${params}`);
      setRows(result.submissions);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les formulaires."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [status]);

  async function act(item: Submission, action: string) {
    let reason: string | undefined;
    if (action === "needs_changes" || action === "rejected") {
      reason = window.prompt(action === "rejected" ? "Motif du rejet :" : "Quelles corrections faut-il demander ?")?.trim();
      if (!reason) return;
    }
    if (action === "approved" && !window.confirm(`Valider le dossier de ${item.data.nom} ${item.data.postnom} ${item.data.prenom} et créer la fiche officielle dans ${item.departments.join(", ")} ?`)) return;
    if (action === "reviewing" && !window.confirm(`Passer le dossier ${item.reference_number} en vérification ?`)) return;
    setBusyId(item.id); setError(""); setNotice("");
    try {
      const result = await apiFetch<{ result: { status: string; member_number?: string } }>(`/api/admin/submissions/${item.id}/review`, {
        method: "POST", body: JSON.stringify({ action, reason, departmentIds: action === "approved" ? item.requested_department_ids : [] }),
      });
      setNotice(result.result.member_number ? `Dossier validé. Identifiant attribué : ${result.result.member_number}.` : `Dossier mis à jour : ${labels[action] ?? action}.`);
      await load();
    } catch (reasonError) { setError(reasonError instanceof Error ? reasonError.message : "Le dossier n’a pas pu être mis à jour."); }
    finally { setBusyId(""); }
  }

  const visible = rows.filter((item) => `${item.reference_number} ${item.data.nom ?? ""} ${item.data.postnom ?? ""} ${item.data.prenom ?? ""} ${item.data.telephone ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  return <AdminShell title="Formulaires reçus"><div className="admin-content">
    <div className="page-heading"><div><h1>Formulaires reçus</h1><p>Vérifiez les demandes avant de créer les dossiers officiels des ouvriers.</p></div><span className="badge pending"><CircleAlert size={13} />{rows.filter((item) => item.status === "pending").length} affiché(s) dans la liste</span></div>
    {error && <div className="notice error" style={{ marginBottom: 14 }} role="alert">{error}</div>}
    {notice && <div className="notice" style={{ marginBottom: 14 }} role="status">{notice}</div>}
    <div className="card panel">
      <div className="filter-row"><div className="search-box"><Search size={16} /><input className="input" placeholder="Rechercher par nom, référence ou téléphone…" aria-label="Rechercher un formulaire" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select className="select-compact" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrer par statut">{[["pending","En attente"],["reviewing","En vérification"],["needs_changes","À compléter"],["approved","Validés"],["rejected","Rejetés"],["all","Tous les statuts"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
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
          {!(["approved", "rejected"].includes(item.status)) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", borderTop: "1px solid var(--line)", marginTop: 13, paddingTop: 12 }}>
            {item.status === "pending" && <button className="button secondary small" onClick={() => void act(item, "reviewing")} disabled={busyId === item.id}><ClipboardCheck size={14} />Commencer la vérification</button>}
            <button className="button ghost small" onClick={() => void act(item, "needs_changes")} disabled={busyId === item.id}><RotateCcw size={14} />Demander une correction</button>
            <button className="button danger small" onClick={() => void act(item, "rejected")} disabled={busyId === item.id}><X size={14} />Rejeter</button>
            <button className="button small" onClick={() => void act(item, "approved")} disabled={busyId === item.id}>{busyId === item.id ? "Traitement…" : <><Check size={14} />Valider le dossier</>}</button>
          </div>}
        </article>)}
      </div> : <div className="empty-state"><FileText size={25} /><strong>{search ? "Aucun formulaire correspondant" : "Aucun formulaire dans cette catégorie"}</strong>Les nouvelles soumissions apparaîtront ici.</div>}
    </div>
    <div className="notice" style={{ marginTop: 14 }}><ClipboardCheck size={16} />La validation crée une fiche unique et ses affectations dans une seule transaction PostgreSQL. Les doublons potentiels sont renvoyés pour examen manuel.</div>
  </div></AdminShell>;
}
