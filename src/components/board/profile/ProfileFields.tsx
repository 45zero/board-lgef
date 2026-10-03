"use client";

import { useEffect, useRef } from "react";
import { Cake, Car, ExternalLink, Home, MapPin } from "lucide-react";
import { useGoogleMapsScript } from "@/hooks/useGoogleMapsScript";
import { Toggle } from "@/components/board/Toggle";
import type { LatLng } from "@/lib/board/geo";
import { mapsSearchUrl, normalizePlate, type ProfileDetails } from "@/lib/board/profile";

// Adresse et véhicule d'une fiche (Mon profil, Paramètres → Utilisateurs) : mêmes informations que
// les « Préférences » de l'ancien calendrier, avec l'adresse reliée à Google Maps.

const input = "w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm outline-none focus:border-navy";
const sectionTitle = "mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-4";

/** Adresse avec suggestions Google ; une adresse tapée sans suggestion est gardée (position recherchée à l'enregistrement). */
function AddressInput({ value, onChange }: { value: string; onChange: (address: string, coordinates: LatLng | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapsLoaded = useGoogleMapsScript();
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  });

  // PlaceAutocompleteElement : l'ancien places.Autocomplete n'est plus servi aux nouveaux projets Google Cloud.
  useEffect(() => {
    const container = containerRef.current;
    if (!mapsLoaded || !container) return;
    const el = new google.maps.places.PlaceAutocompleteElement({ includedRegionCodes: ["fr"] });
    el.placeholder = "Numéro, rue, commune…";
    el.value = valueRef.current;
    el.style.width = "100%";
    el.style.colorScheme = "light";
    const onSelect = async (e: google.maps.places.PlacePredictionSelectEvent) => {
      const place = e.placePrediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location"] });
      const address = place.formattedAddress ?? el.value;
      el.value = address;
      onChangeRef.current(address, place.location ? { lat: place.location.lat(), lng: place.location.lng() } : null);
    };
    const onFocusOut = () => {
      if (el.value !== valueRef.current) onChangeRef.current(el.value, null);
    };
    el.addEventListener("gmp-select", onSelect as unknown as EventListener);
    el.addEventListener("focusout", onFocusOut);
    container.replaceChildren(el);
    return () => {
      el.removeEventListener("gmp-select", onSelect as unknown as EventListener);
      el.removeEventListener("focusout", onFocusOut);
      el.remove();
    };
  }, [mapsLoaded]);

  if (!mapsLoaded) return <input value={value} onChange={(e) => onChange(e.target.value, null)} placeholder="Numéro, rue, commune…" className={input} />;
  return <div ref={containerRef} />;
}

export function ProfileDetailsFields({
  value,
  onChange,
  self,
}: {
  value: ProfileDetails;
  onChange: (next: ProfileDetails) => void;
  /** Formulation à la première personne (Mon profil) ou pour un tiers (administration). */
  self: boolean;
}) {
  const address = value.homeAddress.trim();
  const mapQuery = value.homeCoordinates ? `${value.homeCoordinates.lat},${value.homeCoordinates.lng}` : address;

  return (
    <div className="space-y-5">
      <div>
        <div className={sectionTitle}>
          <Cake size={12} /> Date de naissance
        </div>
        <input
          type="date"
          value={value.birthDate ?? ""}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => onChange({ ...value, birthDate: e.target.value || null })}
          className={`${input} max-w-[220px]`}
        />
        <p className="mt-1 text-[11px] text-ink-4">
          Le jour J, toute l&apos;équipe est prévenue et {self ? "votre" : "son"} bandeau d&apos;accueil est à la fête. Seuls le jour et le mois
          sont visibles, jamais l&apos;année.
        </p>
      </div>

      <div>
        <div className={sectionTitle}>
          <Home size={12} /> Adresse personnelle
        </div>
        <AddressInput value={value.homeAddress} onChange={(homeAddress, homeCoordinates) => onChange({ ...value, homeAddress, homeCoordinates })} />
        {!address ? (
          <p className="mt-1 text-[11px] font-semibold text-bad">
            {self ? "Renseignez votre adresse" : "Adresse manquante"} : les trajets et les kilomètres ne peuvent pas être calculés.
          </p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              {value.homeCoordinates ? (
                <span className="flex items-center gap-1 text-good">
                  <MapPin size={11} /> Position trouvée — utilisée pour les trajets et les km
                </span>
              ) : (
                <span className="text-ink-4">Position recherchée sur Google Maps à l&apos;enregistrement</span>
              )}
              <a href={mapsSearchUrl(address)} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-link hover:underline">
                Ouvrir dans Google Maps <ExternalLink size={10} />
              </a>
            </div>
            <iframe
              title="Carte de l'adresse"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=14&output=embed`}
              className="mt-2 h-32 w-full rounded-btn border border-line"
              loading="lazy"
            />
          </>
        )}
      </div>

      <div>
        <div className={sectionTitle}>
          <Car size={12} /> Véhicule
        </div>
        <div className="space-y-3 rounded-btn border border-line p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-2">Véhicule de service</div>
              <div className="text-xs text-ink-4">
                {value.hasCompanyCar ? "Véhicule de la Ligue : pas d'indemnités kilométriques" : "Véhicule personnel : km remboursés à 0,45 €/km (réseau)"}
              </div>
            </div>
            <Toggle on={value.hasCompanyCar} onClick={() => onChange({ ...value, hasCompanyCar: !value.hasCompanyCar })} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-ink-3">
              Immatriculation {value.hasCompanyCar ? "du véhicule de service" : "du véhicule personnel"}
            </div>
            <input
              value={value.licensePlate}
              onChange={(e) => onChange({ ...value, licensePlate: e.target.value.toUpperCase() })}
              onBlur={() => onChange({ ...value, licensePlate: normalizePlate(value.licensePlate) })}
              placeholder="AB-123-CD"
              className={`${input} font-mono uppercase`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
