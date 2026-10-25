"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, RefreshCw, Save, ShieldCheck, UserCog, Users } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type Role = "secretariat" | "department_lead";
type Department = { id: string; name: string };
type Account = { id: string; full_name: string; email: string; role: string; status: string; created_at: string; permissions: string[]; departmentIds: string[] };
type AccountDraft = { fullName: string; role: Role; status: "active" | "inactive" | "archived"; permissions: string[]; departmentIds: string[] };
type Permission = { key: string; label: string };
const emptyDraft = (): AccountDraft => ({ fullName: "", role: "secretariat", status: "active", permissions: [], departmentIds: [] });
const groups: { title: string; permissions: Permission[] }[] = [
  { title: "Accueil et inscriptions", permissions: [
    { key: "dashboard.read", label: "Consulter le tableau de bord" },
    { key: "submissions.read", label: "Consulter les formulaires reçus" },
    { key: "submissions.validate", label: "Valider ou traiter les inscriptions" },
    { key: "links.manage", label: "Créer et révoquer les liens d’inscription" },
  ] },
  { title: "Membres et départements", permissions: [
    { key: "members.read_all", label: "Consulter toutes les fiches" },
    { key: "members.read_assigned", label: "Consulter les fiches des départements attribués" },
    { key: "members.create", label: "Créer des fiches de membres" },
    { key: "members.assign_departments", label: "Gérer les affectations des membres" },
    { key: "departments.read_all", label: "Consulter tous les départements" },
    { key: "departments.read_assigned", label: "Consulter les départements attribués" },
  ] },
  { title: "Présences et programmes", permissions: [
    { key: "attendance.read_all", label: "Consulter toutes les présences" },
    { key: "attendance.read_assigned", label: "Consulter les présences des départements attribués" },
    { key: "attendance.write", label: "Enregistrer les présences et absences" },
    { key: "activities.read_all", label: "Consulter tous les programmes" },
    { key: "activities.read_assigned", label: "Consulter les programmes des départements attribués" },
    { key: "activities.manage", label: "Gérer les programmes généraux" },
    { key: "activities.manage_assigned", label: "Gérer les programmes des départements attribués" },
  ] },
    { title: "Finances et administration", permissions: [
    { key: "finance.read", label: "Consulter les finances et rapports financiers" },
    { key: "finance.write", label: "Enregistrer des opérations financières" },
    { key: "audit.read", label: "Consulter le journal d’audit" },
    { key: "users.manage", label: "Gérer les comptes et autorisations" },
  ] },
];

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [draft, setDraft] = useState<AccountDraft>(emptyDraft());
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const result = await apiFetch<{ users: Account[]; departments: Department[] }>("/api/admin/users");
      setAccounts(result.users); setDepartments(result.departments);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les comptes."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function edit(account: Account) {
    if (account.role === "super_admin") return;
    setEditingId(account.id); setNotice(""); setError("");
    setDraft({ fullName: account.full_name, role: account.role as Role, status: account.status as AccountDraft["status"], permissions: account.permissions, departmentIds: account.departmentIds });
    document.getElementById("account-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function toggle(key: string) {
    setDraft((current) => ({ ...current, permissions: current.permissions.includes(key) ? current.permissions.filter((item) => item !== key) : [...current.permissions, key] }));
  }
  function toggleDepartment(id: string) {
    setDraft((current) => ({ ...current, departmentIds: current.departmentIds.includes(id) ? current.departmentIds.filter((item) => item !== id) : [...current.departmentIds, id] }));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiFetch<{ message: string }>("/api/admin/users", { method: "PATCH", body: JSON.stringify({ ...draft, id: editingId }) });
      setNotice(result.message); setEditingId(""); setDraft(emptyDraft()); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer ce compte."); }
    finally { setBusy(false); }
  }

  return <AdminShell title="Administration des comptes"><div className="admin-content">
    <div className="page-heading"><div><h1>Comptes et autorisations</h1><p>Consultez les comptes existants et gérez leurs autorisations.</p></div><button className="button secondary small" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Actualiser</button></div>
    {error && <div className="notice error" style={{ marginBottom: 14 }} role="alert">{error}</div>}
    {notice && <div className="notice" style={{ marginBottom: 14 }} role="status">{notice}</div>}

    <section className="card panel" style={{ marginBottom: 18 }}><div className="panel-heading"><div><h2><Users size={18} style={{ verticalAlign: "-4px", marginRight: 7 }} />Comptes existants</h2><div className="field-hint" style={{ marginTop: 4 }}>L’administrateur principal est créé une seule fois et son rôle ne peut pas être réattribué.</div></div><ShieldCheck size={19} color="#658775" /></div>
      {loading && !accounts.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : accounts.length ? <div className="table-wrap"><table><thead><tr><th>Nom et courriel</th><th>Rôle</th><th>Statut</th><th>Départements</th><th></th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td><strong>{account.full_name}</strong><div className="field-hint">{account.email}</div></td><td>{account.role === "super_admin" ? "Administrateur principal" : account.role === "secretariat" ? "Secrétariat" : "Responsable de département"}</td><td><span className={`badge ${account.status === "active" ? "approved" : "rejected"}`}>{account.status === "active" ? "Actif" : account.status === "inactive" ? "Inactif" : "Archivé"}</span></td><td>{account.departmentIds.map((id) => departments.find((department) => department.id === id)?.name).filter(Boolean).join(" · ") || "—"}</td><td>{account.role === "super_admin" ? <span className="field-hint">Protégé</span> : <button className="button secondary small" onClick={() => edit(account)}>Configurer</button>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><Users size={24} /><strong>Aucun compte secondaire</strong>Aucun compte secondaire enregistré.</div>}
    </section>

    {editingId ? <form id="account-form" className="card panel" onSubmit={(event) => void save(event)}>
      <div className="panel-heading"><div><h2>Configurer un compte</h2><div className="field-hint" style={{ marginTop: 4 }}>Les permissions sont contrôlées côté serveur et enregistrées dans le journal d’audit.</div></div><UserCog size={19} color="#658775" /></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="full-name">Nom complet *</label><input id="full-name" value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} required minLength={2} maxLength={140} /></div>
        <div className="field"><label htmlFor="account-role">Rôle *</label><select id="account-role" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}><option value="secretariat">Secrétariat</option><option value="department_lead">Responsable de département</option></select></div>
        <div className="field"><label htmlFor="account-status">Statut *</label><select id="account-status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as AccountDraft["status"] })}><option value="active">Actif</option><option value="inactive">Inactif</option><option value="archived">Archivé</option></select></div>
        <div className="field span-2"><label>Départements accessibles{draft.role === "department_lead" ? " *" : ""}</label><div className="dept-grid">{departments.map((department) => <label className={`check-card ${draft.departmentIds.includes(department.id) ? "selected" : ""}`} key={department.id}><input type="checkbox" checked={draft.departmentIds.includes(department.id)} onChange={() => toggleDepartment(department.id)} /><span>{department.name}</span></label>)}</div><span className="field-hint">Les responsables voient uniquement les informations des départements qui leur sont attribués.</span></div>
        <div className="field span-2"><label>Permissions</label><div style={{ display: "grid", gap: 14 }}>{groups.map((group) => <fieldset key={group.title} style={{ border: "1px solid var(--line)", borderRadius: 11, padding: 13, minWidth: 0 }}><legend style={{ padding: "0 5px", fontSize: 12, fontWeight: 800, color: "var(--green)" }}>{group.title}</legend><div className="dept-grid">{group.permissions.map((permission) => <label className={`check-card ${draft.permissions.includes(permission.key) ? "selected" : ""}`} key={permission.key}><input type="checkbox" checked={draft.permissions.includes(permission.key)} onChange={() => toggle(permission.key)} /><span>{permission.label}</span></label>)}</div></fieldset>)}</div><span className="field-hint">Le rôle « administrateur principal » n’est pas proposé ici. L’application n’en accepte qu’un seul, créé par la page d’installation initiale.</span></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 18 }}>
        {editingId && <button className="button secondary" type="button" onClick={() => { setEditingId(""); setDraft(emptyDraft()); }}>Annuler</button>}
        <button className="button" type="submit" disabled={busy}>{busy ? "Enregistrement…" : <><Save size={15} /> Enregistrer les autorisations</>}</button>
      </div>
    </form> : <div className="notice warn" style={{ marginTop: 15 }}><KeyRound size={16} />La création des comptes Secrétariat et Responsables est temporairement suspendue. Les comptes existants peuvent toujours être consultés et leurs autorisations ajustées.</div>}
  </div></AdminShell>;
}
