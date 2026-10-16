"use server";

import { after } from "next/server";
import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getSolicitations } from "@/lib/board/solicitation";
import { sendNotificationPushes } from "@/lib/push/notificationPush";
import { REACTION_KEYS, attachmentFallback, type ChatAttachmentInput, type ChatMessage, type ChatPerson, type DiscussionThread } from "@/lib/board/discussions";

// Discussions des événements (onglet Discussion de la fiche, bulle « Discussions » ordinateur,
// mobile et appli) :
// - message enregistré avec les droits de l'auteur (RLS), réponse à un message (parent_id),
//   pièces jointes et vocaux (event_comment_attachments, bucket event-files, dossier discussions/) ;
// - « event_mentioned » pour chaque personne mentionnée avec @ (cloche, e-mail, push) ;
// - « event_commented » pour les autres participants (push et bulle ; déjà lue dans la cloche, sans e-mail) ;
// - réactions (event_comment_reactions, mêmes clés que l'appli calendrier-lgef), lu / non lu
//   (event_comment_reads) et archivage propre à chacun (event_discussion_archives).
// Tout passe par la visibilité de l'événement pour l'utilisateur (RLS) avant les lectures en service.

type Service = ReturnType<typeof createServiceClient>;

const BUCKET = "event-files";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Messages plus anciens : jamais comptés comme non lus (le suivi des lectures démarre avec la bulle). */
const UNREAD_WINDOW_DAYS = 30;
/** Discussions affichées dans la bulle : celles qui ont un message depuis… */
const THREADS_WINDOW_DAYS = 180;

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return { supabase, userId };
}

/** L'événement m'est visible (RLS) : sinon rien n'est lu ni écrit pour lui. */
async function assertEventVisible(supabase: Awaited<ReturnType<typeof createClient>>, eventId: string) {
  const { data } = await supabase.from("events").select("id").eq("id", eventId).maybeSingle();
  if (!data) throw new Error("Événement introuvable ou non accessible.");
}

