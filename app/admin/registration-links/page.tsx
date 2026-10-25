"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, MessageCircle, Plus, Share2, ShieldCheck, Smartphone, X } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type LinkRow = { id: string; link_type: string; status: string; created_at: string; expires_at: string | null; usage_count: number; usage_limit: number | null; label: string | null };
type LinkList = { links: LinkRow[] };
type MemberChoice = { id: string; member_number: string; nom: string; postnom: string; prenom: string };

const message = (url: string) => `Bonjour, dans le cadre de la mise à jour des informations des ouvriers du Centre Évangélique Silo — Campus de la Cité Verte, veuillez remplir votre formulaire d’identification en cliquant sur le lien ci-dessous. Merci de fournir des informations exactes et de sélectionner tous les départements dans lesquels vous servez.\n\n${url}`;

export default function RegistrationLinksPage() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [type, setType] = useState("general");
  const [hours, setHours] = useState("168");
  const [limit, setLimit] = useState("100");
  const [label, setLabel] = useState("");
  const [members, setMembers] = useState<MemberChoice[]>([]);
  const [memberId, setMemberId] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    try { const data = await apiFetch<LinkList>("/api/admin/registration-links"); setLinks(data.links); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les liens."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (type !== "individual") return;
    apiFetch<{ members: MemberChoice[] }>("/api/admin/members?page=0").then((result) => setMembers(result.members)).catch((reason: Error) => setError(reason.message));
  }, [type]);

  async function generate() {
    setBusy(true); setError(""); setCreatedUrl("");
    try {
      const result = await apiFetch<{ link: LinkRow; url: string }>("/api/admin/registration-links", {
        method: "POST", body: JSON.stringify({ type, expiresInHours: hours ? Number(hours) : null, usageLimit: type === "general" && limit ? Number(limit) : type === "individual" ? 1 : null, memberId: type === "individual" ? memberId : undefined, label }),
      });
      setCreatedUrl(result.url); setLinks((current) => [result.link, ...current]); setLabel("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "La création du lien a échoué."); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }

  async function share() {
    if (!createdUrl) return;
    if (navigator.share) {
      try { await navigator.share({ title: "Formulaire d’identification des ouvriers", text: message(createdUrl), url: createdUrl }); }
      catch { /* fermeture du partage par l’utilisateur */ }
    } else await copy();
  }

  async function revoke(id: string) {
    if (!window.confirm("Désactiver ce lien ? Les personnes qui ne l’ont pas encore utilisé ne pourront plus soumettre le formulaire.")) return;
    try { await apiFetch(`/api/admin/registration-links/${id}/revoke`, { method: "POST" }); setLinks((items) => items.map((item) => item.id === id ? { ...item, status: "revoked" } : item)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de désactiver ce lien."); }
  }

  return <AdminShell title="Inscriptions des ouvriers"><div className="admin-content">
    <div className="page-heading"><div><h1>Inscriptions des ouvriers</h1><p>Créez un lien sécurisé et transmettez-le aux ouvriers pour recueillir leurs informations.</p></div><div className="page-actions"><span className="badge active"><ShieldCheck size={13} /> Jetons aléatoires · stockage haché</span></div></div>
    {error && <div className="notice error" style={{ marginBottom: 16 }} role="alert">{error}<button onClick={() => setError("")} style={{ marginLeft: "auto", border: 0, background: "transparent", color: "inherit" }} aria-label="Fermer"><X size={16} /></button></div>}
    <div className="dashboard-grid" style={{ gridTemplateColumns: "minmax(0,1.15fr) minmax(280px,.85fr)" }}>
      <section className="card panel">
        <div className="panel-heading"><div><h2>Générer un lien d’inscription</h2><div className="field-hint" style={{ marginTop: 4 }}>Le jeton en clair n’est affiché qu’à sa création.</div></div><span className="stat-icon"><Link2 size={18} /></span></div>
        <div className="form-grid">
          <div className="field span-2"><label>Type de lien</label><select value={type} onChange={(event) => setType(event.target.value)}><option value="general">Lien général — plusieurs ouvriers</option><option value="individual">Lien individuel — une seule soumission</option></select></div>
          {type === "individual" && <div className="field span-2"><label>Ouvrier concerné</label><select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Sélectionner une fiche</option>{members.map((member) => <option value={member.id} key={member.id}>{member.member_number} — {member.nom} {member.postnom} {member.prenom}</option>)}</select><span className="field-hint">La personne reçoit le lien manuellement ; le jeton permet une seule soumission.</span></div>}
          <div className="field"><label>Expiration</label><select value={hours} onChange={(event) => setHours(event.target.value)}><option value="24">24 heures</option><option value="168">7 jours</option><option value="720">30 jours</option><option value="2160">90 jours</option><option value="">Aucune expiration</option></select></div>
          {type === "general" && <div className="field"><label>Limite d’utilisation</label><select value={limit} onChange={(event) => setLimit(event.target.value)}><option value="25">25 formulaires</option><option value="100">100 formulaires</option><option value="500">500 formulaires</option><option value="">Sans limite</option></select></div>}
          <div className="field span-2"><label>Nom interne (facultatif)</label><input maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex. Campagne de rentrée" /></div>
        </div>
        <button className="button" style={{ marginTop: 18 }} onClick={() => void generate()} disabled={busy}><Plus size={16} />{busy ? "Création…" : "Générer le lien d’inscription"}</button>
        {createdUrl && <div className="notice" style={{ display: "block", marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, marginBottom: 9 }}><Check size={16} /> Lien prêt à partager</div>
          <div style={{ wordBreak: "break-all", padding: "10px 11px", background: "#fff", border: "1px solid #dce8df", borderRadius: 8, fontSize: 12, marginBottom: 10 }}>{createdUrl}</div>
          <p style={{ margin: "0 0 10px", fontSize: 12 }}>Le lien est affiché uniquement maintenant car le jeton est conservé sous forme hachée.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="button small" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copié" : "Copier le lien"}</button><a className="button small" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(message(createdUrl))}`}><MessageCircle size={14} /> Envoyer par WhatsApp</a><button className="button secondary small" onClick={() => void share()}><Share2 size={14} /> Partager</button></div>
          <div className="field-hint" style={{ marginTop: 9 }}>WhatsApp s’ouvre avec le message préparé. Vous devez encore appuyer sur « Envoyer » dans WhatsApp.</div>
        </div>}
      </section>
      <section className="card panel">
        <div className="panel-heading"><h2>Mode d’utilisation</h2><Smartphone size={17} color="#658775" /></div>
        <div style={{ display: "grid", gap: 16 }}>
          <div><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Lien général</div><div className="field-hint">Un même lien peut être utilisé par plusieurs ouvriers. Vous pouvez fixer un nombre maximal de soumissions et une date d’expiration.</div></div>
          <div><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Lien individuel</div><div className="field-hint">Une seule soumission peut être transmise avec le lien. Les tentatives excédentaires sont refusées par la base de données.</div></div>
          <div className="notice"><ShieldCheck size={16} />Les formulaires restent en attente tant qu’un utilisateur autorisé ne les a pas validés.</div>
        </div>
      </section>
    </div>
    <section className="card panel" style={{ marginTop: 18 }}>
      <div className="panel-heading"><div><h2>Liens créés</h2><div className="field-hint" style={{ marginTop: 4 }}>Le nombre d’utilisations est mis à jour par la base de données.</div></div><button className="button secondary small" onClick={() => void load()} disabled={loading}><ExternalLink size={14} /> Actualiser</button></div>
      {loading ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : links.length ? <div className="table-wrap"><table><thead><tr><th>Nom / type</th><th>Création</th><th>Expiration</th><th>Formulaires</th><th>Statut</th><th>Action</th></tr></thead><tbody>{links.map((link) => <tr key={link.id}><td><strong>{link.label || (link.link_type === "general" ? "Lien général" : "Lien individuel")}</strong><div className="field-hint">{link.link_type === "general" ? "Utilisable par plusieurs ouvriers" : "Utilisation unique"}</div></td><td>{new Date(link.created_at).toLocaleDateString("fr-FR")}</td><td>{link.expires_at ? new Date(link.expires_at).toLocaleDateString("fr-FR") : "Aucune"}</td><td>{link.usage_count}{link.usage_limit ? ` / ${link.usage_limit}` : ""}</td><td><span className={`badge ${link.status}`}>{link.status === "active" ? "Actif" : link.status === "revoked" ? "Désactivé" : "Expiré"}</span></td><td>{link.status === "active" ? <button className="button ghost small" onClick={() => void revoke(link.id)}><X size={14} /> Désactiver</button> : "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><Link2 size={25} /><strong>Aucun lien pour le moment</strong>Générez un lien pour commencer à recevoir des formulaires.</div>}
    </section>
  </div></AdminShell>;
}
