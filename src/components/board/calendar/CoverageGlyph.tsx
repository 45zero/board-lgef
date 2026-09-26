"use client";

import { Ban, Camera, Clock, Video } from "lucide-react";
import { COVERAGE_COLORS, type CoverageState } from "@/lib/board/tokens";
import type { PublishedMedia } from "@/lib/board/calendar";

const COVERAGE_ICONS: Record<CoverageState, typeof Camera> = {
  photo: Camera,
  video: Video,
  both: Camera,
  wait: Clock,
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
  size = 10,
}: {
  coverage: CoverageState | null;
  published?: PublishedMedia | null;
  size?: number;
}) {
  const state: CoverageState | null = coverage && coverage !== "wait" && coverage !== "no" ? coverage : published ? (published === "photo" ? "photo" : "video") : coverage;
  if (!state) return null;
  const Icon = COVERAGE_ICONS[state];
  const color = COVERAGE_COLORS[state].ink;
  const icon = <Icon size={size} className="shrink-0" style={{ color }} />;
  if (!published) return icon;
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
