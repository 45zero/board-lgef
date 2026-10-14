"use client";

import { useEffect, useRef } from "react";
import { useGoogleMapsScript } from "@/hooks/useGoogleMapsScript";

/**
 * Champ d'adresse avec suggestions Google Maps (lieux nommés compris : « Stade municipal », salles…).
 * Le choix d'une suggestion remplit « Nom, adresse » ; la saisie libre reste possible.
 */
export function PlaceInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const loaded = useGoogleMapsScript();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!loaded || !ref.current) return;
    const ac = new google.maps.places.Autocomplete(ref.current, {
      fields: ["formatted_address", "name"],
      componentRestrictions: { country: "fr" },
    });
    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const address = place.formatted_address ?? "";
      // Lieu nommé (stade, gymnase…) : son nom devant l'adresse, sauf s'il y figure déjà.
      const label = place.name && address && !address.startsWith(place.name) ? `${place.name}, ${address}` : address || place.name || "";
      if (label) onChangeRef.current(label);
    });
    return () => listener.remove();
  }, [loaded]);

  return <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={className} />;
}
