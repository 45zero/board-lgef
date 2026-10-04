"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { parseLatLng, type LatLng } from "@/lib/board/geo";
import { eventPosition } from "@/lib/board/travel";
import type { CurrentWeather, DayWeather, Forecast } from "@/lib/board/weather";

// Météo Open-Meteo (gratuite, sans clé) : prévisions sur 16 jours et jours passés du mois.
// Les coordonnées envoyées sont arrondies au km ; les réponses sont mises en cache 30 min par Next.

const METZ: LatLng = { lat: 49.1193, lng: 6.1757 };

type OpenMeteo = {
  current?: { temperature_2m: number; apparent_temperature: number; wind_speed_10m: number; weather_code: number; precipitation_probability?: number };
  daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
  hourly?: { time: string[]; weather_code: (number | null)[]; precipitation: (number | null)[]; precipitation_probability: (number | null)[] };
};

/** Heure de prévision (heure de Paris) : « yyyy-MM-ddTHH:mm », code WMO, pluie en mm et probabilité. */
type Hour = { time: string; code: number; mm: number; prob: number | null };

/**
 * Temps représentatif d'une plage d'heures. Le code « du jour » d'Open-Meteo est le pire de 24 h
 * (« pluie » pour une averse à 23 h, voire pour 0 mm prévu) : ici la pluie ne s'affiche que si de la
 * pluie est réellement attendue (≥ 0,2 mm/h) sur au moins `wetHours` heures, sinon le ciel le plus fréquent.
 * Au-delà de quelques jours les prévisions vont par tranches de 3 h dont le code reste parfois « couvert »
 * malgré la pluie prévue : les millimètres priment.
 */
function summarize(hours: Hour[], wetHours: number): number | null {
  if (!hours.length) return null;
  const wet = hours.filter((h) => h.mm >= 0.2);
  if (wet.length >= wetHours) {
    const worst = Math.max(...wet.map((h) => h.code));
    return worst >= 51 ? worst : wet.reduce((t, h) => t + h.mm, 0) < 1 ? 53 : 61;
  }
  // Codes de pluie sans pluie mesurable : comptés comme ciel couvert.
  const sky = hours.map((h) => (h.code >= 51 ? 3 : h.code));
  const count = new Map<number, number>();
  for (const c of sky) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

async function fetchWeather(pos: LatLng): Promise<{ current: CurrentWeather | null; days: Record<string, DayWeather>; hours: Hour[] }> {
  const params = new URLSearchParams({
    latitude: pos.lat.toFixed(2),
    longitude: pos.lng.toFixed(2),
    current: "temperature_2m,apparent_temperature,wind_speed_10m,weather_code,precipitation_probability",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    hourly: "weather_code,precipitation,precipitation_probability",
    timezone: "Europe/Paris",
    forecast_days: "16",
    past_days: "31",
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { next: { revalidate: 1800 } });
    if (!res.ok) return { current: null, days: {}, hours: [] };
    const json = (await res.json()) as OpenMeteo;
    const h = json.hourly;
    const hours: Hour[] = [];
    h?.time.forEach((t, i) => {
      const code = h.weather_code[i];
      if (code != null) hours.push({ time: t, code, mm: h.precipitation[i] ?? 0, prob: h.precipitation_probability[i] ?? null });
    });
    const days: Record<string, DayWeather> = {};
    const d = json.daily;
    d?.time.forEach((t, i) => {
      if (d.temperature_2m_max[i] == null) return;
      // Le temps du jour se lit de 8 h à 22 h : la journée et les matchs / entraînements du soir.
      const code = summarize(hours.filter((x) => x.time.startsWith(t) && x.time.slice(11, 13) >= "08" && x.time.slice(11, 13) <= "22"), 2);
      if (code == null) return;
      days[t] = { code, max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]), rain: d.precipitation_probability_max[i] ?? null };
    });
    const c = json.current;
    return {
      current: c
        ? { temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), wind: Math.round(c.wind_speed_10m), code: c.weather_code, rain: c.precipitation_probability ?? null }
        : null,
      days,
      hours,
    };
  } catch {
    return { current: null, days: {}, hours: [] };
  }
}

/** Commune d'une adresse Google (« 12 rue …, 57000 Metz, France » → « Metz »). */
function cityOf(address: string | null) {
  return address?.match(/\b\d{5}\s+([^,]+)/)?.[1]?.trim() ?? null;
}

/** Météo au domicile de l'utilisateur (sinon à Metz) : bandeau d'accueil et jours du calendrier. */
export async function getForecast(): Promise<Forecast> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  const { data: p } = userId ? await supabase.from("profiles").select("home_address, home_coordinates").eq("id", userId).maybeSingle() : { data: null };
  const home = parseLatLng(p?.home_coordinates);
  const { current, days } = await fetchWeather(home ?? METZ);
  return { place: (home && cityOf(p?.home_address ?? null)) || (home ? "Domicile" : "Metz"), current, days };
}

const parisHour = (iso: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
};

/** Météo d'un événement, à son lieu et à ses heures (null : lieu inconnu, en ligne ou date hors prévisions). */
export async function getEventWeather(eventId: string): Promise<(DayWeather & { date: string }) | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data: ev } = await createServiceClient()
    .from("events")
    .select("start_date, end_date, location, event_address, event_coordinates, online_meeting")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev || ev.online_meeting) return null;
  const pos = await eventPosition(ev);
  if (!pos) return null;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ev.start_date));
  const { days, hours } = await fetchWeather(pos);
  const day = days[date];
  if (!day) return null;
  // Événement à heure précise : temps prévu pendant l'événement (limité à sa journée), sinon temps de la journée.
  const start = parisHour(ev.start_date);
  const end = ev.end_date ? parisHour(ev.end_date) : start;
  const fullDay = start.endsWith("T00:00") && (end > `${date}T22:00` || end === start);
  if (fullDay) return { ...day, date };
  const lastHour = end > start ? (end.startsWith(date) ? end : `${date}T23:00`) : start;
  const during = hours.filter((x) => x.time >= start && x.time <= lastHour);
  const code = summarize(during, 1);
  if (code == null) return { ...day, date };
  const probs = during.map((x) => x.prob).filter((p): p is number => p != null);
  return { ...day, code, rain: probs.length ? Math.max(...probs) : day.rain, date };
}
