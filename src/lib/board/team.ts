// Espace Team (module « trello », sql/2026-10-02_team_space.sql) : types et palette partagés
// entre les actions serveur (src/app/actions/team.ts) et l'écran (TeamScreen).

export type TeamColor = "red" | "navy" | "green" | "amber" | "steel" | "ink";

export const TEAM_COLORS: Record<TeamColor, { base: string; bg: string; label: string }> = {
  red: { base: "#E1141B", bg: "#FBDFE1", label: "Rouge" },
  navy: { base: "#12305F", bg: "#DEE7F6", label: "Bleu" },
  green: { base: "#2C7A5B", bg: "#DCF0E6", label: "Vert" },
  amber: { base: "#D98A0B", bg: "#FCEDD5", label: "Orange" },
  steel: { base: "#7C879C", bg: "#E3E9F4", label: "Gris" },
  ink: { base: "#0B1D3C", bg: "#DEE7F6", label: "Nuit" },
};
export const TEAM_COLOR_IDS = Object.keys(TEAM_COLORS) as TeamColor[];
export const isTeamColor = (c: unknown): c is TeamColor => typeof c === "string" && c in TEAM_COLORS;

export type TeamLabel = { name: string; color: TeamColor };

export type TeamPerson = {
  id: string;
  name: string;
  initials: string;
  email: string | null;
  avatarUrl: string | null;
  /** N+1 (profiles.expense_validator_id). */
  managerId: string | null;
};

export type TeamList = { id: string; boardId: string; title: string; isDone: boolean; position: number };

export type TeamBoard = { id: string; ownerId: string; title: string; position: number; lists: TeamList[] };

export type TeamCardMember = { userId: string; assignedBy: string | null; assignedAt: string; seenAt: string | null };

export type TeamChecklistItem = { id: string; content: string; done: boolean; position: number };

export type TeamCard = {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  description: string;
  color: TeamColor | null;
  labels: TeamLabel[];
  dueAt: string | null;
  event: { id: string; title: string; startDate: string } | null;
  position: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  members: TeamCardMember[];
  checklist: TeamChecklistItem[];
  commentCount: number;
};

export type TeamWorkspace = {
  meId: string;
  isAdmin: boolean;
  people: TeamPerson[];
  /** Tous les tableaux visibles : les miens, plus ceux qui portent une carte que je vois. */
  boards: TeamBoard[];
  cards: TeamCard[];
};

export type TeamComment = { id: string; userId: string; content: string; createdAt: string };

export const DEFAULT_LISTS: { title: string; isDone: boolean }[] = [
  { title: "À faire", isDone: false },
  { title: "En cours", isDone: false },
  { title: "Terminé", isDone: true },
];

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Une carte est « faite » quand sa colonne est une colonne terminée, ou qu'elle est archivée. */
export function isCardDone(card: TeamCard, listsById: Map<string, TeamList>) {
  return !!card.archivedAt || !!listsById.get(card.listId)?.isDone;
}

/** Échéance relative à aujourd'hui : texte court + ton (en retard, aujourd'hui, à venir). */
export function dueInfo(iso: string | null, done: boolean): { text: string; tone: "late" | "today" | "soon" | "normal" | "done" } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const text =
    diff === 0
      ? "aujourd'hui"
      : diff === -1
        ? "hier"
        : diff === 1
          ? "demain"
          : diff > 1 && diff < 7
            ? d.toLocaleDateString("fr-FR", { weekday: "long" })
            : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  if (done) return { text, tone: "done" };
  return { text, tone: diff < 0 ? "late" : diff === 0 ? "today" : diff <= 3 ? "soon" : "normal" };
}
