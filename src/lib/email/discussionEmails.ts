import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import type { EmailMessage } from "@/lib/email/transactional";
import { button, emailLayout, esc, siteUrl } from "@/lib/email/notificationEmails";
import { isAttachmentFallback, type ChatSource } from "@/lib/board/discussions";

// E-mail d'une discussion (mention @, nouveau message d'un événement, message direct) : même forme
// que les autres e-mails du board, avec les derniers messages du fil, les nouveaux en évidence, un
// bouton « Répondre » qui ouvre la conversation dans le board et un lien « Répondre » par message
// (réponse à ce message). Plusieurs messages du même fil reçus ensemble = un seul e-mail.

type Service = ReturnType<typeof createServiceClient>;

/** Types de notification envoyés avec le fil de discussion. */
export const DISCUSSION_TYPES = new Set(["event_mentioned", "event_commented", "direct_message"]);

/** Messages du fil affichés dans l'e-mail. */
const THREAD_SIZE = 6;

export function discussionSourceOf(n: { type: string; event_id: string | null; data: Record<string, unknown> | null }): ChatSource | null {
  if (n.type === "direct_message") return typeof n.data?.conversation_id === "string" ? { kind: "direct", id: n.data.conversation_id } : null;
  const eventId = n.event_id ?? (typeof n.data?.event_id === "string" ? n.data.event_id : null);
  return eventId ? { kind: "event", id: eventId } : null;
}

type ThreadMessage = { id: string; authorId: string; authorName: string; body: string; createdAt: string };
export type EmailThread = { title: string; group: boolean; messages: ThreadMessage[] };

const firstNameOf = (name: string) => name.split(" ")[0];

