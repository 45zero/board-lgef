// Demandes de compte : profils proposés dans le formulaire public (/demande-acces) et réglages
// suggérés à l'acceptation. Partagé par le formulaire, la carte de validation et l'action serveur.

export type AccessKind =
  | "salarie"
  | "benevole"
  | "elu"
  | "arbitre"
  | "educateur"
  | "club"
  | "photographe"
  | "videaste"
  | "partenaire"
  | "media"
  | "autre";

export type AccessStatus = "salarie" | "reseau" | "prestataire" | "benevole";
/** Rôles qu'un N+1 peut donner ; administrateurs : aussi Comité directeur. */
export type GrantableRole = "user" | "technician" | "organizer" | "comite_directeur";

export const ACCESS_KINDS: { id: AccessKind; label: string }[] = [
  { id: "salarie", label: "Salarié de la Ligue" },
  { id: "benevole", label: "Bénévole" },
  { id: "elu", label: "Élu / membre de commission" },
  { id: "arbitre", label: "Arbitre" },
  { id: "educateur", label: "Éducateur / formateur" },
  { id: "club", label: "Dirigeant de club" },
  { id: "photographe", label: "Photographe" },
  { id: "videaste", label: "Vidéaste" },
  { id: "partenaire", label: "Partenaire" },
  { id: "media", label: "Média" },
  { id: "autre", label: "Autre" },
];

export const ACCESS_KIND_IDS = ACCESS_KINDS.map((k) => k.id) as [AccessKind, ...AccessKind[]];

const LABEL: Record<string, string> = Object.fromEntries(ACCESS_KINDS.map((k) => [k.id, k.label]));
// Anciennes demandes (calendrier-lgef) : technician, organizer, comité_directeur, user.
const LEGACY: Record<string, string> = { technician: "Technicien", organizer: "Organisateur", comité_directeur: "Comité directeur", user: "Utilisateur" };
export const accessKindLabel = (kind: string | null) => (kind ? (LABEL[kind] ?? LEGACY[kind] ?? kind) : "—");

export const STATUS_LABELS: Record<AccessStatus, string> = {
  salarie: "Salarié — personnel de la Ligue",
  reseau: "Réseau — remboursement de frais",
  prestataire: "Prestataire — sur facture",
  benevole: "Bénévole — ni frais ni facture",
};
export const STATUS_SLUG: Record<AccessStatus, string> = { salarie: "tech-salarie", reseau: "tech-reseau", prestataire: "tech-prestataire", benevole: "tech-benevole" };

export const ROLE_LABELS: Record<GrantableRole, string> = {
  user: "Utilisateur",
  technician: "Technicien",
  organizer: "Organisateur",
  comite_directeur: "Comité directeur",
};

/** Réglages proposés d'après « Vous êtes » — tout reste modifiable avant d'accepter. */
export function suggestionFor(kind: string | null): { role: GrantableRole; status: AccessStatus | null; photo: boolean; video: boolean } {
  switch (kind) {
    case "salarie":
      return { role: "technician", status: "salarie", photo: false, video: false };
    case "benevole":
      return { role: "technician", status: "benevole", photo: false, video: false };
    case "elu":
      return { role: "comite_directeur", status: null, photo: false, video: false };
    case "photographe":
      return { role: "technician", status: "reseau", photo: true, video: false };
    case "videaste":
      return { role: "technician", status: "reseau", photo: false, video: true };
    case "arbitre":
    case "educateur":
      return { role: "technician", status: null, photo: false, video: false };
    default:
      return { role: "user", status: null, photo: false, video: false };
  }
}
