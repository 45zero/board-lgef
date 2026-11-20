/** Fiche profil : types et règles partagés client/serveur (Mon profil, Paramètres → Utilisateurs). */

import type { LatLng } from "@/lib/board/geo";

/**
 * Coordonnées et véhicule (mêmes colonnes que l'ancien calendrier : home_address, home_coordinates,
 * has_company_car, license_plate). L'adresse sert aux trajets domicile → événement et aux km du réseau ;
 * avec un véhicule de service, aucune indemnité kilométrique n'est due.
 */
export interface ProfileDetails {
  homeAddress: string;
  /** Position de l'adresse ; null : adresse introuvable par Google (les km ne peuvent pas être calculés). */
  homeCoordinates: LatLng | null;
  hasCompanyCar: boolean;
  licensePlate: string;
  /** « yyyy-MM-dd » ; l'équipe ne voit que le jour et le mois (anniversaire). */
  birthDate: string | null;
  /** Adresse privée : domicile montré seulement à la personne et à son N+1 (carte, administration). */
  addressPrivate: boolean;
  /** Adresse masquée pour la personne qui consulte (privée, et ni la personne ni son N+1). */
  addressHidden?: boolean;
}

export const pickDetails = ({ homeAddress, homeCoordinates, hasCompanyCar, licensePlate, birthDate, addressPrivate, addressHidden }: ProfileDetails): ProfileDetails => ({
  homeAddress,
  homeCoordinates,
  hasCompanyCar,
  licensePlate,
  birthDate,
  addressPrivate,
  addressHidden,
});

export interface MyProfile extends ProfileDetails {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  /** Statut (Salarié, Réseau…) et N+1 : affichés, réglés par un administrateur. */
  status: string | null;
  managerName: string | null;
  /**
   * À compléter (fenêtre au lancement, Mon profil) : `needsManager` — salarié (organisateur ou
   * coordination médias) sans N+1 ; `needsAddress` — droit aux indemnités kilométriques sans adresse.
   */
  needsManager?: boolean;
  needsAddress?: boolean;
}

export type ProfileInput = { firstName: string; lastName: string } & Omit<ProfileDetails, "homeCoordinates" | "addressHidden"> & {
    /** Position choisie dans les suggestions Google ; absente : l'adresse est géocodée à l'enregistrement. */
    homeCoordinates?: LatLng | null;
  };

/** Plaque au format SIV (AB-123-CD) quand elle s'y prête ; sinon en majuscules, telle que saisie. */
export function normalizePlate(raw: string) {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const siv = compact.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/);
  return siv ? `${siv[1]}-${siv[2]}-${siv[3]}` : raw.trim().toUpperCase();
}

export const mapsSearchUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** Prévient l'en-tête (avatar, nom) qu'une fiche a changé. */
export const PROFILE_UPDATED_EVENT = "lgef:profile-updated";
