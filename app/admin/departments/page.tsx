"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Users, UserRound, ClipboardCheck, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type Department = { id: string; name: string; description: string | null; status: string; active_workers: number; pending_submissions: number; leaders: string[] };

export default function DepartmentsPage() {
  const [items, setItems] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() { setLoading(true); try { const result = await apiFetch<{ departments: Department[] }>("/api/admin/departments"); setItems(result.departments); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les départements."); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);

  return <AdminShell title="Départements"><div className="admin-content">
    <div className="page-heading"><div><h1>Départements</h1><p>Les dossiers de département sont alimentés à partir des affectations officielles.</p></div><button className="button secondary small" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Actualiser</button></div>
    {error && <div className="notice error" style={{ marginBottom: 15 }}>{error}</div>}
    <div className="stat-grid">{loading && !items.length ? <div className="card stat-card"><div className="spinner" /></div> : items.map((department) => <article key={department.id} className="card stat-card" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}><div><div className="eyebrow" style={{ marginBottom: 7 }}>Département</div><h2 style={{ fontSize: 16, lineHeight: 1.35, minHeight: 42, margin: 0 }}>{department.name}</h2></div><span className="stat-icon"><Users size={17} /></span></div>
      <div className="divider" style={{ margin: "14px 0 12px" }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><strong style={{ font: "800 22px Manrope" }}>{department.active_workers}</strong><div className="field-hint">Ouvriers actifs</div></div><div><strong style={{ font: "800 22px Manrope" }}>{department.pending_submissions}</strong><div className="field-hint">Demandes en attente</div></div></div>
      <div className="field-hint" style={{ marginTop: 13, minHeight: 30 }}><UserRound size={13} style={{ verticalAlign: "-2px" }} /> Responsable : {department.leaders.length ? department.leaders.join(", ") : "Non attribué"}</div>
      <Link className="button secondary small" style={{ marginTop: "auto", width: "100%" }} href={`/admin/members?department=${department.id}`}>Voir les fiches <ArrowUpRight size={14} /></Link>
    </article>)}</div>
    {!loading && !items.length && !error && <div className="empty-state">Aucun département actif dans la base.</div>}
    <div className="notice" style={{ marginTop: 15 }}><ClipboardCheck size={16} />Les compteurs de demandes affichent uniquement un nombre par département. Les données personnelles restent dans l’espace de traitement autorisé.</div>
  </div></AdminShell>;
}
