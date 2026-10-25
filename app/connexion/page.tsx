"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { ChurchLogo } from "@/components/church-logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const supabase = getSupabaseBrowser();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      router.replace("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connexion impossible.");
    } finally { setBusy(false); }
  }

  return <main className="public-wrap" style={{ display: "grid", alignItems: "start" }}>
    <div className="auth-card">
      <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12 }}><ArrowLeft size={14} /> Accueil</Link>
      <div style={{ marginTop: 24 }}><ChurchLogo size={68} /></div>
      <h1>Bienvenue dans votre espace</h1>
      <p>Connectez-vous avec le compte fourni par l’administration du Centre Évangélique Silo.</p>
      <form onSubmit={submit} className="auth-fields">
        <div className="field"><label htmlFor="email">Adresse électronique</label><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.com" /></div>
        <div className="field"><label htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Votre mot de passe" /></div>
        {error && <div className="notice error" role="alert">{error}</div>}
        <button className="button" type="submit" disabled={busy}>{busy ? <><span className="spinner" /> Connexion…</> : <><LockKeyhole size={16} /> Se connecter</>}</button>
      </form>
      <div className="auth-footer">Première installation ? <Link href="/initial-admin" style={{ color: "var(--green)", fontWeight: 700 }}>Créer l’administrateur principal</Link><br />Cette opération n’est possible qu’une seule fois et nécessite la clé de configuration.</div>
    </div>
  </main>;
}
