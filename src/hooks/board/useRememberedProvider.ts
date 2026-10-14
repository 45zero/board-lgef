"use client";

import { useEffect, useState } from "react";

export type BrandProvider = "google" | "microsoft" | null;

// Fournisseur (Google, Microsoft) d'un service connecté : retenu sur l'appareil pour que le logo
// s'affiche dès le chargement, puis vérifié une fois par session.
const known = new Map<string, BrandProvider>();
const pending = new Map<string, Promise<BrandProvider>>();

const readStored = (key: string): BrandProvider => {
  try {
    const v = window.localStorage.getItem(key);
    return v === "google" || v === "microsoft" ? v : null;
  } catch {
    return null;
  }
};

/** Fournisseur affiché tout de suite (mémoire, puis appareil), confirmé par `load` une fois par session. */
export function useRememberedProvider(key: string, load: () => Promise<BrandProvider>): BrandProvider {
  const [provider, setProvider] = useState<BrandProvider>(() =>
    known.has(key) ? known.get(key)! : typeof window === "undefined" ? null : readStored(key)
  );
  useEffect(() => {
    let alive = true;
    let p = pending.get(key);
    if (!p) {
      p = load()
        .then((value) => {
          known.set(key, value);
          try {
            if (value) window.localStorage.setItem(key, value);
            else window.localStorage.removeItem(key);
          } catch {
            // stockage indisponible : le logo sera simplement vérifié à chaque session
          }
          return value;
        })
        .catch(() => known.get(key) ?? null);
      pending.set(key, p);
    }
    void p.then((value) => alive && setProvider(value));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load : fonction stable du module appelant
  }, [key]);
  return provider;
}
