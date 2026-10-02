"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import type { Json } from "@/lib/supabase/database.types";
import { syncCardFolder } from "@/lib/board/teamDrive";
import {
  DEFAULT_LISTS,
  initialsOf,
  isTeamColor,
  type TeamBoard,
  type TeamCard,
  type TeamColor,
  type TeamComment,
  type TeamLabel,
  type TeamPerson,
  type TeamWorkspace,
} from "@/lib/board/team";

// Espace Team (sql/2026-10-02_team_space.sql). Toutes les lectures et écritures passent par le
// client de session : la RLS décide de ce que chacun voit (ses tableaux, les cartes qui lui sont
// assignées, celles de ses équipiers s'il est leur N+1, tout pour un administrateur). Seul
// l'annuaire des personnes (noms) est lu avec le client de service.

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return { supabase, userId };
}

/** Données d'une réponse Supabase, ou l'erreur levée (sans erreur, PostgREST renvoie toujours des données). */
const check = <R extends { data: unknown; error: { message: string } | null }>(res: R): NonNullable<R["data"]> => {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<R["data"]>;
};

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "Sans nom";

const toLabels = (raw: Json): TeamLabel[] =>
  Array.isArray(raw)
    ? raw.flatMap((l) =>
        l && typeof l === "object" && !Array.isArray(l) && typeof l.name === "string" && isTeamColor(l.color)
          ? [{ name: l.name, color: l.color }]
          : []
      )
    : [];

/* ---------- Lecture ---------- */

async function createDefaultBoard(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, title: string, position = 0) {
  const board = check(await supabase.from("team_boards").insert({ owner_id: userId, title, position }).select("id").single());
  check(
    await supabase
      .from("team_lists")
      .insert(DEFAULT_LISTS.map((l, i) => ({ board_id: board.id, title: l.title, is_done: l.isDone, position: i })))
  );
  return board.id;
}

async function getTeamWorkspaceImpl(): Promise<TeamWorkspace> {
  const { supabase, userId } = await session();
  const service = createServiceClient();

  const [{ data: me }, { data: profiles }] = await Promise.all([
    service.from("profiles").select("role").eq("id", userId).single(),
    service.from("profiles").select("id, first_name, last_name, email, avatar_url, expense_validator_id").order("first_name"),
  ]);
  const people: TeamPerson[] = (profiles ?? []).map((p) => {
    const name = personName(p);
    return { id: p.id, name, initials: initialsOf(name), email: p.email, avatarUrl: p.avatar_url, managerId: p.expense_validator_id };
  });

  // Premier passage : un espace personnel prêt à l'emploi.
  const { count } = await supabase.from("team_boards").select("id", { count: "exact", head: true }).eq("owner_id", userId);
  if (!count) await createDefaultBoard(supabase, userId, "Mon espace");

  const [boardRows, listRows, cardRows] = await Promise.all([
    supabase.from("team_boards").select("id, owner_id, title, position").order("position").order("created_at").then(check),
    supabase.from("team_lists").select("id, board_id, title, is_done, position").order("position").then(check),
    supabase
      .from("team_cards")
      .select("id, board_id, list_id, title, description, color, labels, due_at, event_id, position, created_by, created_at, updated_at, archived_at")
      .order("position")
      .then(check),
  ]);
  const cardIds = cardRows.map((c) => c.id);
  const eventIds = [...new Set(cardRows.map((c) => c.event_id).filter((id): id is string => !!id))];

  const [memberRows, checklistRows, commentRows, eventRows] = await Promise.all([
    cardIds.length
      ? supabase.from("team_card_members").select("card_id, user_id, assigned_by, assigned_at, seen_at").in("card_id", cardIds).then(check)
      : [],
    cardIds.length
      ? supabase.from("team_checklist_items").select("id, card_id, content, done, position").in("card_id", cardIds).order("position").then(check)
      : [],
    cardIds.length ? supabase.from("team_card_comments").select("card_id").in("card_id", cardIds).then(check) : [],
    eventIds.length ? service.from("events").select("id, title, start_date").in("id", eventIds).then(check) : [],
  ]);

  const boards: TeamBoard[] = boardRows.map((b) => ({
    id: b.id,
    ownerId: b.owner_id,
    title: b.title,
    position: b.position,
    lists: listRows
      .filter((l) => l.board_id === b.id)
      .map((l) => ({ id: l.id, boardId: l.board_id, title: l.title, isDone: l.is_done, position: l.position })),
  }));
  const events = new Map(eventRows.map((e) => [e.id, { id: e.id, title: e.title, startDate: e.start_date }]));
  const commentCounts = new Map<string, number>();
  for (const c of commentRows) commentCounts.set(c.card_id, (commentCounts.get(c.card_id) ?? 0) + 1);

  const cards: TeamCard[] = cardRows.map((c) => ({
    id: c.id,
    boardId: c.board_id,
    listId: c.list_id,
    title: c.title,
    description: c.description,
    color: isTeamColor(c.color) ? c.color : null,
    labels: toLabels(c.labels),
    dueAt: c.due_at,
    event: c.event_id ? (events.get(c.event_id) ?? null) : null,
    position: c.position,
    createdBy: c.created_by,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    archivedAt: c.archived_at,
    members: memberRows
      .filter((m) => m.card_id === c.id)
      .map((m) => ({ userId: m.user_id, assignedBy: m.assigned_by, assignedAt: m.assigned_at, seenAt: m.seen_at })),
    checklist: checklistRows
      .filter((i) => i.card_id === c.id)
      .map((i) => ({ id: i.id, content: i.content, done: i.done, position: i.position })),
    commentCount: commentCounts.get(c.id) ?? 0,
  }));

  return { meId: userId, isAdmin: me?.role === "admin" || me?.role === "super_user", people, boards, cards };
}

