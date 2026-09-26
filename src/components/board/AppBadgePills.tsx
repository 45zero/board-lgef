"use client";

import { BADGE_TONE_CLASSES, formatBadgeCount, type AppBadge } from "@/hooks/board/useAppBadges";

/** Pastilles de compteurs d'une application (une par compteur, ex. envoyés en vert + en attente en orange). */
export function AppBadgePills({ badges, className = "" }: { badges: AppBadge[] | undefined; className?: string }) {
  if (!badges?.length) return null;
  return (
    <span className={`pointer-events-none flex gap-0.5 ${className}`}>
      {badges.map((b) => (
        <span
          key={b.tone + b.title}
          title={b.title}
          className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold ring-2 ring-card ${BADGE_TONE_CLASSES[b.tone]}`}
        >
          {formatBadgeCount(b.count)}
        </span>
      ))}
    </span>
  );
}
