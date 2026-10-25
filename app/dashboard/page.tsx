"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, CalendarDays, Check, FilePlus2, Inbox, RefreshCw, Users, UsersRound, UserRoundCog } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type DashboardData = {
  stats: { members: number; workers: number; visitors: number; leaders: number; pending: number; reviewing: number; needsChanges: number; approved: number; rejected: number; upcomingActivities: number; presentLast30Days: number; absentLast30Days: number };
  departments: { id: string; name: string; status: string; active_workers: number }[];
  updatedAt: string;
};

function StatCard({ label, value, note, icon: Icon, tint = "" }: { label: string; value: number; note: string; icon: typeof Users; tint?: string }) {
  return <div className="card stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tint}`}><Icon size={18} strokeWidth={1.8} /></span></div><div className="stat-value">{value.toLocaleString("fr-FR")}</div><div className="stat-foot">{note}</div></div>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError("");
    try { setData(await apiFetch<DashboardData>("/api/admin/dashboard")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger le tableau de bord."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  return <AdminShell title="Vue d’ensemble">
    <div className="admin-content">
      <div className="page-heading">
        <div><div className="eyebrow" style={{ marginBottom: 7 }}>Centre Évangélique Silo</div><h1>Bonjour, bienvenue.</h1><p>Les indicateurs se mettent à jour à partir des données enregistrées.</p></div>
        <div className="page-actions"><button className="button secondary small" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? "spin-icon" : ""} /> Actualiser</button><Link className="button small" href="/admin/registration-links"><FilePlus2 size={15} /> Nouveau lien</Link></div>
      </div>
      {error && <div className="notice error" style={{ marginBottom: 18 }}>{error}<br />Vérifiez que la migration Supabase a été appliquée et que ce compte a l’autorisation dashboard.read.</div>}
      <div className="stat-grid">
        <StatCard label="Membres actifs" value={data?.stats.members ?? 0} note="Fiches individuelles" icon={Users} />
        <StatCard label="Ouvriers" value={data?.stats.workers ?? 0} note="Affectations dans les départements" icon={UsersRound} />
        <StatCard label="En attente" value={data?.stats.pending ?? 0} note="Formulaires à vérifier" icon={Inbox} />
        <StatCard label="Prochaines activités" value={data?.stats.upcomingActivities ?? 0} note="Événements à venir" icon={CalendarDays} />
      </div>
      <div className="dashboard-grid">
        <section className="card panel">
          <div className="panel-heading"><div><h2>Effectif par département</h2><div className="field-hint" style={{ marginTop: 4 }}>Nombre d’affectations actives</div></div><Link href="/admin/departments">Voir les départements <ArrowRight size={13} style={{ verticalAlign: "middle" }} /></Link></div>
          {loading && !data ? <div className="empty-state"><div className="spinner" style={{ margin: "0 auto" }} /></div> : data?.departments.length ? <div className="department-list">
            {[...data.departments].sort((a, b) => b.active_workers - a.active_workers).map((department) => {
              const maximum = Math.max(1, ...data.departments.map((item) => item.active_workers));
              return <div className="department-row" key={department.id}><span className="department-name">{department.name}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(department.active_workers ? 4 : 0, (department.active_workers / maximum) * 100)}%` }} /></div><span className="department-count">{department.active_workers}</span></div>;
            })}
          </div> : <div className="empty-state">Aucun département trouvé dans la base de données.</div>}
        </section>
        <section className="card panel">
          <div className="panel-heading"><h2>Traitement des inscriptions</h2><Link href="/admin/submissions">Ouvrir les dossiers <ArrowRight size={13} style={{ verticalAlign: "middle" }} /></Link></div>
          <div className="quick-actions" style={{ marginBottom: 15 }}>
            <Link className="quick-action" href="/admin/submissions?status=pending"><Inbox size={17} />{data?.stats.pending ?? (loading ? "…" : 0)} en attente</Link>
            <Link className="quick-action" href="/admin/submissions?status=reviewing"><Activity size={17} />{data?.stats.reviewing ?? (loading ? "…" : 0)} en vérification</Link>
            <Link className="quick-action" href="/admin/submissions?status=needs_changes"><FilePlus2 size={17} />{data?.stats.needsChanges ?? (loading ? "…" : 0)} à compléter</Link>
            <div className="quick-action" style={{ cursor: "default" }}><Check size={17} />{data?.stats.approved ?? (loading ? "…" : 0)} validés</div>
          </div>
          <div className="divider" />
          <div className="panel-heading" style={{ marginBottom: 12 }}><h2>Présences · 30 derniers jours</h2><Activity size={17} color="#658775" /></div>
          <div className="dashboard-stat-row"><div><strong>{data?.stats.presentLast30Days ?? (loading ? "…" : 0)}</strong><div className="field-hint">Présences</div></div><div><strong>{data?.stats.absentLast30Days ?? (loading ? "…" : 0)}</strong><div className="field-hint">Absences</div></div><div><strong>{data?.stats.visitors ?? (loading ? "…" : 0)}</strong><div className="field-hint">Visiteurs</div></div><div><strong>{data?.stats.leaders ?? (loading ? "…" : 0)}</strong><div className="field-hint">Responsables</div></div></div>
        </section>
      </div>
      <div className="card panel dashboard-note-card" style={{ marginTop: 17, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
        <div><div className="panel-heading" style={{ justifyContent: "flex-start", marginBottom: 5 }}><UserRoundCog size={18} color="#56816c" /><h2>Une personne, une fiche officielle</h2></div><div className="field-hint">Les affectations sont reliées à un identifiant unique, même si l’ouvrier sert dans plusieurs départements.</div></div>
        <Link className="button secondary small" href="/admin/members">Consulter les fiches <ArrowRight size={14} /></Link>
      </div>
      {data && <div className="field-hint" style={{ textAlign: "right", marginTop: 12 }}>Données actualisées à {new Date(data.updatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>}
    </div>
  </AdminShell>;
}