export const getTeamWorkspace = async () => toResult(getTeamWorkspaceImpl);

/* ---------- Tableaux et colonnes ---------- */

export const createTeamBoard = async (title: string) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    const { count } = await supabase.from("team_boards").select("id", { count: "exact", head: true }).eq("owner_id", userId);
    return createDefaultBoard(supabase, userId, title.trim(), count ?? 0);
  });

export const renameTeamBoard = async (boardId: string, title: string) =>
  toResult(async () => {
    const { supabase } = await session();
    check(await supabase.from("team_boards").update({ title: title.trim() }).eq("id", boardId));
  });

export const deleteTeamBoard = async (boardId: string) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    const { count } = await supabase.from("team_boards").select("id", { count: "exact", head: true }).eq("owner_id", userId);
    if ((count ?? 0) <= 1) throw new Error("Gardez au moins un tableau.");
    check(await supabase.from("team_boards").delete().eq("id", boardId).eq("owner_id", userId));
  });

export const createTeamList = async (boardId: string, title: string) =>
  toResult(async () => {
    const { supabase } = await session();
    const { count } = await supabase.from("team_lists").select("id", { count: "exact", head: true }).eq("board_id", boardId);
    check(await supabase.from("team_lists").insert({ board_id: boardId, title: title.trim(), position: count ?? 0 }));
  });

export const updateTeamList = async (listId: string, patch: { title?: string; isDone?: boolean }) =>
  toResult(async () => {
    const { supabase } = await session();
    check(
      await supabase
        .from("team_lists")
        .update({ ...(patch.title !== undefined && { title: patch.title.trim() }), ...(patch.isDone !== undefined && { is_done: patch.isDone }) })
        .eq("id", listId)
    );
  });

export const deleteTeamList = async (listId: string) =>
  toResult(async () => {
    const { supabase } = await session();
    const { count } = await supabase.from("team_cards").select("id", { count: "exact", head: true }).eq("list_id", listId).is("archived_at", null);
    if (count) throw new Error("Videz d'abord la colonne (déplacez ou archivez ses cartes).");
    check(await supabase.from("team_lists").delete().eq("id", listId));
  });

/** Nouvel ordre des colonnes d'un tableau. */
export const reorderTeamLists = async (listIds: string[]) =>
  toResult(async () => {
    const { supabase } = await session();
    await Promise.all(listIds.map((id, i) => supabase.from("team_lists").update({ position: i }).eq("id", id).then(check)));
  });

/* ---------- Cartes ---------- */

export const createTeamCard = async (input: { boardId: string; listId: string; title: string; position: number; memberIds?: string[] }) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    // Id choisi ici : la RLS de lecture ne voit pas encore la ligne insérée, un « insert … select » serait refusé.
    const card = { id: crypto.randomUUID() };
    check(
      await supabase
        .from("team_cards")
        .insert({ id: card.id, board_id: input.boardId, list_id: input.listId, title: input.title.trim(), position: input.position, created_by: userId })
    );
    if (input.memberIds?.length) {
      check(
        await supabase
          .from("team_card_members")
          .insert(input.memberIds.map((id) => ({ card_id: card.id, user_id: id, assigned_by: userId, ...(id === userId && { seen_at: new Date().toISOString() }) })))
      );
    }
    return card.id;
  });

