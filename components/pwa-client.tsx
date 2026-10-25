"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaClient() {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installHelp, setInstallHelp] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const refreshOnControllerChange = useRef(false);

  useEffect(() => {
    const userAgent = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const displayTimer = window.setTimeout(() => {
      setIsIos(ios);
      setInstalled(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    }, 0);

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const afterInstall = () => { setInstalled(true); setInstallPrompt(null); setInstallHelp(false); };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", afterInstall);

    if (!("serviceWorker" in navigator)) return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", afterInstall);
    };

    let updateTimer: number | undefined;
    let installedWorker: ServiceWorker | null = null;
    let mounted = true;
    const revealWaitingWorker = () => {
      if (mounted && registrationRef.current?.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
    };
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (!mounted) return;
        registrationRef.current = registration;
        revealWaitingWorker();
        registration.addEventListener("updatefound", () => {
          installedWorker = registration.installing;
          installedWorker?.addEventListener("statechange", revealWaitingWorker);
        });
        await registration.update().catch(() => undefined);
        updateTimer = window.setInterval(() => { void registration.update().catch(() => undefined); }, 60 * 60 * 1000);
      } catch (error) {
        console.error("Enregistrement PWA impossible", error instanceof Error ? error.message : "erreur inconnue");
      }
    };
    const controllerChange = () => {
      if (refreshOnControllerChange.current) window.location.reload();
    };
    const onFocus = () => { if (registrationRef.current) void registrationRef.current.update().catch(() => undefined); };
    navigator.serviceWorker.addEventListener("controllerchange", controllerChange);
    void register();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted = false;
      window.clearTimeout(displayTimer);
      if (updateTimer) window.clearInterval(updateTimer);
      installedWorker?.removeEventListener("statechange", revealWaitingWorker);
      navigator.serviceWorker.removeEventListener("controllerchange", controllerChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", afterInstall);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) { setInstallHelp(true); return; }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  function updateApp() {
    const waiting = registrationRef.current?.waiting;
    if (!waiting) { setUpdateReady(false); window.location.reload(); return; }
    refreshOnControllerChange.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  if (!updateReady && (installed || (!installPrompt && !isIos))) return null;
  return <>
    <aside className="pwa-prompt no-print" aria-live="polite">
      {updateReady ? <><div><strong>Une mise à jour est disponible</strong><span>Actualisez l’application pour profiter de la dernière version.</span></div><button className="button small" onClick={updateApp}><RefreshCw size={15} /> Mettre à jour</button></> : <><div><strong>Installer Silo Vert Ouvriers</strong><span>Ajoutez l’application à l’écran d’accueil pour la retrouver rapidement.</span></div><button className="button small" onClick={() => void installApp()}><Download size={15} /> Installer</button></>}
      <button className="pwa-dismiss" aria-label="Fermer" onClick={() => { setInstallPrompt(null); setIsIos(false); setUpdateReady(false); }}><X size={17} /></button>
    </aside>
    {installHelp && <div className="pwa-help-backdrop no-print" role="presentation" onClick={() => setInstallHelp(false)}><section className="pwa-help card" role="dialog" aria-modal="true" aria-labelledby="pwa-help-title" onClick={(event) => event.stopPropagation()}><button className="pwa-dismiss" aria-label="Fermer" onClick={() => setInstallHelp(false)}><X size={17} /></button><h2 id="pwa-help-title">Installer sur iPhone ou iPad</h2><ol><li>Dans Safari, touchez le bouton <strong>Partager</strong>.</li><li>Choisissez <strong>Sur l’écran d’accueil</strong>.</li><li>Touchez <strong>Ajouter</strong>.</li></ol><p className="field-hint">L’application apparaîtra sur votre écran d’accueil et pourra s’ouvrir en plein écran.</p><button className="button" onClick={() => setInstallHelp(false)}>Compris</button></section></div>}
  </>;
}