/** Derniers messages d'un fil (lus en service : le destinataire y a été notifié) et titre de la discussion. */
export async function loadThreadForEmail(service: Service, source: ChatSource, recipientId: string): Promise<EmailThread> {
  const rows =
    source.kind === "event"
      ? ((await service.from("event_comments").select("id, author_id, body, created_at").eq("event_id", source.id).order("created_at", { ascending: false }).limit(THREAD_SIZE)).data ?? [])
      : ((await service.from("chat_messages").select("id, author_id, body, created_at").eq("conversation_id", source.id).order("created_at", { ascending: false }).limit(THREAD_SIZE)).data ?? []);
  let title = "";
  let memberIds: string[] = [];
  if (source.kind === "event") {
    const { data: event } = await service.from("events").select("title").eq("id", source.id).maybeSingle();
    title = event?.title ?? "Événement";
  } else {
    const { data: members } = await service.from("chat_conversation_members").select("user_id").eq("conversation_id", source.id);
    memberIds = (members ?? []).map((m) => m.user_id).filter((id) => id !== recipientId);
  }
  const ids = [...new Set([...rows.map((r) => r.author_id), ...memberIds])];
  const { data: people } = ids.length ? await service.from("profiles").select("id, first_name, last_name").in("id", ids) : { data: [] };
  const nameOf = (id: string) => {
    const p = (people ?? []).find((x) => x.id === id);
    return `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Quelqu'un";
  };
  if (source.kind === "direct") {
    const names = memberIds.map(nameOf);
    title =
      names.length <= 1
        ? (names[0] ?? "Discussion")
        : names.length === 2
          ? `${firstNameOf(names[0])} et ${firstNameOf(names[1])}`
          : `${firstNameOf(names[0])}, ${firstNameOf(names[1])} et ${names.length - 2} autre${names.length > 3 ? "s" : ""}`;
  }
  const messages = rows
    .slice()
    .reverse()
    .map((r) => ({ id: r.id, authorId: r.author_id, authorName: r.author_id === recipientId ? "Vous" : nameOf(r.author_id), body: r.body, createdAt: r.created_at }));
  return { title, group: memberIds.length > 1, messages };
}

const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function renderDiscussionEmail({
  type,
  source,
  recipient,
  actor,
  thread,
  newSince,
}: {
  type: string;
  source: ChatSource;
  recipient: { id: string; email: string; firstName: string | null };
  actor: string | null;
  thread: EmailThread;
  /** Messages des autres à partir de cette date : nouveaux (mis en évidence). */
  newSince: string;
}): EmailMessage {
  const site = siteUrl();
  const chatUrl = `${site}/?openChat=${source.kind}:${source.id}`;
  const newCount = thread.messages.filter((m) => m.authorId !== recipient.id && m.createdAt >= newSince).length;
  const who = actor ?? "Quelqu'un";
  const news = newCount > 1 ? `${newCount} nouveaux messages` : "Nouveau message";

  const heading =
    type === "event_mentioned" ? `${who} vous a mentionné` : source.kind === "direct" && !thread.group ? `${who} vous a écrit` : source.kind === "direct" ? `${news} · ${thread.title}` : `${news} dans la discussion`;
  const subject =
    type === "event_mentioned"
      ? `${who} vous a mentionné · ${thread.title}`
      : source.kind === "direct" && !thread.group
        ? `💬 ${who} vous a écrit`
        : `💬 ${who} · ${thread.title}`;

  const context =
    source.kind === "event"
      ? `<p style="font-size:14px;color:#334155;margin:0 0 4px">Discussion de l'événement <strong>${esc(thread.title)}</strong></p>`
      : thread.group
        ? `<p style="font-size:14px;color:#334155;margin:0 0 4px">Discussion de groupe avec <strong>${esc(thread.title)}</strong></p>`
        : "";

  const rows = thread.messages
    .map((m) => {
      const mine = m.authorId === recipient.id;
      const isNew = !mine && m.createdAt >= newSince;
      const body = isAttachmentFallback(m.body) ? `<em>${esc(m.body)}</em> — à ouvrir dans le board` : esc(m.body).replace(/\n/g, "<br>");
      const bg = mine ? "#E8EEF8" : isNew ? "#FFFFFF" : "#F4F6FA";
      const border = isNew ? "#12305F" : bg;
      const badge = isNew
        ? ` <span style="display:inline-block;background:#E1141B;color:#fff;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;margin-left:4px">Nouveau</span>`
        : "";
      const reply = mine ? "" : `<div style="margin:4px 0 0 4px"><a href="${esc(`${chatUrl}&reply=${m.id}`)}" style="font-size:12px;color:#12305F;font-weight:700;text-decoration:none">↩ Répondre</a></div>`;
      return `<tr><td style="padding:0 0 12px">
  <div style="font-size:12px;color:#64748b;margin:0 0 3px"><strong style="color:#0E2A55">${esc(m.authorName)}</strong> · ${esc(when(m.createdAt))}${badge}</div>
  <div style="background:${bg};border:1px solid ${border};border-radius:14px;padding:10px 14px;font-size:15px;line-height:1.45;color:#1e293b">${body}</div>
  ${reply}
</td></tr>`;
    })
    .join("");

  const html = emailLayout({
    firstName: recipient.firstName,
    title: heading,
    body: `${context}<table style="width:100%;border-collapse:collapse;margin:14px 0 4px">${rows}</table>`,
    buttons: `${button("Répondre", chatUrl, "navy")}${source.kind === "event" ? button("Voir l'événement", `${site}/?openEvent=${source.id}`, "ghost") : ""}`,
    footer: `Vous recevez cet e-mail car les notifications par e-mail sont activées dans vos paramètres du board
    (Paramètres → Notifications). <a href="${esc(site)}" style="color:#12305F">Ouvrir le board</a>`,
  });

  const text = [
    `Bonjour${recipient.firstName ? ` ${recipient.firstName}` : ""},`,
    heading,
    source.kind === "event" ? `Discussion de l'événement « ${thread.title} »` : "",
    ...thread.messages.map((m) => `${m.authorName} (${when(m.createdAt)}) :\n${m.body}`),
    `Répondre : ${chatUrl}`,
    "— Board LGEF (Paramètres → Notifications pour gérer ces e-mails)",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { to: [recipient.email], subject, html, text };
}