export type TeamCardPatch = {
  title?: string;
  description?: string;
  color?: TeamColor | null;
  labels?: TeamLabel[];
  dueAt?: string | null;
  eventId?: string | null;
  archived?: boolean;
};

export const updateTeamCard = async (cardId: string, patch: TeamCardPatch) =>
  toResult(async () => {
    const { supabase } = await session();
    check(
      await supabase
        .from("team_cards")
        .update({
          ...(patch.title !== undefined && { title: patch.title.trim() }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.color !== undefined && { color: patch.color }),
          ...(patch.labels !== undefined && { labels: patch.labels as unknown as Json }),
          ...(patch.dueAt !== undefined && { due_at: patch.dueAt }),
          ...(patch.eventId !== undefined && { event_id: patch.eventId }),
          ...(patch.archived !== undefined && { archived_at: patch.archived ? new Date().toISOString() : null }),
        })
        .eq("id", cardId)
    );
    // Titre ou événement changé : le dossier des pièces jointes suit (s'il existe).
    if (patch.title !== undefined || patch.eventId !== undefined) {
      const card = check(await supabase.from("team_cards").select("id, title, created_at, event_id").eq("id", cardId).single());
      const event = card.event_id ? (await createServiceClient().from("events").select("title, start_date").eq("id", card.event_id).maybeSingle()).data : null;
      await syncCardFolder({ id: card.id, title: card.title, createdAt: card.created_at, event: event ? { title: event.title, startDate: event.start_date } : null });
    }
  });

/** Déplace une carte (colonne et/ou rang) — aussi permis à ses assignés. */
export const moveTeamCard = async (cardId: string, listId: string, position: number) =>
  toResult(async () => {
    const { supabase } = await session();
    check(await supabase.from("team_cards").update({ list_id: listId, position }).eq("id", cardId));
  });

/** Copie une carte (titre, description, couleur, étiquettes, échéance, checklist) dans la même colonne. */
export const copyTeamCard = async (cardId: string) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    const src = check(await supabase.from("team_cards").select("*").eq("id", cardId).single());
    const { data: own } = await supabase.from("team_boards").select("id").eq("id", src.board_id).eq("owner_id", userId).maybeSingle();
    if (!own) throw new Error("Seul le propriétaire du tableau peut copier cette carte.");
    const copy = { id: crypto.randomUUID() };
    check(
      await supabase
        .from("team_cards")
        .insert({
          id: copy.id,
          board_id: src.board_id,
          list_id: src.list_id,
          title: `${src.title} (copie)`.slice(0, 200),
          description: src.description,
          color: src.color,
          labels: src.labels,
          due_at: src.due_at,
          position: src.position + 0.5,
          created_by: userId,
        })
    );
    const items = check(await supabase.from("team_checklist_items").select("content, position").eq("card_id", cardId));
    if (items.length) check(await supabase.from("team_checklist_items").insert(items.map((i) => ({ ...i, card_id: copy.id }))));
    return copy.id;
  });

export const deleteTeamCard = async (cardId: string) =>
  toResult(async () => {
    const { supabase } = await session();
    const deleted = check(await supabase.from("team_cards").delete().eq("id", cardId).select("id"));
    if (!deleted.length) throw new Error("Seuls le créateur et le propriétaire du tableau peuvent supprimer cette carte.");
  });

/** Assigne exactement ces personnes (ajouts notifiés ; ajoutés aussi aux participants de l'événement lié). */
export const setTeamCardMembers = async (cardId: string, userIds: string[]) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    const current = check(await supabase.from("team_card_members").select("user_id").eq("card_id", cardId)).map((m) => m.user_id);
    const toAdd = userIds.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !userIds.includes(id));
    if (toRemove.length) check(await supabase.from("team_card_members").delete().eq("card_id", cardId).in("user_id", toRemove));
    if (toAdd.length) {
      check(
        await supabase
          .from("team_card_members")
          .insert(toAdd.map((id) => ({ card_id: cardId, user_id: id, assigned_by: userId, ...(id === userId && { seen_at: new Date().toISOString() }) })))
      );
    }
  });

