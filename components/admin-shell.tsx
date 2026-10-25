"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity, Bell, BellOff, CalendarDays, ChartNoAxesCombined, ClipboardList, Coins, DoorOpen,
  FileCheck2, LayoutDashboard, Menu, Settings2, ShieldCheck, Users, UsersRound,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { clearOfflineUserData } from "@/lib/offline-store";

type UserInfo = { userId: string; fullName: string; email: string; role: string; permissions: string[] };
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
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState("");

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

  useEffect(() => {
    if (!user || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    let active = true;
    void navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then((subscription) => {
      if (active) setPushEnabled(Boolean(subscription));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [user]);

  const visibleNav = useMemo(() => nav.filter((item) => user?.role === "super_admin" || user?.permissions.includes(item.permission) || ("alternate" in item && item.alternate !== undefined && user?.permissions.includes(item.alternate)) || ("anyOf" in item && item.anyOf?.some((permission) => user?.permissions.includes(permission)))), [user]);
  const initials = (user?.fullName ?? "S").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  async function signOut() {
    const currentUser = user;
    if (!currentUser) return;
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        try { await apiFetch("/api/admin/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }); } catch { /* logout must still work offline */ }
        await subscription.unsubscribe();
      }
    } catch { /* best effort cleanup on shared devices */ }
    try { await clearOfflineUserData(currentUser.userId); } catch { /* IndexedDB may be unavailable. */ }
    localStorage.removeItem("silo-offline-user-id");
    await getSupabaseBrowser().auth.signOut();
    router.replace("/connexion");
  }

  function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  async function togglePush() {
    setPushMessage("");
    if (pushBusy) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushMessage("Les notifications ne sont pas prises en charge par ce navigateur."); return;
    }
    if (pushEnabled) {
      setPushBusy(true);
      try {
        const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        if (subscription) {
          await apiFetch("/api/admin/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
          await subscription.unsubscribe();
        }
        setPushEnabled(false); setPushMessage("Notifications désactivées sur cet appareil.");
      } catch { setPushMessage("Impossible de désactiver les notifications. Réessayez lorsque vous êtes connecté."); }
      finally { setPushBusy(false); }
      return;
    }

    if (Notification.permission === "denied") {
      setPushMessage("Les notifications sont bloquées dans les réglages de ce navigateur."); return;
    }
    const onIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed = window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    if (onIos && !installed) {
      setPushMessage("Sur iPhone/iPad, ajoutez d’abord SILO à l’écran d’accueil, puis ouvrez l’application installée."); return;
    }
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      setPushMessage("La clé publique Web Push manque dans la configuration du déploiement."); return;
    }
    // Must be called directly from the button gesture, especially on iOS.
    const permissionRequest = Notification.requestPermission();
    setPushBusy(true);
    try {
      const permission = await permissionRequest;
      if (permission !== "granted") { setPushMessage("Autorisez les notifications pour les recevoir même lorsque l’application est fermée."); return; }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToArrayBuffer(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) });
      await apiFetch("/api/admin/push/subscribe", { method: "POST", body: JSON.stringify(subscription) });
      setPushEnabled(true); setPushMessage("Notifications activées sur cet appareil.");
      try {
        const result = await apiFetch<{ sent: number }>("/api/admin/push/test", { method: "POST" });
        if (result.sent > 0) setPushMessage("Notifications activées. Une notification de vérification vient d’être envoyée.");
      } catch { /* subscription succeeded; the test message is optional */ }
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : "Impossible d’activer les notifications.");
    } finally { setPushBusy(false); }
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
          <div className="topbar-right"><button className={`push-toggle ${pushEnabled ? "enabled" : ""}`} onClick={() => void togglePush()} disabled={pushBusy} title={pushEnabled ? "Désactiver les notifications" : "Activer les notifications"} aria-label={pushEnabled ? "Désactiver les notifications" : "Activer les notifications"}>{pushEnabled ? <Bell size={16} /> : <BellOff size={16} />}<span>{pushBusy ? "…" : pushEnabled ? "Notifications activées" : "Activer notifications"}</span></button><span className="topbar-date"><ShieldCheck size={15} color="#4e806e" /> Espace sécurisé</span><span>{new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</span></div>
        </header>
        {pushMessage && <div className="push-message" role="status"><span>{pushMessage}</span><button onClick={() => setPushMessage("")} aria-label="Fermer">×</button></div>}
        {children}
        <nav className="mobile-quick-nav" aria-label="Navigation principale">
          {visibleNav.filter((item) => ["/dashboard", "/admin/members", "/admin/attendance", "/admin/activities"].includes(item.href)).slice(0, 4).map((item) => {
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}><Icon size={19} /><span>{item.label === "Vue d’ensemble" ? "Accueil" : item.label === "Membres & ouvriers" ? "Membres" : item.label}</span></Link>;
          })}
        </nav>
      </main>
    </div>
  );
}
