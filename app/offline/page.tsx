"use client";

import Link from "next/link";
import { CloudOff, RefreshCw } from "lucide-react";

export default function OfflinePage() {
  return <main className="offline-page"><section className="card offline-card">
    <div className="logo-mark">S</div>
    <div className="offline-icon"><CloudOff size={25} /></div>
    <h1>Connexion indisponible</h1>
    <p>Cette page n’est pas encore enregistrée sur cet appareil. Reconnectez-vous pour charger les données autorisées et les préparer hors ligne.</p>
    <button className="button" onClick={() => window.location.reload()}><RefreshCw size={15} /> Réessayer</button>
    <Link href="/connexion" className="button secondary">Aller à la connexion</Link>
  </section></main>;
}
