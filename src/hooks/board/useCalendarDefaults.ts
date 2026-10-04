"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Affichage par défaut du calendrier (clic droit sur les icônes et les vues) : vue, « où je suis
 * sollicité », matchs couverts en vidéo / en photo. Enregistré sur le compte (profiles.calendar_prefs,
 * sql/2026-10-04_calendar_prefs_notification_emails.sql) pour suivre sur le mobile, avec une copie
 * dans le navigateur pour un affichage immédiat. Le clic simple n'agit que sur la session.
 */
export type CalendarView = "day" | "week" | "month" | "map";
export type CalendarDefaults = { view: CalendarView; mine: boolean; video: boolean; photo: boolean };

const KEY = "lgef-board:calendar-defaults";
const LEGACY_COVERAGE = "lgef-board:calendar-coverage-defaults";
const LEGACY_MINE = "lgef-board:calendar-mine-only";
const FALLBACK: CalendarDefaults = { view: "month", mine: false, video: false, photo: false };

function readLocal(): CalendarDefaults {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CalendarDefaults> | null;
    if (saved) return { ...FALLBACK, ...saved };
    // Anciens réglages du navigateur repris une fois.
    const coverage = JSON.parse(localStorage.getItem(LEGACY_COVERAGE) ?? "null") as { video?: boolean; photo?: boolean } | null;
    return { ...FALLBACK, video: !!coverage?.video, photo: !!coverage?.photo, mine: localStorage.getItem(LEGACY_MINE) === "1" };
  } catch {
    return FALLBACK;
  }
}

// Magasin partagé : l'ordinateur et le mobile, les icônes et les vues lisent la même valeur.
let current: CalendarDefaults | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const getSnapshot = () => (current ??= readLocal());
const getServerSnapshot = () => FALLBACK;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

function store(next: CalendarDefaults) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // stockage indisponible : le compte garde le réglage
  }
  emit();
}

let loadedFor: string | null = null;

export function useCalendarDefaults(): [CalendarDefaults, <K extends keyof CalendarDefaults>(key: K, value: CalendarDefaults[K]) => void] {
  const { user } = useAuth();
  const defaults = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Réglage du compte (fait sur un autre appareil) : relu une fois par session.
  useEffect(() => {
    if (!user || loadedFor === user.id) return;
    loadedFor = user.id;
    createClient()
      .from("profiles")
      .select("calendar_prefs")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        const prefs = (data as { calendar_prefs?: Partial<CalendarDefaults> | null } | null)?.calendar_prefs;
        if (error || !prefs || Object.keys(prefs).length === 0) return;
        store({ ...FALLBACK, ...prefs });
      });
  }, [user]);

  const setDefault = <K extends keyof CalendarDefaults>(key: K, value: CalendarDefaults[K]) => {
    const next = { ...getSnapshot(), [key]: value };
    store(next);
    if (!user) return;
    createClient()
      .from("profiles")
      .update({ calendar_prefs: next } as never)
      .eq("id", user.id)
      .then(({ error }) => {
        if (error) console.warn("[useCalendarDefaults] réglage gardé dans ce navigateur seulement :", error.message);
      });
  };

  return [defaults, setDefault];
}
