"use server";

import { after } from "next/server";
import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { sendNotificationPushes } from "@/lib/push/notificationPush";
import {
  LIKE,
  attachmentFallback,
  type ChatAttachment,
  type ChatAttachmentInput,
  type ChatMessage,
  type ChatPerson,
  type ChatSearchResults,
  type ChatSource,
  type DiscussionThread,
} from "@/lib/board/discussions";

// Discussions du board (bulle « Discussions » ordinateur, mobile et appli ; onglet Discussion de la
// fiche événement). Deux sortes :
// - discussion d'un événement : event_comments (+ event_comment_attachments, event_comment_reactions,
//   event_comment_reads, event_discussion_archives), visibilité = celle de l'événement (RLS) ;
// - discussion directe entre utilisateurs, à deux ou en groupe : chat_conversations, chat_messages
//   (+ pièces jointes, ❤️, lu / archivé par membre), réservée à ses membres.
// Notifications : « event_mentioned » pour une mention @ (cloche, e-mail, push) ; « event_commented »
// et « direct_message » pour les nouveaux messages (push et bulle seulement). Une discussion
// archivée réapparaît dès qu'on y est à nouveau notifié.

type Service = ReturnType<typeof createServiceClient>;
type UserClient = Awaited<ReturnType<typeof createClient>>;

const BUCKET = "event-files";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Messages d'événement plus anciens : jamais comptés comme non lus (suivi des lectures récent). */
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

const fullName = (p: { first_name: string | null; last_name: string | null } | null | undefined) => `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
const firstName = (p: ChatPerson | undefined) => p?.name.split(" ")[0] ?? "Quelqu'un";
const excerptOf = (text: string) => (text.length > 160 ? `${text.slice(0, 157)}…` : text);
const unknownPerson = (id: string): ChatPerson => ({ id, name: "Quelqu'un", initials: "?", avatarUrl: null });

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

type MessageRow = { id: string; author_id: string; body: string; created_at: string; parent_id: string | null; mentions: string[] | null };
type AttachmentRow = { id: string; message_id: string; path: string; filename: string; content_type: string | null; size_bytes: number | null; kind: string; duration_ms: number | null };

/** Lignes de messages (communes aux deux sortes) → messages affichés, avec ❤️, réponses et pièces jointes signées. */
async function buildMessages(service: Service, userId: string, rows: MessageRow[], likes: { message_id: string; user_id: string }[], attachments: AttachmentRow[]): Promise<ChatMessage[]> {
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const people = await peopleById(service, [...rows.map((r) => r.author_id), ...likes.map((l) => l.user_id)]);
  const signed = attachments.length ? ((await service.storage.from(BUCKET).createSignedUrls(attachments.map((a) => a.path), 3600)).data ?? []) : [];
  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.map((r) => {
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    const liked = likes.filter((l) => l.message_id === r.id);
    return {
      id: r.id,
      author: people.get(r.author_id) ?? unknownPerson(r.author_id),
      body: r.body,
      createdAt: r.created_at,
      mentions: r.mentions ?? [],
      reply: parent ? { id: parent.id, authorName: people.get(parent.author_id)?.name ?? "Quelqu'un", body: parent.body } : null,
      likes: { mine: liked.some((l) => l.user_id === userId), names: liked.map((l) => (l.user_id === userId ? "Vous" : (people.get(l.user_id)?.name ?? "Quelqu'un"))) },
      attachments: attachments
        .filter((a) => a.message_id === r.id)
        .map(
          (a): ChatAttachment => ({
            id: a.id,
            kind: a.kind as ChatAttachment["kind"],
            filename: a.filename,
            contentType: a.content_type,
            size: a.size_bytes,
            durationMs: a.duration_ms,
            url: urlByPath.get(a.path) ?? null,
          })
        ),
    };
  });
}

const folderOf = (source: ChatSource) => (source.kind === "event" ? `discussions/${source.id}/` : `chats/${source.id}/`);

function storagePath(source: ChatSource, filename: string) {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const base = (dot > 0 ? filename.slice(0, dot) : filename)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${folderOf(source)}${crypto.randomUUID()}-${base || "fichier"}${ext}`;
}

