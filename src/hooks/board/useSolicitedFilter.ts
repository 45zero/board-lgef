"use client";

import { useState } from "react";

const KEY = "lgef-board:calendar-mine-only";

/**
 * Filtre « Uniquement où je suis sollicité » du calendrier (ordinateur et mobile) : désactivé par
 * défaut (tous les événements), mémorisé dans le navigateur.
 */
export function useSolicitedFilter(): [boolean, (value: boolean) => void] {
  const [mineOnly, setMineOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = (value: boolean) => {
    setMineOnly(value);
    try {
      localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      // stockage indisponible : le choix vaut pour la session
    }
  };
  return [mineOnly, set];
}
