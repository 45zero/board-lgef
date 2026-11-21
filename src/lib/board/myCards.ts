import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { initialsOf, isMemberStatus, isTeamColor, type MemberStatus, type TeamColor, toReminderLevel, type ReminderLevel } from "@/lib/board/team";

// Cartes de l'Espace Team assignées à une personne et pas encore faites (ni archivées, ni dans une
// colonne « terminé ») : « Cartes à traiter » de l'accueil et « Mes cartes » du récapitulatif.

type Service = ReturnType<typeof createServiceClient>;

export type MyCard = {
  id: string;
  title: string;
  boardTitle: string;
  dueAt: string | null;
  eventId: string | null;
  /** Pas encore ouverte depuis son assignation. */
  isNew: boolean;
  /** Début de la description, texte brut (assez pour le contexte). */
  excerpt?: string | null;
  /** Checklist : éléments cochés / total (null sans checklist). */
  checklist?: { done: number; total: number } | null;
  color?: TeamColor | null;
  /** Je suis assigné à la carte (« À faire ») ; sinon je l'ai seulement créée (« Suivi »). */
  assigned?: boolean;
  /** J'ai créé la carte. */
  createdByMe?: boolean;
  /** Mon statut sur la carte (si je suis assigné) : rouge à faire, orange en cours, vert fait. */
  myStatus?: MemberStatus | null;
  /** Membres assignés (pastilles de l'accueil). */
  /** Membres assignés, plus le créateur s'il n'est pas assigné (sans statut) ; le créateur est signalé. */
  members?: { id: string; initials: string; name: string; avatarUrl: string | null; isMe?: boolean; isCreator?: boolean; status?: MemberStatus | null; reminderLevel?: ReminderLevel }[];
  /** Éléments de checklist où je suis identifié (« @Prénom Nom ») : texte, cochable depuis l'accueil. */
  myItems?: { id: string; content: string; done: boolean }[];
  /** Derniers messages de la discussion où je suis identifié (2 au plus, le plus récent d'abord). */
  mentions?: { id: string; author: string; content: string; createdAt: string }[];
};

const personName = (p: { first_name: string | null; last_name: string | null; email?: string | null } | undefined) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || p?.email || "";

