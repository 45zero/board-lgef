"use client";

import { useEffect, useState } from "react";
import { getEventWeather, getForecast } from "@/app/actions/weather";
import { readCache, writeCache } from "@/lib/board/localCache";
import { dayKey, weatherIcon, type DayWeather as Day, type Forecast } from "@/lib/board/weather";

// Météo à côté des jours du calendrier (domicile de l'utilisateur, sinon Metz) et dans les événements.

let pending: Promise<Forecast> | null = null;
let pendingAt = 0;

/** Prévisions partagées par tous les jours affichés : une seule requête, rafraîchie toutes les 30 min. */
export function useForecast() {
  const [forecast, setForecast] = useState<Forecast | null>(() => readCache<Forecast>("weather:forecast:v2") ?? null);
  useEffect(() => {
    let cancelled = false;
    if (!pending || Date.now() - pendingAt > 30 * 60_000) {
      pendingAt = Date.now();
      pending = getForecast();
    }
    pending
      .then((f) => {
        if (cancelled || !Object.keys(f.days).length) return;
        setForecast(f);
        writeCache("weather:forecast:v2", f);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return forecast;
}

/** « 🌤️ 18° 9° » : pictogramme, maximale et minimale du jour (rien hors prévisions). */
export function DayWeatherBadge({ day, forecast, compact }: { day: Date; forecast: Forecast | null; compact?: boolean }) {
  const w = forecast?.days[dayKey(day)];
  if (!w) return null;
  const { icon, label } = weatherIcon(w.code);
  return (
    <span
      className="inline-flex items-center gap-0.5 whitespace-nowrap font-mono text-[10px] leading-none"
      title={`${label} · ${w.max}° / ${w.min}°${w.rain != null ? ` · pluie ${w.rain} %` : ""} — ${forecast!.place}`}
    >
      <span className="text-[11px]">{icon}</span>
      <span className="font-bold">{w.max}°</span>
      {!compact && <span className="opacity-60">{w.min}°</span>}
    </span>
  );
}

/** Météo du jour d'un événement, à son lieu. */
export function EventWeather({ eventId }: { eventId: string | null | undefined }) {
  const [w, setW] = useState<(Day & { date: string }) | null>(null);
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    getEventWeather(eventId)
      .then((r) => !cancelled && setW(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [eventId]);
  if (!w) return null;
  const { icon, label } = weatherIcon(w.code);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-2" title="Prévision au lieu et aux heures de l'événement">
      <span>{icon}</span>
      {label} · {w.max}° / {w.min}°{w.rain != null && w.rain > 0 ? ` · pluie ${w.rain} %` : ""}
    </span>
  );
}