const attachmentRow = (a: ChatAttachmentInput) => ({
  path: a.path,
  filename: a.filename.slice(0, 200),
  content_type: a.contentType,
  size_bytes: a.size,
  kind: a.kind,
  duration_ms: a.durationMs ?? null,
});

function pushSoon(service: Service) {
  // Push tout de suite, comme une messagerie (sinon au prochain passage du cron, chaque minute).
  after(() => sendNotificationPushes(service).catch((e) => console.error("[chat.push]", e)));
}

/* =====================================================================================
 * Discussion d'un événement
 * ===================================================================================== */

/** L'événement m'est visible (RLS) : sinon rien n'est lu ni écrit pour lui. */
async function assertEventVisible(supabase: UserClient, eventId: string) {
  const { data } = await supabase.from("events").select("id").eq("id", eventId).maybeSingle();
  if (!data) throw new Error("Événement introuvable ou non accessible.");
}

/** Lectures enregistrées une seule fois par message et par personne. */
async function markEventCommentsRead(service: Service, userId: string, commentIds: string[]) {
  if (!commentIds.length) return;
  const already = await chunked(commentIds, async (ids) => (await service.from("event_comment_reads").select("comment_id").eq("user_id", userId).in("comment_id", ids)).data ?? []);
  const seen = new Set(already.map((r) => r.comment_id));
  const now = new Date().toISOString();
  const rows = commentIds.filter((id) => !seen.has(id)).map((id) => ({ comment_id: id, user_id: userId, read_at: now }));
  if (rows.length) {
    const { error } = await service.from("event_comment_reads").insert(rows);
    if (error) console.error("[chat.event.read]", error);
  }
}

