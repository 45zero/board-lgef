import type { MyCard } from "@/lib/board/myCards";
import { initialsOf, type TeamCard, type TeamPerson, type TeamWorkspace } from "@/lib/board/team";

// Cartes des tableaux de l'Espace Team au format de la tuile « mission » (MyCardTile), et réglage
// « Cartes sans mission » par liste : Espace Team et panneau Espace Team de l'accueil.

/** « Cartes sans mission » masquées ou non, par liste : affichage par défaut retenu sur cet appareil (clic droit). */
export const ONLY_MINE_PREFIX = "team:onlyMine:";
export function readOnlyMineDefaults(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  try {
    for (let k = 0; k < localStorage.length; k++) {
      const key = localStorage.key(k);
      if (key?.startsWith(ONLY_MINE_PREFIX)) out[key.slice(ONLY_MINE_PREFIX.length)] = localStorage.getItem(key) === "1";
    }
  } catch {
    /* stockage indisponible */
  }
  return out;
}

export function saveOnlyMineDefault(listId: string, hide: boolean) {
  try {
    localStorage.setItem(ONLY_MINE_PREFIX + listId, hide ? "1" : "0");
  } catch {
    /* stockage indisponible : vaut pour cette visite */
  }
}

/** Texte brut du début de la description (comme l'accueil : HTML et markdown léger retirés). */
function excerptOf(description: string): string | null {
  const text = description
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}

/** Carte d'un tableau → format de l'accueil (MyCardTile) : mêmes pastilles, statut et relances. */
export function toMyCard(c: TeamCard, ws: TeamWorkspace, peopleById: Map<string, TeamPerson>, boardTitle: string): MyCard {
  const mine = c.members.find((m) => m.userId === ws.meId);
  const myName = peopleById.get(ws.meId)?.name;
  const tag = myName ? `@${myName}` : null;
  const person = (id: string) => {
    const p = peopleById.get(id);
    const name = p?.name || "Membre";
    return {
      id,
      initials: p?.initials || initialsOf(name),
      name,
      avatarUrl: p?.avatarUrl ?? null,
      isMe: id === ws.meId,
    };
  };
  const members: NonNullable<MyCard["members"]> = c.members.map((m) => ({
    ...person(m.userId),
    isCreator: m.userId === c.createdBy,
    status: m.status,
    reminderLevel: m.reminderLevel,
  }));
  // Créateur non assigné : sa pastille en tête (entourée d'or), sans statut.
  if (c.createdBy && !c.members.some((m) => m.userId === c.createdBy))
    members.unshift({
      ...person(c.createdBy),
      isCreator: true,
      status: null,
      reminderLevel: 0,
    });
  const total = c.checklist.length;
  return {
    id: c.id,
    title: c.title,
    boardTitle,
    dueAt: c.dueAt,
    eventId: c.event?.id ?? null,
    isNew: !!mine && !mine.seenAt && mine.assignedBy !== ws.meId,
    excerpt: excerptOf(c.description),
    checklist: total ? { done: c.checklist.filter((i) => i.done).length, total } : null,
    color: c.color,
    assigned: !!mine,
    createdByMe: c.createdBy === ws.meId,
    myStatus: mine?.status ?? null,
    members,
    myItems: tag ? c.checklist.filter((i) => i.content.includes(tag)).map((i) => ({ id: i.id, content: i.content, done: i.done })) : [],
    mentions: [],
  };
}
