import Link from "next/link";
import { ArrowRight, CheckCircle2, LockKeyhole } from "lucide-react";
import { ChurchLogo } from "@/components/church-logo";

export default function Home() {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}><ChurchLogo size={48} /><div><div className="brand-title">SILO GESTION ÉGLISE</div><div className="brand-subtitle">Campus de la Cité Verte</div></div></div>
        <Link className="button secondary" href="/connexion"><LockKeyhole size={15} /> Espace administration</Link>
      </nav>
      <section className="landing-hero">
        <div>
          <div className="eyebrow"><CheckCircle2 size={15} /> Centre Évangélique Silo</div>
          <h1>Servir ensemble.<br /><span style={{ color: "var(--green)" }}>Grandir en ordre.</span></h1>
          <p>Un espace unique pour accompagner les membres, organiser les départements et simplifier le suivi administratif de l’Église.</p>
          <div className="hero-actions"><Link className="button" href="/connexion">Accéder à mon espace <ArrowRight size={16} /></Link><span style={{ fontSize: 12, color: "var(--muted)" }}>Accès réservé aux utilisateurs autorisés</span></div>
        </div>
        <div className="hero-visual"><ChurchLogo size={176} className="landing-hero-logo" /><div className="hero-note"><strong>Une seule fiche, plusieurs services.</strong>Les informations suivent chaque ouvrier dans ses départements.</div></div>
      </section>
      <div className="landing-strip">Centre Évangélique Silo — Campus de la Cité Verte</div>
    </main>
  );
}
