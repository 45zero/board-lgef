"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    google?: typeof google;
  }
}

let loadPromise: Promise<void> | null = null;

function loadGoogleMapsScript(): Promise<void> {
  if (window.google?.maps?.places) return Promise.resolve();
  if (loadPromise) return loadPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY manquante"));

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=fr&region=FR`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Échec du chargement de Google Maps"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/** Charge l'API Google Maps (places) une seule fois, partagée entre tous les composants qui l'utilisent. */
export function useGoogleMapsScript() {
  const [loaded, setLoaded] = useState(
    () => typeof window !== "undefined" && !!window.google?.maps?.places
  );

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    loadGoogleMapsScript()
      .then(() => {
        if (!cancelled) setLoaded(true);
      })
      .catch((e) => console.warn("[useGoogleMapsScript]", e));
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  return loaded;
}