/** L'assigné a ouvert la carte : elle n'est plus « nouvelle ». */
export const markTeamCardSeen = async (cardId: string) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    check(
      await supabase
        .from("team_card_members")
        .update({ seen_at: new Date().toISOString() })
        .eq("card_id", cardId)
        .eq("user_id", userId)
        .is("seen_at", null)
    );
  });

/* ---------- Checklist ---------- */

export const addTeamChecklistItem = async (cardId: string, content: string, position: number) =>
  toResult(async () => {
    const { supabase } = await session();
    check(await supabase.from("team_checklist_items").insert({ card_id: cardId, content: content.trim(), position }));
  });

export const updateTeamChecklistItem = async (itemId: string, patch: { done?: boolean; content?: string }) =>
  toResult(async () => {
    const { supabase } = await session();
    check(
      await supabase
        .from("team_checklist_items")
        .update({ ...(patch.done !== undefined && { done: patch.done }), ...(patch.content !== undefined && { content: patch.content.trim() }) })
        .eq("id", itemId)
    );
  });

export const deleteTeamChecklistItem = async (itemId: string) =>
  toResult(async () => {
    const { supabase } = await session();
    check(await supabase.from("team_checklist_items").delete().eq("id", itemId));
  });

/* ---------- Discussion ---------- */

export const listTeamCardComments = async (cardId: string) =>
  toResult(async (): Promise<TeamComment[]> => {
    const { supabase } = await session();
    const rows = check(
      await supabase.from("team_card_comments").select("id, user_id, content, created_at").eq("card_id", cardId).order("created_at", { ascending: false })
    );
    return rows.map((r) => ({ id: r.id, userId: r.user_id, content: r.content, createdAt: r.created_at }));
  });

/** Commentaire : prévient le créateur et les assignés (sauf l'auteur). */
export const addTeamCardComment = async (cardId: string, content: string) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    check(await supabase.from("team_card_comments").insert({ card_id: cardId, user_id: userId, content: content.trim() }));
    const [card, members, author] = await Promise.all([
      supabase.from("team_cards").select("title, created_by").eq("id", cardId).single().then(check),
      supabase.from("team_card_members").select("user_id").eq("card_id", cardId).then(check),
      supabase.from("profiles").select("first_name, last_name, email").eq("id", userId).single().then(check),
    ]);
    const actor = personName(author);
    const recipients = [...new Set([card.created_by, ...members.map((m) => m.user_id)])].filter((id): id is string => !!id && id !== userId);
    await Promise.all(
      recipients.map((uid) =>
        supabase.rpc("create_notification", {
          p_user_id: uid,
          p_type: "card_commented",
          p_title: "Nouveau commentaire",
          p_message: `${actor} a commenté « ${card.title} » : ${content.trim().slice(0, 120)}`,
          p_actor_name: actor,
          p_data: { team_card_id: cardId },
        })
      )
    );
  });

export const deleteTeamCardComment = async (commentId: string) =>
  toResult(async () => {
    const { supabase } = await session();
    check(await supabase.from("team_card_comments").delete().eq("id", commentId));
  });

/* ---------- Événements ---------- */

/** Événements à lier à une carte : recherche par titre, les plus proches d'aujourd'hui d'abord. */
export const searchTeamEvents = async (query: string) =>
  toResult(async () => {
    const { supabase } = await session();
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    let q = supabase.from("events").select("id, title, start_date").gte("start_date", since).order("start_date").limit(20);
    if (query.trim()) q = q.ilike("title", `%${query.trim().replace(/[%_]/g, "")}%`);
    return check(await q).map((e) => ({ id: e.id, title: e.title, startDate: e.start_date }));
  });

/** Cartes (visibles par moi) liées à ces événements : pictogramme du calendrier et section de la fiche événement. */
export const listTeamCardsForEvents = async (eventIds: string[]) =>
  toResult(async (): Promise<Record<string, { id: string; title: string }[]>> => {
    if (!eventIds.length) return {};
    const { supabase } = await session();
    const out: Record<string, { id: string; title: string }[]> = {};
    for (let i = 0; i < eventIds.length; i += 200) {
      const rows = check(
        await supabase.from("team_cards").select("id, title, event_id").in("event_id", eventIds.slice(i, i + 200)).is("archived_at", null).order("created_at")
      );
      for (const r of rows) if (r.event_id) (out[r.event_id] ??= []).push({ id: r.id, title: r.title });
    }
    return out;
  });