const fullName = (p: { first_name: string | null; last_name: string | null } | null | undefined) => `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

async function chunked<T>(ids: string[], fn: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await fn(ids.slice(i, i + 150))));
  return out;
}

async function peopleById(service: Service, ids: string[]): Promise<Map<string, ChatPerson>> {
  const rows = await chunked([...new Set(ids)], async (s) => (await service.from("profiles").select("id, first_name, last_name, avatar_url").in("id", s)).data ?? []);
  return new Map(
    rows.map((p) => {
      const name = fullName(p) || "Quelqu'un";
      return [p.id, { id: p.id, name, initials: initialsOf(name), avatarUrl: p.avatar_url ?? null }];
    })
  );
}

/** Lectures enregistrées une seule fois par message et par personne. */
async function markRead(service: Service, userId: string, commentIds: string[]) {
  if (!commentIds.length) return;
  const already = await chunked(commentIds, async (ids) => (await service.from("event_comment_reads").select("comment_id").eq("user_id", userId).in("comment_id", ids)).data ?? []);
  const seen = new Set(already.map((r) => r.comment_id));
  const now = new Date().toISOString();
  const rows = commentIds.filter((id) => !seen.has(id)).map((id) => ({ comment_id: id, user_id: userId, read_at: now }));
  if (rows.length) {
    const { error } = await service.from("event_comment_reads").insert(rows);
    if (error) console.error("[event-comments.read]", error);
  }
}

/* ---------- Conversation ---------- */

async function getDiscussionImpl(eventId: string): Promise<{ me: string; messages: ChatMessage[]; archived: boolean }> {
  const { supabase, userId } = await session();
  await assertEventVisible(supabase, eventId);
  // Messages visibles (règles de la base), puis détails en service.
  const { data: visible, error } = await supabase.rpc("get_visible_event_comments", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  const ids = ((visible as { id: string }[] | null) ?? []).map((c) => c.id);
  const service = createServiceClient();
  const { data: archive } = await service.from("event_discussion_archives").select("archived_at").eq("user_id", userId).eq("event_id", eventId).maybeSingle();
  if (!ids.length) return { me: userId, messages: [], archived: !!archive };

  const [rows, reactions, attachments] = await Promise.all([
    chunked(ids, async (s) => (await service.from("event_comments").select("id, author_id, body, created_at, parent_id, mentions").in("id", s)).data ?? []),
    chunked(ids, async (s) => (await service.from("event_comment_reactions").select("comment_id, user_id, type").in("comment_id", s)).data ?? []),
    chunked(ids, async (s) => (await service.from("event_comment_attachments").select("id, comment_id, path, filename, content_type, size_bytes, kind, duration_ms").in("comment_id", s).order("created_at")).data ?? []),
  ]);
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const people = await peopleById(service, [...rows.map((r) => r.author_id), ...reactions.map((r) => r.user_id)]);

  const signed = attachments.length ? ((await service.storage.from(BUCKET).createSignedUrls(attachments.map((a) => a.path), 3600)).data ?? []) : [];
  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const messages: ChatMessage[] = rows.map((r) => {
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    const grouped = new Map<string, { count: number; mine: boolean; names: string[] }>();
    for (const x of reactions) {
      if (x.comment_id !== r.id) continue;
      const g = grouped.get(x.type) ?? { count: 0, mine: false, names: [] };
      g.count++;
      if (x.user_id === userId) g.mine = true;
      g.names.push(people.get(x.user_id)?.name ?? "Quelqu'un");
      grouped.set(x.type, g);
    }
    return {
      id: r.id,
      author: people.get(r.author_id) ?? { id: r.author_id, name: "Quelqu'un", initials: "?", avatarUrl: null },
      body: r.body,
      createdAt: r.created_at,
      mentions: r.mentions ?? [],
      reply: parent ? { id: parent.id, authorName: people.get(parent.author_id)?.name ?? "Quelqu'un", body: parent.body } : null,
      reactions: [...grouped].map(([type, g]) => ({ type, ...g })),
      attachments: attachments
        .filter((a) => a.comment_id === r.id)
        .map((a) => ({
          id: a.id,
          kind: a.kind as "file" | "image" | "audio",
          filename: a.filename,
          contentType: a.content_type,
          size: a.size_bytes,
          durationMs: a.duration_ms,
          url: urlByPath.get(a.path) ?? null,
        })),
    };
  });
  return { me: userId, messages, archived: !!archive };
}

/** Dépôt d'un fichier joint : URL signée d'envoi direct vers le stockage (pas de limite de taille des actions serveur). */
async function createDiscussionUploadImpl(eventId: string, filename: string, size: number) {
  const { supabase } = await session();
  await assertEventVisible(supabase, eventId);
  if (size > MAX_FILE_BYTES) throw new Error("Fichier trop lourd (25 Mo maximum).");
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const base = (dot > 0 ? filename.slice(0, dot) : filename)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  const path = `discussions/${eventId}/${crypto.randomUUID()}-${base || "fichier"}${ext}`;
  const { data, error } = await createServiceClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Envoi impossible.");
  return { path: data.path, token: data.token };
}

async function postEventCommentImpl(eventId: string, body: string, mentionIds: string[], opts: { parentId?: string | null; attachments?: ChatAttachmentInput[] }) {
  const attachments = (opts.attachments ?? []).filter((a) => a.path.startsWith(`discussions/${eventId}/`)).slice(0, 10);
  const text = body.trim() || attachmentFallback(attachments);
  if (!text) throw new Error("Message vide.");
  if (text.length > 4000) throw new Error("Message trop long.");
  const { supabase, userId } = await session();

  const mentions = [...new Set(mentionIds)].filter((id) => id !== userId).slice(0, 50);
  const { data: inserted, error } = await supabase
    .from("event_comments")
    .insert({ event_id: eventId, author_id: userId, body: text, mentions: mentions.length ? mentions : null, parent_id: opts.parentId ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const service = createServiceClient();
  if (attachments.length) {
    const { error: attError } = await service.from("event_comment_attachments").insert(
      attachments.map((a) => ({
        comment_id: inserted.id,
        path: a.path,
        filename: a.filename.slice(0, 200),
        content_type: a.contentType,
        size_bytes: a.size,
        kind: a.kind,
        duration_ms: a.durationMs ?? null,
      }))
    );
    if (attError) console.error("[event-comments.attachments]", attError);
  }
  await markRead(service, userId, [inserted.id]);
  // Nouveau message : la discussion sort des archives de chacun.
  await service.from("event_discussion_archives").delete().eq("event_id", eventId);

  const [{ data: event }, { data: author }, { data: earlier }] = await Promise.all([
    service.from("events").select("title, created_by").eq("id", eventId).single(),
    service.from("profiles").select("first_name, last_name").eq("id", userId).single(),
    service.from("event_comments").select("author_id, mentions").eq("event_id", eventId).neq("id", inserted.id),
  ]);
  const actor = fullName(author) || "Quelqu'un";
  const title = event?.title ?? "l'événement";
  const excerpt = text.length > 160 ? `${text.slice(0, 157)}…` : text;

  // Participants : ceux qui ont déjà écrit ou été mentionnés, et le créateur de l'événement.
  const participants = new Set<string>();
  if (event?.created_by) participants.add(event.created_by);
  for (const c of earlier ?? []) {
    participants.add(c.author_id);
    for (const m of c.mentions ?? []) participants.add(m);
  }
  participants.delete(userId);
  for (const m of mentions) participants.delete(m);

  const rows = [
    ...mentions.map((uid) => ({
      user_id: uid,
      type: "event_mentioned" as const,
      title: "Vous avez été mentionné",
      message: `${actor} vous a mentionné dans la discussion de « ${title} » : ${excerpt}`,
      actor_name: actor,
      event_id: eventId,
      data: { event_id: eventId, tab: "discussion" },
    })),
    ...[...participants].map((uid) => ({
      user_id: uid,
      type: "event_commented" as const,
      title: `${actor} · ${title}`,
      message: excerpt,
      actor_name: actor,
      event_id: eventId,
      read: true,
      data: { event_id: eventId, tab: "discussion" },
    })),
  ];
  if (rows.length) {
    const { error: notifError } = await service.from("notifications").insert(rows);
    if (notifError) console.error("[event-comments.notify]", notifError);
    // Push tout de suite, comme une messagerie (sinon au prochain passage du cron, chaque minute).
    else after(() => sendNotificationPushes(service).catch((e) => console.error("[event-comments.push]", e)));
  }
}

/** Réaction (❤️ par défaut) : ajoutée, ou retirée si je l'avais déjà mise. */
async function toggleReactionImpl(commentId: string, type: string) {
  if (!REACTION_KEYS.includes(type)) throw new Error("Réaction inconnue.");
  const { supabase, userId } = await session();
  const service = createServiceClient();
  const { data: comment } = await service.from("event_comments").select("event_id").eq("id", commentId).maybeSingle();
  if (!comment) throw new Error("Message introuvable.");
  await assertEventVisible(supabase, comment.event_id);
  const { data: existing } = await service.from("event_comment_reactions").select("type").eq("comment_id", commentId).eq("user_id", userId).eq("type", type);
  if (existing?.length) {
    await service.from("event_comment_reactions").delete().eq("comment_id", commentId).eq("user_id", userId).eq("type", type);
  } else {
    const { error } = await service.from("event_comment_reactions").insert({ comment_id: commentId, user_id: userId, type });
    if (error) throw new Error(error.message);
  }
}

/** Discussion ouverte : ses messages sont lus, et ses notifications aussi. */
async function markDiscussionReadImpl(eventId: string) {
  const { supabase, userId } = await session();
  await assertEventVisible(supabase, eventId);
  const service = createServiceClient();
  const { data: comments } = await service.from("event_comments").select("id").eq("event_id", eventId).neq("author_id", userId);
  await markRead(service, userId, (comments ?? []).map((c) => c.id));
  await service.from("notifications").update({ read: true }).eq("user_id", userId).eq("event_id", eventId).in("type", ["event_mentioned", "event_commented"]).eq("read", false);
}

/** Archivée : sort de la liste (et ses non-lus ne comptent plus) jusqu'au prochain message. */
async function setDiscussionArchivedImpl(eventId: string, archived: boolean) {
  const { supabase, userId } = await session();
  await assertEventVisible(supabase, eventId);
  const service = createServiceClient();
  if (archived) {
    const { error } = await service
      .from("event_discussion_archives")
      .upsert({ user_id: userId, event_id: eventId, archived_at: new Date().toISOString() }, { onConflict: "user_id,event_id" });
    if (error) throw new Error(error.message);
    await markDiscussionReadImpl(eventId);
  } else {
    await service.from("event_discussion_archives").delete().eq("user_id", userId).eq("event_id", eventId);
  }
}

/* ---------- Liste de la bulle ---------- */

/**
 * Discussions où je suis concerné : j'y ai écrit, j'y suis mentionné, j'ai créé l'événement ou j'y
 * suis sollicité (équipe, captation, comité…) — les plus récentes d'abord, avec les non-lus.
 */
async function listMyDiscussionsImpl(): Promise<DiscussionThread[]> {
  const { userId } = await session();
  const service: Service = createServiceClient();
  const since = new Date(Date.now() - THREADS_WINDOW_DAYS * 86_400_000).toISOString();
  const unreadSince = new Date(Date.now() - UNREAD_WINDOW_DAYS * 86_400_000).toISOString();

  const [{ data: comments }, solicited, { data: archives }] = await Promise.all([
    service.from("event_comments").select("id, event_id, author_id, body, created_at, mentions").gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
    getSolicitations(service, userId),
    service.from("event_discussion_archives").select("event_id").eq("user_id", userId),
  ]);
  if (!comments?.length) return [];
  const archived = new Set((archives ?? []).map((a) => a.event_id));

  const eventIds = [...new Set(comments.map((c) => c.event_id))];
  const events = await chunked(eventIds, async (ids) => (await service.from("events").select("id, title, start_date, created_by").in("id", ids)).data ?? []);
  const eventById = new Map(events.map((e) => [e.id, e]));

  const involved = new Set<string>();
  for (const c of comments) if (c.author_id === userId || (c.mentions ?? []).includes(userId)) involved.add(c.event_id);
  for (const e of events) if (e.created_by === userId || solicited.has(e.id)) involved.add(e.id);

  const mine = comments.filter((c) => involved.has(c.event_id) && eventById.has(c.event_id));
  if (!mine.length) return [];

  // Mon dernier message de chaque discussion : ce qui précède est forcément vu.
  const myLast = new Map<string, string>();
  for (const c of mine) if (c.author_id === userId && !myLast.has(c.event_id)) myLast.set(c.event_id, c.created_at);
  const candidates = mine.filter((c) => c.author_id !== userId && c.created_at >= unreadSince && c.created_at > (myLast.get(c.event_id) ?? ""));
  const reads = await chunked(candidates.map((c) => c.id), async (ids) => (await service.from("event_comment_reads").select("comment_id").eq("user_id", userId).in("comment_id", ids)).data ?? []);
  const read = new Set(reads.map((r) => r.comment_id));
  const unread = candidates.filter((c) => !read.has(c.id));

  // Participants (sauf moi), du plus récent au plus ancien : auteurs puis mentionnés.
  const participantIds = new Map<string, string[]>();
  for (const c of mine) {
    const list = participantIds.get(c.event_id) ?? [];
    for (const id of [c.author_id, ...(c.mentions ?? [])]) if (id !== userId && !list.includes(id)) list.push(id);
    participantIds.set(c.event_id, list);
  }
  const people = await peopleById(service, [...participantIds.values()].flat());

  const threads = new Map<string, DiscussionThread>();
  for (const c of mine) {
    if (threads.has(c.event_id)) continue; // tri décroissant : le premier est le dernier message
    const e = eventById.get(c.event_id)!;
    threads.set(c.event_id, {
      eventId: c.event_id,
      title: e.title,
      startDate: e.start_date,
      participants: (participantIds.get(c.event_id) ?? []).map((id) => people.get(id)).filter((p): p is ChatPerson => !!p),
      last: { authorName: c.author_id === userId ? "Vous" : (people.get(c.author_id)?.name.split(" ")[0] ?? "Quelqu'un"), body: c.body, at: c.created_at, mine: c.author_id === userId },
      unread: 0,
      mentioned: false,
      archived: archived.has(c.event_id),
    });
  }
  for (const c of unread) {
    const t = threads.get(c.event_id)!;
    if (t.archived) continue;
    t.unread++;
    if ((c.mentions ?? []).includes(userId)) t.mentioned = true;
  }
  return [...threads.values()].slice(0, 80);
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function getDiscussion(eventId: string) {
  return toResult(() => getDiscussionImpl(eventId));
}

export async function postEventComment(eventId: string, body: string, mentionIds: string[] = [], opts: { parentId?: string | null; attachments?: ChatAttachmentInput[] } = {}) {
  return toResult(() => postEventCommentImpl(eventId, body, mentionIds, opts));
}

export async function createDiscussionUpload(eventId: string, filename: string, size: number) {
  return toResult(() => createDiscussionUploadImpl(eventId, filename, size));
}

export async function toggleReaction(commentId: string, type = "like") {
  return toResult(() => toggleReactionImpl(commentId, type));
}

export async function setDiscussionArchived(eventId: string, archived: boolean) {
  return toResult(() => setDiscussionArchivedImpl(eventId, archived));
}

export async function listMyDiscussions() {
  return toResult(() => listMyDiscussionsImpl());
}

export async function markDiscussionRead(eventId: string) {
  return toResult(() => markDiscussionReadImpl(eventId));
}
