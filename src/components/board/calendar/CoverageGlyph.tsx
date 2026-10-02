"use client";

import { Ban, BellRing, Camera, Clock, UserCheck, Video } from "lucide-react";
import { COVERAGE_COLORS, COVERAGE_LABELS, type CoverageState } from "@/lib/board/tokens";
import type { PublishedMedia } from "@/lib/board/calendar";

const COVERAGE_ICONS: Record<CoverageState, typeof Camera> = {
  photo: Camera,
  video: Video,
  both: Camera,
  wait: Clock,
  assigned: UserCheck,
  no: Ban,
};

/**
 * Sigle de couverture d'un événement (photo, vidéo, en attente…). Entouré d'un cercle quand un
 * média de l'événement a été publié sur les réseaux — un événement sans demande de couverture mais
 * avec un média publié affiche directement la caméra / l'appareil photo entouré.
 */
export function CoverageGlyph({
  coverage,
  published,
  awaitingMe = false,
  size = 10,
}: {
  coverage: CoverageState | null;
  published?: PublishedMedia | null;
  /** Je suis désigné et dois répondre : pastille rouge qui attire l'œil, à la place du sigle. */
  awaitingMe?: boolean;
  size?: number;
}) {
  if (awaitingMe)
    return (
      <span
        title="Vous êtes désigné : ouvrez l'événement pour accepter ou refuser"
        className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-red text-white"
        style={{ width: size + 6, height: size + 6 }}
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-red opacity-40" />
        <BellRing size={size - 1} strokeWidth={2.75} className="relative" />
      </span>
    );
  const state: CoverageState | null = coverage && coverage !== "wait" && coverage !== "assigned" && coverage !== "no" ? coverage : published ? (published === "photo" ? "photo" : "video") : coverage;
  if (!state) return null;
  const Icon = COVERAGE_ICONS[state];
  const color = COVERAGE_COLORS[state].ink;
  const icon = <Icon size={size} className="shrink-0" style={{ color }} />;
  if (!published)
    return (
      <span title={COVERAGE_LABELS[state].long} className="inline-flex shrink-0">
        {icon}
      </span>
    );
  return (
    <span
      title="Publié sur les réseaux"
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ padding: Math.max(1, Math.round(size / 5)), boxShadow: `0 0 0 1.5px ${color}` }}
    >
      {icon}
    </span>
  );
}
