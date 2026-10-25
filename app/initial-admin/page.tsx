"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { ChurchLogo } from "@/components/church-logo";

export default function InitialAdminPage() {
  const [values, setValues] = useState({ fullName: "", email: "", password: "", setupKey: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/setup/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "La création du compte a échoué.");
      setSuccess(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "La création du compte a échoué."); }
    finally { setBusy(false); }
  }

  function update(field: keyof typeof values, value: string) { setValues((current) => ({ ...current, [field]: value })); }

  return <main className="public-wrap" style={{ display: "grid", alignItems: "start" }}>
    <div className="auth-card">
      <Link href="/connexion" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12 }}><ArrowLeft size={14} /> Retour à la connexion</Link>
      <div style={{ marginTop: 24 }}><ChurchLogo size={68} /></div>
      <h1>Première installation</h1>
      <p>Créez le compte de l’administrateur principal. La base de données n’acceptera qu’un seul compte avec ce rôle.</p>
      <form onSubmit={submit} className="auth-fields">
        <div className="field"><label htmlFor="fullName">Nom complet</label><input id="fullName" required minLength={2} autoComplete="name" value={values.fullName} onChange={(e) => update("fullName", e.target.value)} /></div>
        <div className="field"><label htmlFor="email">Adresse électronique</label><input id="email" type="email" required autoComplete="email" value={values.email} onChange={(e) => update("email", e.target.value)} /></div>
        <div className="field"><label htmlFor="password">Mot de passe</label><input id="password" type="password" required minLength={12} autoComplete="new-password" value={values.password} onChange={(e) => update("password", e.target.value)} /><span className="field-hint">12 caractères minimum.</span></div>
        <div className="field"><label htmlFor="setupKey">Clé de première installation</label><input id="setupKey" type="password" required minLength={32} autoComplete="off" value={values.setupKey} onChange={(e) => update("setupKey", e.target.value)} /><span className="field-hint">Valeur enregistrée dans les variables d’environnement du serveur, jamais dans le navigateur ou Git.</span></div>
        {error && <div className="notice error" role="alert">{error}</div>}
        {success && <div className="notice" role="status"><ShieldCheck size={17} />{success} <Link href="/connexion" style={{ fontWeight: 700 }}>Se connecter</Link></div>}
        <button className="button" type="submit" disabled={busy || Boolean(success)}>{busy ? <><span className="spinner" /> Création…</> : <><ShieldCheck size={16} /> Créer l’administrateur principal</>}</button>
      </form>
      <div className="auth-footer">Les tentatives répétées sont limitées par la base de données et toute seconde création est bloquée.</div>
    </div>
  </main>;
}
