 "use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { ChurchLogo } from "@/components/church-logo";

export default function Home() {
  const [setupAvailable, setSetupAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/setup/bootstrap", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (active) setSetupAvailable(Boolean(result && !result.initialized)); })
      .catch(() => undefined);
    const hideSetup = () => setSetupAvailable(false);
    window.addEventListener("silo:initial-admin-created", hideSetup);
    const onStorage = (event: StorageEvent) => { if (event.key === "silo-initial-admin-created") hideSetup(); };
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.removeEventListener("silo:initial-admin-created", hideSetup);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return (
    <main className="landing">
      <nav className="landing-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}><ChurchLogo size={48} /><div><div className="brand-title">SILO VERT OUVRIERS</div><div className="brand-subtitle">Campus de la Cité Verte</div></div></div>
        <Link className="button secondary" href="/connexion"><LockKeyhole size={15} /> Espace administration</Link>
      </nav>
      <section className="landing-hero">
        <div>
          <div className="eyebrow"><CheckCircle2 size={15} /> Centre Évangélique Silo</div>
          <h1>Servir ensemble.<br /><span style={{ color: "var(--green)" }}>Grandir en ordre.</span></h1>
          <p>Un espace unique pour accompagner les membres, organiser les départements et simplifier le suivi administratif de l’Église.</p>
          <div className="hero-actions"><Link className="button" href="/connexion">Accéder à mon espace <ArrowRight size={16} /></Link>{setupAvailable && <Link className="button secondary" href="/initial-admin"><ShieldCheck size={15} /> Première installation</Link>}<span style={{ fontSize: 12, color: "var(--muted)" }}>Accès réservé aux utilisateurs autorisés</span></div>
        </div>
        <div className="hero-visual"><ChurchLogo size={176} className="landing-hero-logo" /><div className="hero-note"><strong>Une seule fiche, plusieurs services.</strong>Les informations suivent chaque ouvrier dans ses départements.</div></div>
      </section>
      <div className="landing-strip">Centre Évangélique Silo — Campus de la Cité Verte</div>
    </main>
  );
}
