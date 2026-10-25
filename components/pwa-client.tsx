"use client";

import { useEffect } from "react";

export function PwaClient() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.error("Enregistrement PWA impossible", error instanceof Error ? error.message : "erreur inconnue");
    });
  }, []);
  return null;
}
