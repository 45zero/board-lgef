/** Carte du Grand Est : types partagés client/serveur (positions des événements et des techniciens, trajets). */

export type LatLng = { lat: number; lng: number };

/** Statut technique d'un utilisateur, d'après ses spécialités (tech-salarie / tech-prestataire / tech-benevole). */
export type StaffKind = "salarie" | "prestataire" | "benevole";

export const STAFF_SPECIALTY: Record<string, StaffKind> = {
  "tech-salarie": "salarie",
  "tech-prestataire": "prestataire",
  "tech-benevole": "benevole",
};

export const STAFF_KINDS: StaffKind[] = ["salarie", "prestataire", "benevole"];

export const STAFF_STYLES: Record<StaffKind, { label: string; letter: string; color: string }> = {
  salarie: { label: "Technicien salarié", letter: "S", color: "#111827" },
  prestataire: { label: "Technicien prestataire", letter: "P", color: "#DB2777" },
  benevole: { label: "Bénévole", letter: "B", color: "#0891B2" },
};

export type StaffPin = { id: string; name: string; kind: StaffKind; position: LatLng };

/** Trajet domicile → événement (aller simple, en voiture). */
export type Travel = { km: number; minutes: number };

/** Emprise de la région Grand Est (cadrage initial de la carte). */
export const GRAND_EST_BOUNDS = { south: 47.42, west: 3.38, north: 50.17, east: 8.24 };

/** Coordonnées stockées en base (`{lat, lng}`, parfois sérialisées en texte par l'ancien calendrier). */
export function parseLatLng(raw: unknown): LatLng | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const { lat, lng } = v as { lat?: unknown; lng?: unknown };
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && (la !== 0 || ln !== 0) ? { lat: la, lng: ln } : null;
}

export function formatTravel(t: Travel) {
  const h = Math.floor(t.minutes / 60);
  const m = Math.round(t.minutes % 60);
  const time = h > 0 ? `${h} h ${m.toString().padStart(2, "0")}` : `${m} min`;
  return `${Math.round(t.km)} km · ${time}`;
}
