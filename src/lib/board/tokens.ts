export type OrgKey =
  | "navy"
  | "clubs"
  | "pem"
  | "technique"
  | "steel"
  | "red"
  | "teal"
  | "amber"
  | "tirages"
  | "matchs"
  | "perso";

export const ORG_LABELS: Record<OrgKey, string> = {
  navy: "Institutionnel",
  clubs: "Clubs",
  pem: "PEM Pôle Espoirs Mixte",
  technique: "Technique",
  steel: "Arbitrage",
  red: "Compétitions",
  teal: "Formation",
  amber: "Communication",
  tirages: "Tirages Coupes",
  matchs: "Matchs du week-end",
  perso: "Perso",
};

export const ORG_COLORS: Record<OrgKey, { base: string; bg: string; ink: string }> = {
  navy: { base: "#12305F", bg: "#DEE7F6", ink: "#0E2A55" },
  clubs: { base: "#C2571A", bg: "#FBE6D6", ink: "#8A3B0C" },
  pem: { base: "#2F52B0", bg: "#E2E8FA", ink: "#22397C" },
  technique: { base: "#1F7A4D", bg: "#DBF0E4", ink: "#145A38" },
  steel: { base: "#2C4A78", bg: "#DEE7F6", ink: "#1F3A61" },
  red: { base: "#E1141B", bg: "#FBDFE1", ink: "#A50E15" },
  teal: { base: "#2C7A6B", bg: "#DCF0E9", ink: "#14574A" },
  amber: { base: "#D98A0B", bg: "#FCEDD5", ink: "#7A4E06" },
  tirages: { base: "#9A6B00", bg: "#FAEFD0", ink: "#6B4A00" },
  matchs: { base: "#5B3FA8", bg: "#EBE4FA", ink: "#422D7C" },
  perso: { base: "#7A3FD9", bg: "#EAE2FA", ink: "#4A2585" },
};

export type CoverageState = "photo" | "video" | "both" | "wait" | "no";

export const COVERAGE_LABELS: Record<CoverageState, { long: string; short: string }> = {
  photo: { long: "Photo confirmée", short: "Photo" },
  video: { long: "Vidéo confirmée", short: "Vidéo" },
  both: { long: "Photo + vidéo", short: "Photo + vidéo" },
  wait: { long: "En attente de couverture", short: "En attente" },
  no: { long: "Couverture refusée", short: "Refusée" },
};

export const COVERAGE_COLORS: Record<CoverageState, { ink: string; bg: string }> = {
  photo: { ink: "#125F41", bg: "#DCF0E6" },
  video: { ink: "#125F41", bg: "#DCF0E6" },
  both: { ink: "#125F41", bg: "#DCF0E6" },
  wait: { ink: "#7A4E06", bg: "#FCEDD5" },
  no: { ink: "#A50E15", bg: "#FBDFE1" },
};

export interface BoardApp {
  id: string;
  label: string;
  kicker: string;
}

export const BOARD_APPS: BoardApp[] = [
  { id: "accueil", label: "Accueil", kicker: "ESPACE DE TRAVAIL" },
  { id: "mails", label: "Mails", kicker: "MESSAGERIE" },
  { id: "trello", label: "Trello", kicker: "TABLEAUX" },
  { id: "planning", label: "Planning", kicker: "POLES" },
  { id: "calendrier", label: "Calendrier", kicker: "EVENEMENTS" },
  { id: "quiz", label: "Quiz", kicker: "SESSIONS EN DIRECT" },
  { id: "pointage", label: "Pointage", kicker: "TEMPS DE TRAVAIL" },
  { id: "formations", label: "Formations", kicker: "PARCOURS" },
  { id: "arbitrage", label: "Arbitrage", kicker: "DESIGNATIONS" },
  { id: "ged", label: "GED", kicker: "DOCUMENTS" },
  { id: "drive", label: "Drive", kicker: "ARCHIVAGE AUTO" },
  { id: "inscription", label: "Inscription", kicker: "RSVP CLUBS" },
  { id: "compta", label: "Compta", kicker: "FACTURATION" },
  { id: "audiovisuel", label: "Audiovisuel", kicker: "COUVERTURE MEDIA" },
  { id: "communication", label: "Communication", kicker: "PLAN DE COM" },
  { id: "administration", label: "Administration", kicker: "COMPTES & ACCES" },
];