/** Description (HTML, mentions, markdown léger) → début en texte brut. */
function excerptOf(description: string | null): string | null {
  if (!description) return null;
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

/**
 * Cartes où je suis assigné (« À faire » : j'y ai une tâche — une mention m'y assigne aussi). Avec
 * `includeCreated`, plus les cartes que j'ai créées sans y être assigné (« Suivi » de l'accueil : je vois
 * où en sont les autres, sans statut pour moi). Actions, mail de 7 h et récapitulatif : assignées seulement.
 */
export async function myOpenCards(service: Service, userId: string, opts: { includeCreated?: boolean } = {}): Promise<MyCard[]> {
  const [{ data: links }, { data: created }] = await Promise.all([
    service.from("team_card_members").select("card_id, seen_at, status").eq("user_id", userId),
    opts.includeCreated ? service.from("team_cards").select("id").eq("created_by", userId).is("archived_at", null) : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const seen = new Map((links ?? []).map((l) => [l.card_id, l.seen_at]));
  const ids = [...new Set([...seen.keys(), ...(created ?? []).map((c) => c.id)])];
  if (!ids.length) return [];
  const { data: cards } = await service
    .from("team_cards")
    .select("id, title, description, color, due_at, event_id, list_id, board_id, created_by")
    .in("id", ids)
    .is("archived_at", null);
  if (!cards?.length) return [];
  const cardIds = cards.map((c) => c.id);
  const [{ data: lists }, { data: boards }, { data: checks }, { data: members }, { data: comments }, { data: me }] = await Promise.all([
    service.from("team_lists").select("id, is_done").in("id", [...new Set(cards.map((c) => c.list_id))]),
    service.from("team_boards").select("id, title").in("id", [...new Set(cards.map((c) => c.board_id))]),
    service.from("team_checklist_items").select("id, card_id, content, done, position").in("card_id", cardIds).order("position"),
    service.from("team_card_members").select("card_id, user_id, status, assigned_at, reminder_level").in("card_id", cardIds).order("assigned_at"),
    service.from("team_card_comments").select("id, card_id, user_id, content, created_at").in("card_id", cardIds).order("created_at", { ascending: false }),
    service.from("profiles").select("first_name, last_name, email").eq("id", userId).maybeSingle(),
  ]);
  // Mentions : « @Prénom Nom » dans le texte, comme dans Espace Team (newMentions, actions/team.ts).
  const myName = personName(me ?? undefined);
  const tag = myName ? `@${myName}` : null;
  const people = new Map<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }>();
  const userIds = [
    ...new Set([...(members ?? []).map((m) => m.user_id), ...(comments ?? []).map((m) => m.user_id), ...cards.map((c) => c.created_by).filter((id): id is string => !!id)]),
  ];
  if (userIds.length) {
    const { data: profiles } = await service.from("profiles").select("id, first_name, last_name, avatar_url").in("id", userIds);
    for (const p of profiles ?? []) people.set(p.id, p);
  }
  const checklist = new Map<string, { done: number; total: number }>();
  const myItems = new Map<string, NonNullable<MyCard["myItems"]>>();
  for (const i of checks ?? []) {
    const c = checklist.get(i.card_id) ?? { done: 0, total: 0 };
    c.total += 1;
    if (i.done) c.done += 1;
    checklist.set(i.card_id, c);
    if (tag && i.content.includes(tag)) myItems.set(i.card_id, [...(myItems.get(i.card_id) ?? []), { id: i.id, content: i.content, done: i.done }]);
  }
  const mentions = new Map<string, NonNullable<MyCard["mentions"]>>();
  for (const m of comments ?? []) {
    if (!tag || m.user_id === userId || !m.content.includes(tag)) continue;
    const list = mentions.get(m.card_id) ?? [];
    if (list.length < 2) mentions.set(m.card_id, [...list, { id: m.id, author: personName(people.get(m.user_id)) || "Membre", content: m.content, createdAt: m.created_at }]);
  }
  const person = (id: string) => {
    const p = people.get(id);
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Membre";
    return { id, initials: initialsOf(name), name, avatarUrl: p?.avatar_url ?? null, isMe: id === userId };
  };
  const creatorOf = new Map(cards.map((c) => [c.id, c.created_by]));
  const membersOf = new Map<string, NonNullable<MyCard["members"]>>();
  for (const m of members ?? []) {
    membersOf.set(m.card_id, [
      ...(membersOf.get(m.card_id) ?? []),
      { ...person(m.user_id), isCreator: creatorOf.get(m.card_id) === m.user_id, status: isMemberStatus(m.status) ? m.status : "red", reminderLevel: toReminderLevel(m.reminder_level) },
    ]);
  }
  const done = new Set((lists ?? []).filter((l) => l.is_done).map((l) => l.id));
  const boardTitle = new Map((boards ?? []).map((b) => [b.id, b.title]));
  const myStatus = new Map((links ?? []).map((l) => [l.card_id, isMemberStatus(l.status) ? l.status : ("red" as MemberStatus)]));
  return cards
    .filter((c) => !done.has(c.list_id))
    .map((c) => {
      const list = membersOf.get(c.id) ?? [];
      // Créateur non assigné : sa pastille en tête (entourée), sans point de statut.
      const withCreator = c.created_by && !list.some((m) => m.id === c.created_by) ? [{ ...person(c.created_by), isCreator: true, status: null }, ...list] : list;
      const assigned = seen.has(c.id);
      return {
        id: c.id,
        title: c.title,
        boardTitle: boardTitle.get(c.board_id) ?? "",
        dueAt: c.due_at,
        eventId: c.event_id,
        isNew: assigned && !seen.get(c.id) && c.created_by !== userId,
        excerpt: excerptOf(c.description),
        checklist: checklist.get(c.id) ?? null,
        color: isTeamColor(c.color) ? c.color : null,
        assigned,
        createdByMe: c.created_by === userId,
        myStatus: assigned ? (myStatus.get(c.id) ?? "red") : null,
        members: withCreator,
        myItems: myItems.get(c.id) ?? [],
        mentions: mentions.get(c.id) ?? [],
      };
    })
    // Échéance la plus proche d'abord, sans échéance à la fin.
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}
