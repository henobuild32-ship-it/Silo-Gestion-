"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, FileText, UserRound } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type MemberFile = {
  id: string; member_number: string; nom: string; postnom: string; prenom: string; sexe: string;
  date_naissance: string | null; etat_civil: string | null; telephone: string; telephone_secondaire: string | null;
  adresse: string; commune: string; quartier: string | null; email: string | null; photo_url: string | null;
  categories: { category: string }[]; frequentation_depuis: string | null; date_debut_service: string | null;
  fonction: string | null; responsable_actuel: string | null; observations: string | null; status: string;
  validated_at: string | null; validated_by_name: string | null; created_at: string; updated_at: string;
};
type Department = { id: string; name: string; fonction: string | null; date_affectation: string; validated_at: string | null };
type HistoryEntry = { action: string; fonction: string | null; changed_at: string; department_name: string };
type MemberResponse = { member: MemberFile; departments: Department[]; history: HistoryEntry[] };
const categoryNames: Record<string, string> = { worker: "Ouvrier", member: "Membre", visitor: "Visiteur" };
const actionNames: Record<string, string> = { assigned: "Affectation ajoutée", updated: "Affectation modifiée", removed: "Affectation retirée" };
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString("fr-FR", { dateStyle: "long" }) : "Non renseigné";

export default function MemberFilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<MemberResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch<MemberResponse>(`/api/admin/members/${encodeURIComponent(id)}`)
      .then((result) => { if (active) setData(result); })
      .catch((reason: Error) => { if (active) setError(reason.message || "Impossible de charger cette fiche."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!data) return;
    const previousTitle = document.title;
    document.title = `Fiche ${data.member.member_number} — Silo Vert Ouvriers`;
    return () => { document.title = previousTitle; };
  }, [data]);

  async function downloadPdf() {
    setBusy(true); setError("");
    try {
      await apiFetch(`/api/admin/members/${encodeURIComponent(id)}`, { method: "POST" });
      window.print();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "La fiche PDF n’a pas pu être préparée.");
    } finally { setBusy(false); }
  }

  const member = data?.member;
  return <AdminShell title="Fiche individuelle"><div className="admin-content">
    <div className="page-heading no-print"><div><h1>Fiche individuelle</h1><p>Fiche officielle consultable après validation, avec son historique d’affectation.</p></div><div className="page-actions"><Link className="button secondary small" href="/admin/members"><ArrowLeft size={15} /> Retour aux fiches</Link>{member && <button className="button small" onClick={() => void downloadPdf()} disabled={busy}><Download size={15} />{busy ? "Préparation…" : "Télécharger en PDF"}</button>}</div></div>
    {error && <div className="notice error no-print" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
    {loading ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : member ? <article className="card member-file">
      <header className="member-file-header"><div className="member-file-logo"><img src="/silo-logo.png" alt="" /><div><strong>SILO VERT OUVRIERS</strong><span>Centre Évangélique Silo · Campus de la Cité Verte</span></div></div><div className="member-file-kind">FICHE OFFICIELLE<br />{categoryNames[member.categories?.[0]?.category] ?? "Personne"}</div></header>
      <div className="member-file-title"><div><div className="eyebrow">Dossier individuel</div><h2>{member.nom} {member.postnom} {member.prenom}</h2><div className="member-file-number">Identifiant : <strong>{member.member_number}</strong></div></div>{member.photo_url ? <img className="member-file-photo" src={member.photo_url} alt={`Photo de ${member.prenom} ${member.nom}`} /> : <div className="member-file-photo member-file-photo-empty"><UserRound size={30} /><span>Sans photo</span></div>}</div>
      <section className="member-file-section"><h3>Identité et coordonnées</h3><div className="member-file-grid"><FileRow label="Sexe" value={member.sexe} /><FileRow label="Date de naissance" value={formatDate(member.date_naissance)} /><FileRow label="État civil" value={member.etat_civil} /><FileRow label="Téléphone principal" value={member.telephone} /><FileRow label="Téléphone secondaire" value={member.telephone_secondaire} /><FileRow label="Adresse électronique" value={member.email} /><FileRow label="Adresse" value={member.adresse} /><FileRow label="Commune" value={member.commune} /><FileRow label="Quartier" value={member.quartier} /></div></section>
      <section className="member-file-section"><h3>Service et affectations</h3><div className="member-file-grid"><FileRow label="Fréquente l’Église depuis" value={member.frequentation_depuis} /><FileRow label="Début du service" value={formatDate(member.date_debut_service)} /><FileRow label="Fonction actuelle" value={member.fonction} /><FileRow label="Responsable actuel" value={member.responsable_actuel} /><FileRow label="Catégorie(s)" value={(member.categories ?? []).map((item) => categoryNames[item.category] ?? item.category).join(" · ")} /><FileRow label="Statut du dossier" value={member.status === "active" ? "Actif" : member.status} /></div>
        <div className="member-file-departments">{data.departments.length ? data.departments.map((department) => <div className="member-file-department" key={department.id}><strong>{department.name}</strong><span>{department.fonction || member.fonction || "Fonction non précisée"}</span><small>Affecté le {formatDate(department.date_affectation)}</small></div>) : <p>Aucune affectation active.</p>}</div>
      </section>
      {member.observations && <section className="member-file-section"><h3>Observations</h3><p className="member-file-observations">{member.observations}</p></section>}
      <section className="member-file-section"><h3>Validation et historique</h3><div className="member-file-grid"><FileRow label="Fiche validée le" value={formatDate(member.validated_at)} /><FileRow label="Validée par" value={member.validated_by_name} /><FileRow label="Fiche créée le" value={formatDate(member.created_at)} /><FileRow label="Dernière mise à jour" value={formatDate(member.updated_at)} /></div>{data.history.length > 0 && <div className="member-file-history">{data.history.map((entry, index) => <div key={`${entry.changed_at}-${index}`}><span className="member-file-history-dot" /><div><strong>{actionNames[entry.action] ?? entry.action} · {entry.department_name}</strong><small>{formatDate(entry.changed_at)}{entry.fonction ? ` · ${entry.fonction}` : ""}</small></div></div>)}</div>}</section>
      <footer className="member-file-footer"><span>Document confidentiel — réservé à la gestion administrative de l’Église.</span><span>Généré le {new Date().toLocaleDateString("fr-FR", { dateStyle: "long" })}</span></footer>
      <div className="member-file-print-hint no-print"><FileText size={15} />Dans la fenêtre qui s’ouvre, choisissez « Enregistrer au format PDF » pour télécharger la fiche.</div>
    </article> : <div className="empty-state"><UserRound size={25} /><strong>Fiche indisponible</strong>{error || "Cette fiche est introuvable ou hors de votre périmètre."}</div>}
  </div></AdminShell>;
}

function FileRow({ label, value }: { label: string; value?: string | null }) {
  return <div className="member-file-row"><span>{label}</span><strong>{value || "Non renseigné"}</strong></div>;
}