async function getEventChat(supabase: UserClient, userId: string, eventId: string) {
  await assertEventVisible(supabase, eventId);
  // Messages visibles (règles de la base), puis détails en service.
  const { data: visible, error } = await supabase.rpc("get_visible_event_comments", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  const ids = ((visible as { id: string }[] | null) ?? []).map((c) => c.id);
  const service = createServiceClient();
  const [{ data: archive }, { data: event }] = await Promise.all([
    service.from("event_discussion_archives").select("archived_at").eq("user_id", userId).eq("event_id", eventId).maybeSingle(),
    service.from("events").select("title, start_date").eq("id", eventId).single(),
  ]);
  const [rows, likes, attachments] = ids.length
    ? await Promise.all([
        chunked(ids, async (s) => (await service.from("event_comments").select("id, author_id, body, created_at, parent_id, mentions").in("id", s)).data ?? []),
        chunked(ids, async (s) => (await service.from("event_comment_reactions").select("comment_id, user_id").eq("type", LIKE).in("comment_id", s)).data ?? []),
        chunked(ids, async (s) => (await service.from("event_comment_attachments").select("id, comment_id, path, filename, content_type, size_bytes, kind, duration_ms").in("comment_id", s).order("created_at")).data ?? []),
      ])
    : [[], [], []];
  const messages = await buildMessages(
    service,
    userId,
    rows,
    likes.map((l) => ({ message_id: l.comment_id, user_id: l.user_id })),
    attachments.map((a) => ({ ...a, message_id: a.comment_id }))
  );
  return { title: event?.title ?? "Événement", startDate: event?.start_date ?? null, participants: [] as ChatPerson[], messages, archived: !!archive };
}

async function postEventMessage(supabase: UserClient, userId: string, eventId: string, text: string, mentions: string[], parentId: string | null, attachments: ChatAttachmentInput[]) {
  const { data: inserted, error } = await supabase
    .from("event_comments")
    .insert({ event_id: eventId, author_id: userId, body: text, mentions: mentions.length ? mentions : null, parent_id: parentId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const service = createServiceClient();
  if (attachments.length) {
    const { error: attError } = await service.from("event_comment_attachments").insert(attachments.map((a) => ({ comment_id: inserted.id, ...attachmentRow(a) })));
    if (attError) console.error("[chat.event.attachments]", attError);
  }
  await markEventCommentsRead(service, userId, [inserted.id]);

  const [{ data: event }, { data: author }, { data: earlier }] = await Promise.all([
    service.from("events").select("title").eq("id", eventId).single(),
    service.from("profiles").select("first_name, last_name").eq("id", userId).single(),
    service.from("event_comments").select("author_id, mentions").eq("event_id", eventId).neq("id", inserted.id),
  ]);
  const actor = fullName(author) || "Quelqu'un";
  const title = event?.title ?? "l'événement";
  const excerpt = excerptOf(text);

  // Participants notifiés : ceux qui ont déjà écrit ou été mentionnés (comme la liste de la bulle).
  const participants = new Set<string>();
  for (const c of earlier ?? []) {
    participants.add(c.author_id);
    for (const m of c.mentions ?? []) participants.add(m);
  }
  participants.delete(userId);
  for (const m of mentions) participants.delete(m);

  // Notifiés (et moi) : la discussion sort de leurs archives.
  await service.from("event_discussion_archives").delete().eq("event_id", eventId).in("user_id", [userId, ...mentions, ...participants]);

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
    if (notifError) console.error("[chat.event.notify]", notifError);
    else pushSoon(service);
  }
}

async function markEventRead(supabase: UserClient, userId: string, eventId: string) {
  await assertEventVisible(supabase, eventId);
  const service = createServiceClient();
  const { data: comments } = await service.from("event_comments").select("id").eq("event_id", eventId).neq("author_id", userId);
  await markEventCommentsRead(service, userId, (comments ?? []).map((c) => c.id));
  await service.from("notifications").update({ read: true }).eq("user_id", userId).eq("event_id", eventId).in("type", ["event_mentioned", "event_commented"]).eq("read", false);
}

/** Discussions d'événements où j'ai écrit ou suis mentionné — les plus récentes d'abord. */
async function listEventThreads(service: Service, userId: string): Promise<DiscussionThread[]> {
  const since = new Date(Date.now() - THREADS_WINDOW_DAYS * 86_400_000).toISOString();
  const unreadSince = new Date(Date.now() - UNREAD_WINDOW_DAYS * 86_400_000).toISOString();
  const [{ data: comments }, { data: archives }] = await Promise.all([
    service.from("event_comments").select("id, event_id, author_id, body, created_at, mentions").gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
    service.from("event_discussion_archives").select("event_id").eq("user_id", userId),
  ]);
  if (!comments?.length) return [];
  const archived = new Set((archives ?? []).map((a) => a.event_id));

  const involved = new Set<string>();
  for (const c of comments) if (c.author_id === userId || (c.mentions ?? []).includes(userId)) involved.add(c.event_id);
  const mine = comments.filter((c) => involved.has(c.event_id));
  if (!mine.length) return [];
  const events = await chunked([...involved], async (ids) => (await service.from("events").select("id, title, start_date").in("id", ids)).data ?? []);
  const eventById = new Map(events.map((e) => [e.id, e]));

  // Mon dernier message de chaque discussion : ce qui précède est forcément vu.
  const myLast = new Map<string, string>();
  for (const c of mine) if (c.author_id === userId && !myLast.has(c.event_id)) myLast.set(c.event_id, c.created_at);
  const candidates = mine.filter((c) => c.author_id !== userId && c.created_at >= unreadSince && c.created_at > (myLast.get(c.event_id) ?? ""));
  const reads = await chunked(candidates.map((c) => c.id), async (ids) => (await service.from("event_comment_reads").select("comment_id").eq("user_id", userId).in("comment_id", ids)).data ?? []);
  const read = new Set(reads.map((r) => r.comment_id));

  const participantIds = new Map<string, string[]>();
  for (const c of mine) {
    const list = participantIds.get(c.event_id) ?? [];
    for (const id of [c.author_id, ...(c.mentions ?? [])]) if (id !== userId && !list.includes(id)) list.push(id);
    participantIds.set(c.event_id, list);
  }
  const people = await peopleById(service, [...participantIds.values()].flat());

  const threads = new Map<string, DiscussionThread>();
  for (const c of mine) {
    const e = eventById.get(c.event_id);
    if (!e || threads.has(c.event_id)) continue; // tri décroissant : le premier est le dernier message
    threads.set(c.event_id, {
      source: { kind: "event", id: c.event_id },
      title: e.title,
      startDate: e.start_date,
      participants: (participantIds.get(c.event_id) ?? []).map((id) => people.get(id)).filter((p): p is ChatPerson => !!p),
      last: { authorName: c.author_id === userId ? "Vous" : firstName(people.get(c.author_id)), body: c.body, at: c.created_at, mine: c.author_id === userId },
      unread: 0,
      mentioned: false,
      archived: archived.has(c.event_id),
    });
  }
  for (const c of candidates) {
    const t = threads.get(c.event_id);
    if (!t || t.archived || read.has(c.id)) continue;
    t.unread++;
    if ((c.mentions ?? []).includes(userId)) t.mentioned = true;
  }
  return [...threads.values()];
}

/* =====================================================================================
 * Discussion directe (à deux ou en groupe)
 * ===================================================================================== */

async function assertMember(service: Service, conversationId: string, userId: string) {
  const { data } = await service.from("chat_conversation_members").select("archived_at, last_read_at").eq("conversation_id", conversationId).eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("Discussion introuvable.");
  return data;
}

async function membersOf(service: Service, conversationId: string) {
  const { data } = await service.from("chat_conversation_members").select("user_id").eq("conversation_id", conversationId);
  return (data ?? []).map((m) => m.user_id);
}

const directTitle = (others: ChatPerson[]) =>
  others.length === 0
    ? "Vous seul"
    : others.length === 1
      ? others[0].name
      : others.length === 2
        ? `${firstName(others[0])} et ${firstName(others[1])}`
        : `${firstName(others[0])}, ${firstName(others[1])} et ${others.length - 2} autre${others.length > 3 ? "s" : ""}`;

async function getDirectChat(userId: string, conversationId: string) {
  const service = createServiceClient();
  const membership = await assertMember(service, conversationId, userId);
  const memberIds = await membersOf(service, conversationId);
  const { data: rows } = await service.from("chat_messages").select("id, author_id, body, created_at, parent_id, mentions").eq("conversation_id", conversationId).order("created_at").limit(1000);
  const ids = (rows ?? []).map((r) => r.id);
  const [likes, attachments] = ids.length
    ? await Promise.all([
        chunked(ids, async (s) => (await service.from("chat_message_reactions").select("message_id, user_id").eq("type", LIKE).in("message_id", s)).data ?? []),
        chunked(ids, async (s) => (await service.from("chat_message_attachments").select("id, message_id, path, filename, content_type, size_bytes, kind, duration_ms").in("message_id", s).order("created_at")).data ?? []),
      ])
    : [[], []];
  const messages = await buildMessages(service, userId, rows ?? [], likes, attachments);
  const people = await peopleById(service, memberIds.filter((id) => id !== userId));
  const others = memberIds.filter((id) => id !== userId).map((id) => people.get(id) ?? unknownPerson(id));
  return { title: directTitle(others), startDate: null, participants: others, messages, archived: !!membership.archived_at };
}

async function postDirectMessage(userId: string, conversationId: string, text: string, mentions: string[], parentId: string | null, attachments: ChatAttachmentInput[]) {
  const service = createServiceClient();
  await assertMember(service, conversationId, userId);
  const { data: inserted, error } = await service
    .from("chat_messages")
    .insert({ conversation_id: conversationId, author_id: userId, body: text, mentions: mentions.length ? mentions : null, parent_id: parentId })
    .select("id, created_at")
    .single();
  if (error) throw new Error(error.message);
  if (attachments.length) {
    const { error: attError } = await service.from("chat_message_attachments").insert(attachments.map((a) => ({ message_id: inserted.id, ...attachmentRow(a) })));
    if (attError) console.error("[chat.direct.attachments]", attError);
  }
  await service.from("chat_conversations").update({ last_message_at: inserted.created_at }).eq("id", conversationId);
  // Tous les membres sont notifiés : la discussion sort de leurs archives ; elle est lue pour moi.
  await service.from("chat_conversation_members").update({ archived_at: null }).eq("conversation_id", conversationId);
  await service.from("chat_conversation_members").update({ last_read_at: inserted.created_at }).eq("conversation_id", conversationId).eq("user_id", userId);

  const memberIds = (await membersOf(service, conversationId)).filter((id) => id !== userId);
  if (!memberIds.length) return;
  const { data: author } = await service.from("profiles").select("first_name, last_name").eq("id", userId).single();
  const actor = fullName(author) || "Quelqu'un";
  const group = memberIds.length > 1;
  const { error: notifError } = await service.from("notifications").insert(
    memberIds.map((uid) => ({
      user_id: uid,
      type: "direct_message" as const,
      title: group ? `${actor} · discussion de groupe` : actor,
      message: excerptOf(text),
      actor_name: actor,
      read: true,
      data: { conversation_id: conversationId },
    }))
  );
  if (notifError) console.error("[chat.direct.notify]", notifError);
  else pushSoon(service);
}

/** Discussions directes dont je suis membre et qui ont au moins un message. */
async function listDirectThreads(service: Service, userId: string): Promise<DiscussionThread[]> {
  const { data: memberships } = await service.from("chat_conversation_members").select("conversation_id, last_read_at, archived_at").eq("user_id", userId);
  if (!memberships?.length) return [];
  const convIds = memberships.map((m) => m.conversation_id);
  const [members, messages] = await Promise.all([
    chunked(convIds, async (s) => (await service.from("chat_conversation_members").select("conversation_id, user_id").in("conversation_id", s)).data ?? []),
    chunked(convIds, async (s) => (await service.from("chat_messages").select("id, conversation_id, author_id, body, created_at, mentions").in("conversation_id", s).order("created_at", { ascending: false }).limit(2000)).data ?? []),
  ]);
  messages.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const people = await peopleById(service, members.map((m) => m.user_id).filter((id) => id !== userId));
  const threads: DiscussionThread[] = [];
  for (const m of memberships) {
    const msgs = messages.filter((x) => x.conversation_id === m.conversation_id);
    if (!msgs.length) continue;
    const others = members.filter((x) => x.conversation_id === m.conversation_id && x.user_id !== userId).map((x) => people.get(x.user_id) ?? unknownPerson(x.user_id));
    const lastMsg = msgs[0];
    const unread = m.archived_at ? [] : msgs.filter((x) => x.author_id !== userId && x.created_at > (m.last_read_at ?? ""));
    threads.push({
      source: { kind: "direct", id: m.conversation_id },
      title: directTitle(others),
      startDate: null,
      participants: others,
      last: { authorName: lastMsg.author_id === userId ? "Vous" : firstName(people.get(lastMsg.author_id)), body: lastMsg.body, at: lastMsg.created_at, mine: lastMsg.author_id === userId },
      unread: unread.length,
      mentioned: unread.some((x) => (x.mentions ?? []).includes(userId)),
      archived: !!m.archived_at,
    });
  }
  return threads;
}

/** Discussion directe avec ces personnes : la même si elle existe déjà (mêmes membres), sinon une nouvelle. */
async function openDirectImpl(userIds: string[]) {
  const { userId } = await session();
  const others = [...new Set(userIds)].filter((id) => id && id !== userId).slice(0, 30);
  if (!others.length) throw new Error("Choisissez au moins une personne.");
  const wanted = [userId, ...others].sort();
  const service = createServiceClient();
  const { data: mine } = await service.from("chat_conversation_members").select("conversation_id").eq("user_id", userId);
  const candidateIds = (mine ?? []).map((m) => m.conversation_id);
  if (candidateIds.length) {
    const members = await chunked(candidateIds, async (s) => (await service.from("chat_conversation_members").select("conversation_id, user_id").in("conversation_id", s)).data ?? []);
    for (const id of candidateIds) {
      const set = members.filter((m) => m.conversation_id === id).map((m) => m.user_id).sort();
      if (set.length === wanted.length && set.every((u, i) => u === wanted[i])) return id;
    }
  }
  const { data: valid } = await service.from("profiles").select("id").in("id", others);
  if ((valid ?? []).length !== others.length) throw new Error("Personne introuvable.");
  const { data: conv, error } = await service.from("chat_conversations").insert({ created_by: userId }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: memberError } = await service.from("chat_conversation_members").insert(wanted.map((uid) => ({ conversation_id: conv.id, user_id: uid })));
  if (memberError) throw new Error(memberError.message);
  return conv.id;
}

/* =====================================================================================
 * Actions communes
 * ===================================================================================== */

async function getChatImpl(source: ChatSource) {
  const { supabase, userId } = await session();
  const chat = source.kind === "event" ? await getEventChat(supabase, userId, source.id) : await getDirectChat(userId, source.id);
  return { me: userId, ...chat };
}

async function postChatImpl(source: ChatSource, body: string, mentionIds: string[], opts: { parentId?: string | null; attachments?: ChatAttachmentInput[] }) {
  const attachments = (opts.attachments ?? []).filter((a) => a.path.startsWith(folderOf(source))).slice(0, 10);
  const text = body.trim() || attachmentFallback(attachments);
  if (!text) throw new Error("Message vide.");
  if (text.length > 4000) throw new Error("Message trop long.");
  const { supabase, userId } = await session();
  const mentions = [...new Set(mentionIds)].filter((id) => id !== userId).slice(0, 50);
  if (source.kind === "event") await postEventMessage(supabase, userId, source.id, text, mentions, opts.parentId ?? null, attachments);
  else await postDirectMessage(userId, source.id, text, mentions, opts.parentId ?? null, attachments);
}

/** Dépôt d'un fichier joint : URL signée d'envoi direct vers le stockage (pas de limite de taille des actions serveur). */
async function createChatUploadImpl(source: ChatSource, filename: string, size: number) {
  const { supabase, userId } = await session();
  const service = createServiceClient();
  if (source.kind === "event") await assertEventVisible(supabase, source.id);
  else await assertMember(service, source.id, userId);
  if (size > MAX_FILE_BYTES) throw new Error("Fichier trop lourd (25 Mo maximum).");
  const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(storagePath(source, filename));
  if (error || !data) throw new Error(error?.message ?? "Envoi impossible.");
  return { path: data.path, token: data.token };
}

/** ❤️ : ajouté, ou retiré si je l'avais déjà mis. Renvoie l'état final. */
async function toggleLikeImpl(source: ChatSource, messageId: string): Promise<boolean> {
  const { supabase, userId } = await session();
  const service = createServiceClient();
  if (source.kind === "event") {
    const { data: comment } = await service.from("event_comments").select("event_id").eq("id", messageId).maybeSingle();
    if (!comment) throw new Error("Message introuvable.");
    await assertEventVisible(supabase, comment.event_id);
    const { data: existing } = await service.from("event_comment_reactions").select("type").eq("comment_id", messageId).eq("user_id", userId).eq("type", LIKE);
    const { error } = existing?.length
      ? await service.from("event_comment_reactions").delete().eq("comment_id", messageId).eq("user_id", userId).eq("type", LIKE)
      : await service.from("event_comment_reactions").insert({ comment_id: messageId, user_id: userId, type: LIKE });
    if (error) throw new Error(error.message);
    return !existing?.length;
  }
  const { data: msg } = await service.from("chat_messages").select("conversation_id").eq("id", messageId).maybeSingle();
  if (!msg) throw new Error("Message introuvable.");
  await assertMember(service, msg.conversation_id, userId);
  const { data: existing } = await service.from("chat_message_reactions").select("type").eq("message_id", messageId).eq("user_id", userId).eq("type", LIKE);
  const { error } = existing?.length
    ? await service.from("chat_message_reactions").delete().eq("message_id", messageId).eq("user_id", userId).eq("type", LIKE)
    : await service.from("chat_message_reactions").insert({ message_id: messageId, user_id: userId, type: LIKE });
  if (error) throw new Error(error.message);
  return !existing?.length;
}

async function markChatReadImpl(source: ChatSource) {
  const { supabase, userId } = await session();
  if (source.kind === "event") return markEventRead(supabase, userId, source.id);
  const service = createServiceClient();
  await assertMember(service, source.id, userId);
  await service.from("chat_conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", source.id).eq("user_id", userId);
}

/** Archivée : sort de la liste (et ses non-lus ne comptent plus) jusqu'à la prochaine notification. */
async function setChatArchivedImpl(source: ChatSource, archived: boolean) {
  const { supabase, userId } = await session();
  const service = createServiceClient();
  if (source.kind === "event") {
    await assertEventVisible(supabase, source.id);
    if (archived) {
      const { error } = await service
        .from("event_discussion_archives")
        .upsert({ user_id: userId, event_id: source.id, archived_at: new Date().toISOString() }, { onConflict: "user_id,event_id" });
      if (error) throw new Error(error.message);
      await markEventRead(supabase, userId, source.id);
    } else {
      await service.from("event_discussion_archives").delete().eq("user_id", userId).eq("event_id", source.id);
    }
    return;
  }
  await assertMember(service, source.id, userId);
  const now = new Date().toISOString();
  await service
    .from("chat_conversation_members")
    .update(archived ? { archived_at: now, last_read_at: now } : { archived_at: null })
    .eq("conversation_id", source.id)
    .eq("user_id", userId);
}

async function listChatsImpl(): Promise<DiscussionThread[]> {
  const { userId } = await session();
  const service = createServiceClient();
  const [events, direct] = await Promise.all([listEventThreads(service, userId), listDirectThreads(service, userId)]);
  return [...events, ...direct].sort((a, b) => (b.last?.at ?? "").localeCompare(a.last?.at ?? "")).slice(0, 100);
}

/** Recherche de la bulle : personnes du board (pour leur écrire) et événements visibles. */
async function searchChatTargetsImpl(query: string): Promise<ChatSearchResults> {
  const { supabase, userId } = await session();
  const q = query.trim().replace(/[%_,()*]/g, "");
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  let events = supabase.from("events").select("id, title, start_date").gte("start_date", since).order("start_date").limit(15);
  if (q) events = events.ilike("title", `%${q}%`);
  let people = supabase.from("profiles").select("id, first_name, last_name, avatar_url").neq("id", userId).order("first_name").limit(q ? 12 : 8);
  for (const w of q.split(/\s+/).filter(Boolean)) people = people.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`);
  const [{ data: ev }, { data: pp }] = await Promise.all([events, people]);
  return {
    events: (ev ?? []).map((e) => ({ id: e.id, title: e.title, startDate: e.start_date })),
    people: (pp ?? [])
      .map((p) => {
        const name = fullName(p);
        return { id: p.id, name, initials: initialsOf(name), avatarUrl: p.avatar_url ?? null };
      })
      .filter((p) => p.name),
  };
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function getChat(source: ChatSource) {
  return toResult(() => getChatImpl(source));
}

export async function postChat(source: ChatSource, body: string, mentionIds: string[] = [], opts: { parentId?: string | null; attachments?: ChatAttachmentInput[] } = {}) {
  return toResult(() => postChatImpl(source, body, mentionIds, opts));
}

export async function createChatUpload(source: ChatSource, filename: string, size: number) {
  return toResult(() => createChatUploadImpl(source, filename, size));
}

export async function toggleLike(source: ChatSource, messageId: string) {
  return toResult(() => toggleLikeImpl(source, messageId));
}

export async function markChatRead(source: ChatSource) {
  return toResult(() => markChatReadImpl(source));
}

export async function setChatArchived(source: ChatSource, archived: boolean) {
  return toResult(() => setChatArchivedImpl(source, archived));
}

export async function listChats() {
  return toResult(() => listChatsImpl());
}

export async function searchChatTargets(query: string) {
  return toResult(() => searchChatTargetsImpl(query));
}

export async function openDirectChat(userIds: string[]) {
  return toResult(() => openDirectImpl(userIds));
}
