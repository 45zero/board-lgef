import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import type { Json } from "@/lib/supabase/database.types";
import { parseLatLng } from "@/lib/board/geo";
import { geocode } from "@/lib/board/travel";
import { normalizePlate, type ProfileDetails, type ProfileInput } from "@/lib/board/profile";

// Enregistrement d'une fiche (Mon profil ou Paramètres → Utilisateurs). Seuls ces champs sont écrits :
// jamais le rôle, le N+1 ni les accès, qui restent réservés aux administrateurs (users-admin.ts).

type Service = ReturnType<typeof createServiceClient>;

export const DETAILS_COLUMNS = "home_address, home_coordinates, has_company_car, license_plate, birth_date";

export function detailsFromRow(p: {
  home_address: string | null;
  home_coordinates: unknown;
  has_company_car: boolean | null;
  license_plate: string | null;
  birth_date: string | null;
}): ProfileDetails {
  return {
    homeAddress: p.home_address ?? "",
    homeCoordinates: parseLatLng(p.home_coordinates),
    hasCompanyCar: !!p.has_company_car,
    licensePlate: p.license_plate ?? "",
    birthDate: p.birth_date,
  };
}

export async function saveProfile(service: Service, id: string, input: ProfileInput) {
  const { data: current, error: readError } = await service.from("profiles").select("home_address, home_coordinates").eq("id", id).single();
  if (readError || !current) throw new Error("Compte introuvable.");

  const address = input.homeAddress.trim();
  // Position : celle de la suggestion Google choisie ; sinon on garde l'actuelle si l'adresse n'a pas
  // changé ; sinon on géocode (null si Google ne trouve pas : l'adresse est gardée, signalée à l'écran).
  let coordinates = parseLatLng(input.homeCoordinates);
  if (!coordinates && address) {
    coordinates = address === (current.home_address ?? "").trim() ? parseLatLng(current.home_coordinates) : null;
    coordinates ??= await geocode(address);
  }

  const plate = normalizePlate(input.licensePlate);
  const birthDate = input.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) ? input.birthDate : null;
  if (birthDate && (birthDate < "1900-01-01" || birthDate > new Date().toISOString().slice(0, 10))) throw new Error("Date de naissance invalide.");
  const { error } = await service
    .from("profiles")
    .update({
      first_name: input.firstName.trim() || null,
      last_name: input.lastName.trim() || null,
      home_address: address || null,
      home_coordinates: address && coordinates ? (coordinates as unknown as Json) : null,
      has_company_car: input.hasCompanyCar,
      license_plate: plate || null,
      birth_date: birthDate,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
