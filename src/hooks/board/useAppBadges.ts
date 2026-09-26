"use client";

import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/board/localCache";
import type { AppBadges } from "@/app/api/badges/route";

export type BadgeTone = "red" | "green" | "orange" | "navy";
export type AppBadge = { count: number; tone: BadgeTone; title: string };

const REFRESH_MS = 60_000;

/** Compteurs réels par application (voir /api/badges), rafraîchis chaque minute et au retour sur l'onglet. */
export function useAppBadges(): Record<string, AppBadge[]> {
  const [data, setData] = useState<AppBadges | null>(() => readCache<AppBadges>("badges") ?? null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/badges")
        .then((r) => (r.ok ? r.json() : null))
        .then((b: AppBadges | null) => {
          if (!b || cancelled) return;
          setData(b);
          writeCache("badges", b);
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!data) return {};
  const badges: Record<string, AppBadge[]> = {
    mails: [{ count: data.mails, tone: "red", title: `${data.mails} mail(s) non lu(s)` }],
    calendrier: [{ count: data.calendrier, tone: "navy", title: `${data.calendrier} événement(s) aujourd'hui` }],
    inscription: [
      { count: data.inscription.sent, tone: "green", title: `${data.inscription.sent} invitation(s) envoyée(s)` },
      { count: data.inscription.pending, tone: "orange", title: `${data.inscription.pending} invitation(s) en attente d'envoi` },
    ],
    audiovisuel: [{ count: data.audiovisuel, tone: "red", title: `${data.audiovisuel} publication(s) à publier` }],
  };
  for (const key of Object.keys(badges)) badges[key] = badges[key].filter((b) => b.count > 0);
  return badges;
}

export const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  red: "bg-red text-white",
  green: "bg-good text-white",
  orange: "bg-warn text-white",
  navy: "bg-navy text-white",
};

export function formatBadgeCount(n: number) {
  return n > 99 ? "99+" : String(n);
}
