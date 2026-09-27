"use client";

import { useLive } from "@/components/board/live/LiveProvider";

export type BadgeTone = "red" | "green" | "orange" | "navy";
export type AppBadge = { count: number; tone: BadgeTone; title: string };

/** Compteurs réels par application, partagés et tenus à jour en direct par le LiveProvider. */
export function useAppBadges(): Record<string, AppBadge[]> {
  const { badges: data } = useLive();
  if (!data) return {};
  const mails = data.mails ?? 0;
  const calendrier = data.calendrier ?? 0;
  const inscription = data.inscription ?? { sent: 0, pending: 0 };
  const audiovisuel = data.audiovisuel ?? 0;
  const badges: Record<string, AppBadge[]> = {
    mails: [{ count: mails, tone: "red", title: `${mails} mail(s) non lu(s)` }],
    calendrier: [{ count: calendrier, tone: "navy", title: `${calendrier} événement(s) aujourd'hui` }],
    inscription: [
      { count: inscription.sent, tone: "green", title: `${inscription.sent} invitation(s) envoyée(s)` },
      { count: inscription.pending, tone: "orange", title: `${inscription.pending} invitation(s) en attente d'envoi` },
    ],
    audiovisuel: [{ count: audiovisuel, tone: "red", title: `${audiovisuel} publication(s) à publier` }],
    frais: [
      { count: data.frais?.toValidate ?? 0, tone: "red", title: `${data.frais?.toValidate ?? 0} note(s) de frais à valider` },
      { count: data.frais?.toDeclare ?? 0, tone: "orange", title: `${data.frais?.toDeclare ?? 0} note(s) de frais à déclarer` },
    ],
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
