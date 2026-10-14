"use client";

import { useEffect, useMemo, useState } from "react";
import { getMyTravelTimes } from "@/app/actions/my-schedule";
import type { CalendarEvent } from "@/lib/board/calendar";
import type { Travel } from "@/lib/board/geo";

// Cache de session (clé : id + lieu) : un changement de semaine ne redemande que les nouveaux événements.
const travelCache = new Map<string, Travel | null>();
const cacheKey = (e: CalendarEvent) => `${e.id}|${e.location}`;

/**
 * Temps de route domicile → événement de l'utilisateur connecté, pour les événements où il est
 * sollicité et qui ont un lieu (bloc « départ » en pointillé dans la grille du calendrier).
 */
export function useMyTravelTimes(events: CalendarEvent[]) {
  const wanted = events.filter((e) => e.solicited && e.location && !e.onlineMeeting);
  const key = wanted.map(cacheKey).sort().join("\n");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const missing = key ? key.split("\n").filter((k) => !travelCache.has(k)) : [];
    if (missing.length === 0) return;
    let cancelled = false;
    getMyTravelTimes(missing.map((k) => k.split("|")[0]))
      .then((res) => {
        for (const k of missing) travelCache.set(k, res[k.split("|")[0]] ?? null);
      })
      .catch(() => {})
      .finally(() => !cancelled && setVersion((v) => v + 1));
    return () => {
      cancelled = true;
    };
  }, [key]);

  return useMemo(() => {
    const out: Record<string, Travel> = {};
    for (const k of key ? key.split("\n") : []) {
      const t = travelCache.get(k);
      if (t) out[k.split("|")[0]] = t;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version signale un cache complété
  }, [key, version]);
}
