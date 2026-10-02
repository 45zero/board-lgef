"use client";

import { useEffect, useState } from "react";
import { getEventFileViewUrl, type EventFile } from "@/lib/board/eventFiles";
import { getDriveStreamUrl } from "@/app/actions/media-stream";
import type { StandaloneMedia } from "@/lib/social/targets";

/** Largeur maximale d'une vidéo publiée via l'API Instagram (Reels comme carrousels). */
export const INSTAGRAM_MAX_VIDEO_PX = 1920;

type VideoSize = { width: number; height: number };

// Dimensions lues une seule fois par fichier pendant la session.
const sizeCache = new Map<string, Promise<VideoSize | null>>();

/** Lit les dimensions d'une vidéo via ses seules métadonnées (le navigateur ne télécharge que l'en-tête). */
function readVideoSize(url: string): Promise<VideoSize | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const done = (size: VideoSize | null) => {
      video.removeAttribute("src");
      video.load();
      resolve(size);
    };
    const timer = setTimeout(() => done(null), 15_000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      done(video.videoWidth ? { width: video.videoWidth, height: video.videoHeight } : null);
    };
    // Codec illisible par ce navigateur (HEVC sur Chrome/Windows…) : on ne bloque pas, Instagram tranchera.
    video.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    video.src = url;
  });
}

function sizeOf(key: string, getUrl: () => Promise<string | null>) {
  let size = sizeCache.get(key);
  if (!size) {
    size = getUrl().then((url) => (url ? readVideoSize(url) : null)).catch(() => null);
    sizeCache.set(key, size);
  }
  return size;
}

/**
 * Première vidéo des médias (10 premiers, ce que reçoit Instagram) plus large que ce qu'accepte
 * Instagram — typiquement une vidéo filmée en 4K au téléphone. null si aucune, ou tant que ce n'est pas lu.
 * `enabled` : false tant que la vérification n'est pas utile (évite de lire les vidéos de toute une liste).
 */
export function useOversizedVideo(files: EventFile[], media: StandaloneMedia[], enabled = true): (VideoSize & { name: string }) | null {
  const [oversized, setOversized] = useState<(VideoSize & { name: string }) | null>(null);

  const videos = [
    ...media
      .filter((m) => (m.content_type ?? "").startsWith("video"))
      .map((m) => ({ key: `drive:${m.drive_file_id}`, name: m.filename, getUrl: () => getDriveStreamUrl("publication", m.drive_file_id) })),
    ...files
      .slice(0, 10)
      .filter((f) => (f.content_type ?? "").startsWith("video"))
      .map((f) => ({
        key: f.id,
        name: f.filename,
        getUrl: () =>
          f.storage_provider === "drive" && f.drive_file_id ? getDriveStreamUrl(f.event_id, f.drive_file_id) : getEventFileViewUrl(f),
      })),
  ];
  const signature = enabled ? videos.map((v) => v.key).join(",") : "";

  useEffect(() => {
    if (!signature) return;
    let alive = true;
    Promise.all(videos.map(async (v) => ({ name: v.name, size: await sizeOf(v.key, v.getUrl) }))).then((sizes) => {
      if (!alive) return;
      const big = sizes.find((s) => s.size && Math.min(s.size.width, s.size.height) > 0 && Math.max(s.size.width, s.size.height) > INSTAGRAM_MAX_VIDEO_PX);
      setOversized(big?.size ? { ...big.size, name: big.name } : null);
    });
    return () => {
      alive = false;
    };
    // `videos` est recalculé à chaque rendu : la signature des fichiers suffit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return oversized;
}
