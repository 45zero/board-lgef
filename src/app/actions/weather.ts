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
  daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
};

async function fetchWeather(pos: LatLng): Promise<{ current: CurrentWeather | null; days: Record<string, DayWeather> }> {
  const params = new URLSearchParams({
    latitude: pos.lat.toFixed(2),
    longitude: pos.lng.toFixed(2),
    current: "temperature_2m,apparent_temperature,wind_speed_10m,weather_code,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Europe/Paris",
    forecast_days: "16",
    past_days: "31",
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { next: { revalidate: 1800 } });
    if (!res.ok) return { current: null, days: {} };
    const json = (await res.json()) as OpenMeteo;
    const days: Record<string, DayWeather> = {};
    const d = json.daily;
    d?.time.forEach((t, i) => {
      if (d.temperature_2m_max[i] == null) return;
      days[t] = { code: d.weather_code[i], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]), rain: d.precipitation_probability_max[i] ?? null };
    });
    const c = json.current;
    return {
      current: c
        ? { temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), wind: Math.round(c.wind_speed_10m), code: c.weather_code, rain: c.precipitation_probability ?? null }
        : null,
      days,
    };
  } catch {
    return { current: null, days: {} };
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

/** Météo du jour d'un événement, à son lieu (null : lieu inconnu, en ligne ou date hors prévisions). */
export async function getEventWeather(eventId: string): Promise<(DayWeather & { date: string }) | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data: ev } = await createServiceClient()
    .from("events")
    .select("start_date, location, event_address, event_coordinates, online_meeting")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev || ev.online_meeting) return null;
  const pos = await eventPosition(ev);
  if (!pos) return null;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ev.start_date));
  const { days } = await fetchWeather(pos);
  return days[date] ? { ...days[date], date } : null;
}
