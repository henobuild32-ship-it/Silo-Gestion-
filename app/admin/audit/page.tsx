"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type Entry = { id: string; actor_name: string; action: string; object_type: string; object_id: string | null; result: string; context: Record<string, unknown>; created_at: string };
const labels: Record<string, string> = {
  "bootstrap.super_admin.created": "Création de l’administrateur principal",
  "user.access.updated": "Création ou modification des accès utilisateur",
  "registration_link.created": "Création d’un lien d’inscription",
  "registration_link.revoked": "Révocation d’un lien d’inscription",
  "report.exported": "Export d’un rapport",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { const result = await apiFetch<{ entries: Entry[] }>("/api/admin/audit"); setEntries(result.entries); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger le journal d’audit."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  return <AdminShell title="Journal d’audit"><div className="admin-content">
    <div className="page-heading"><div><h1>Journal d’audit</h1><p>Historique des actions administratives sensibles et des exports récents.</p></div><button className="button secondary small" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Actualiser</button></div>
    {error && <div className="notice error" style={{ marginBottom: 14 }} role="alert">{error}</div>}
    <section className="card panel"><div className="panel-heading"><div><h2>Actions récentes</h2><div className="field-hint" style={{ marginTop: 4 }}>100 opérations au maximum sont affichées. Les détails sensibles ne sont pas exposés dans ce journal.</div></div><ShieldCheck size={19} color="#658775" /></div>
      {loading && !entries.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : entries.length ? <div className="table-wrap"><table><thead><tr><th>Date et heure</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Résultat</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{new Date(entry.created_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</td><td><strong>{entry.actor_name}</strong></td><td>{labels[entry.action] ?? entry.action}</td><td>{entry.object_type}{entry.object_id ? <div className="field-hint">{entry.object_id}</div> : null}{Object.keys(entry.context ?? {}).length ? <details style={{ marginTop: 5 }}><summary style={{ cursor: "pointer", color: "var(--green)", fontSize: 11 }}>Détails</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{JSON.stringify(entry.context, null, 2)}</pre></details> : null}</td><td><span className={`badge ${entry.result === "success" ? "approved" : "rejected"}`}>{entry.result === "success" ? "Réussi" : "Échec"}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><ShieldCheck size={25} /><strong>Aucune action enregistrée</strong>Les événements sensibles s’afficheront ici.</div>}
    </section>
  </div></AdminShell>;
}
