"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity, CalendarDays, ChartNoAxesCombined, ClipboardList, Coins, DoorOpen,
  FileCheck2, LayoutDashboard, Menu, Settings2, ShieldCheck, Users, UsersRound,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type UserInfo = { fullName: string; email: string; role: string; permissions: string[] };
const nav = [
  { label: "Vue d’ensemble", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.read", section: "ESPACE" },
  { label: "Formulaires reçus", href: "/admin/submissions", icon: FileCheck2, permission: "submissions.read" },
  { label: "Liens d’inscription", href: "/admin/registration-links", icon: ClipboardList, permission: "links.manage" },
  { label: "Membres & ouvriers", href: "/admin/members", icon: UsersRound, permission: "members.read_all", alternate: "members.read_assigned", section: "GESTION" },
  { label: "Départements", href: "/admin/departments", icon: Users, permission: "departments.read_all", alternate: "departments.read_assigned" },
  { label: "Présences", href: "/admin/attendance", icon: Activity, permission: "attendance.read_all", alternate: "attendance.read_assigned" },
  { label: "Programmes", href: "/admin/activities", icon: CalendarDays, permission: "activities.read_all", alternate: "activities.read_assigned" },
  { label: "Finances", href: "/admin/finances", icon: Coins, permission: "finance.read" },
  { label: "Rapports", href: "/admin/reports", icon: ChartNoAxesCombined, permission: "", anyOf: ["members.read_all", "members.read_assigned", "attendance.read_all", "attendance.read_assigned", "activities.read_all", "activities.read_assigned", "finance.read"] },
  { label: "Journal d’audit", href: "/admin/audit", icon: ShieldCheck, permission: "audit.read" },
  { label: "Administration", href: "/admin/settings", icon: Settings2, permission: "users.manage", section: "SYSTÈME" },
];
const roleLabel: Record<string, string> = { super_admin: "Administrateur principal", secretariat: "Secrétariat", department_lead: "Responsable de département" };

export function AdminShell({ children, title }: { children: React.ReactNode; title: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [configError, setConfigError] = useState("");

  useEffect(() => {
    let mounted = true;
    apiFetch<UserInfo>("/api/admin/me").then((data) => {
      if (mounted) setUser(data);
    }).catch((error: Error) => {
      if (!mounted) return;
      if (error.message.includes("Session")) router.replace("/connexion");
      else setConfigError(error.message);
    }).finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [router]);

  const visibleNav = useMemo(() => nav.filter((item) => user?.role === "super_admin" || user?.permissions.includes(item.permission) || ("alternate" in item && item.alternate !== undefined && user?.permissions.includes(item.alternate)) || ("anyOf" in item && item.anyOf?.some((permission) => user?.permissions.includes(permission)))), [user]);
  const initials = (user?.fullName ?? "S").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    router.replace("/connexion");
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;
  if (configError) return <div className="auth-card"><div className="logo-mark">S</div><h1>Accès à l’espace indisponible</h1><p>{configError}</p><a href="/connexion" className="button">Revenir à la connexion</a></div>;
  if (!user) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div className="admin-layout">
      <button className={`mobile-overlay ${menuOpen ? "open" : ""}`} aria-label="Fermer le menu" onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand"><div className="logo-mark">S</div><div><div className="brand-title">SILO GESTION</div><div className="brand-subtitle">Centre Évangélique Silo</div></div></div>
        {visibleNav.map((item, index) => {
          const Icon = item.icon;
          return <div key={item.href}>
            {item.section && <div className="nav-caption">{item.section}</div>}
            <Link href={item.href} onClick={() => setMenuOpen(false)} className={`side-link ${pathname === item.href ? "active" : ""}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>
            </Link>
          </div>;
        })}
        {visibleNav.length === 0 && <div className="notice" style={{ margin: 8 }}>Aucun module n’est associé à votre compte. Contactez l’administrateur.</div>}
        <div className="sidebar-bottom">
          <div className="user-card"><div className="avatar">{initials}</div><div style={{ minWidth: 0 }}><div className="user-name">{user.fullName}</div><div className="user-role">{roleLabel[user.role] ?? user.role}</div></div></div>
          <button className="signout" onClick={signOut}><DoorOpen size={16} /> Déconnexion</button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu"><Menu size={21} /></button>
            <div className="topbar-title">{title}</div>
          </div>
          <div className="topbar-right"><span className="topbar-date"><ShieldCheck size={15} color="#4e806e" /> Espace sécurisé</span><span>{new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</span></div>
        </header>
        {children}
      </main>
    </div>
  );
}
