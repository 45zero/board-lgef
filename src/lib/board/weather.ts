/** Météo (Open-Meteo) : types et pictogrammes partagés client/serveur — bandeau d'accueil, calendrier, événements. */

/** Météo d'un jour (clé « yyyy-MM-dd », heure de Paris). */
export type DayWeather = { code: number; max: number; min: number; rain: number | null };

export type CurrentWeather = { temp: number; feels: number; wind: number; code: number; rain: number | null };

export type Forecast = {
  /** Commune affichée (domicile de l'utilisateur, sinon Metz). */
  place: string;
  current: CurrentWeather | null;
  days: Record<string, DayWeather>;
};

/** Code météo WMO → pictogramme et libellé. */
export function weatherIcon(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: "☀️", label: "Ensoleillé" };
  if (code <= 2) return { icon: "🌤️", label: "Éclaircies" };
  if (code === 3) return { icon: "☁️", label: "Couvert" };
  if (code === 45 || code === 48) return { icon: "🌫️", label: "Brouillard" };
  if (code >= 51 && code <= 57) return { icon: "🌦️", label: "Bruine" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: "🌧️", label: "Pluie" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: "🌨️", label: "Neige" };
  if (code >= 95) return { icon: "⛈️", label: "Orage" };
  return { icon: "🌡️", label: "Météo" };
}

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
