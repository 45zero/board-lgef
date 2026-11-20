"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

// Version chargée dans ce navigateur (figée au build, next.config.ts → NEXT_PUBLIC_BUILD_ID).
const LOADED = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const CHECK_EVERY_MS = 5 * 60_000;

/**
 * Nouvelle version du board en ligne alors que l'appli est restée ouverte (appli du Dock, onglet
 * jamais rechargé, mobile) : bandeau « Recharger », et rechargement automatique dès que l'on revient
 * dans l'appli (onglet caché puis réaffiché) — jamais en pleine saisie sous les yeux de la personne.
 */
export function VersionWatcher() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (LOADED === "dev") return;
    let stale = false;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { id } = (await res.json()) as { id?: string };
        if (id && id !== "dev" && id !== LOADED) {
          stale = true;
          setOutdated(true);
        }
      } catch {
        // Hors ligne : nouvel essai au prochain passage.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Retour dans l'appli avec une version périmée : rechargement immédiat (rien n'est en cours).
      if (stale) window.location.reload();
      else void check();
    };
    const timer = window.setInterval(() => document.visibilityState === "visible" && void check(), CHECK_EVERY_MS);
    const first = window.setTimeout(() => void check(), 20_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", check);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", check);
    };
  }, []);

  if (!outdated) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-[90] flex justify-center px-4" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="flex items-center gap-3 rounded-full bg-navy px-4 py-2 text-sm text-white shadow-modal">
        <span>Une nouvelle version du board est disponible.</span>
        <button onClick={() => window.location.reload()} className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-bold text-navy">
          <RefreshCw size={12} /> Recharger
        </button>
      </div>
    </div>
  );
}
