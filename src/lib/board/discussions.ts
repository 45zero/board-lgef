// Discussions (bulle « Discussions » et onglet Discussion de la fiche événement) : types et
// constantes partagés par les actions serveur (app/actions/chat.ts) et l'interface.
// Deux sortes de discussions : celle d'un événement (event_comments) et la discussion directe
// entre utilisateurs, à deux ou en groupe (chat_messages).

/** Événement navigateur : une discussion a été lue, archivée ou un message envoyé — la bulle se recharge. */
export const DISCUSSIONS_CHANGED = "board:discussions-changed";
/** Événement navigateur : ouvrir la bulle sur une discussion (detail : ChatSource). */
export const OPEN_DISCUSSION = "board:open-discussion";

export type ChatSource = { kind: "event" | "direct"; id: string };
export const sourceKey = (s: ChatSource) => `${s.kind}:${s.id}`;
export function parseSourceKey(key: string | null): ChatSource | null {
  const m = /^(event|direct):([0-9a-f-]{36})$/.exec(key ?? "");
  return m ? { kind: m[1] as ChatSource["kind"], id: m[2] } : null;
}

/** Seule réaction acceptée par la base (event_comment_reactions, chat_message_reactions). */
export const LIKE = "like";

export type ChatPerson = { id: string; name: string; initials: string; avatarUrl: string | null };

export type ChatAttachment = {
  id: string;
  kind: "file" | "image" | "audio";
  filename: string;
  contentType: string | null;
  size: number | null;
  durationMs: number | null;
  /** URL signée (1 h). */
  url: string | null;
};

export type ChatAttachmentInput = {
  path: string;
  filename: string;
  contentType: string | null;
  size: number;
  kind: "file" | "image" | "audio";
  durationMs?: number | null;
};

export type ChatMessage = {
  id: string;
  author: ChatPerson;
  body: string;
  createdAt: string;
  mentions: string[];
  reply: { id: string; authorName: string; body: string } | null;
  /** Personnes qui aiment le message (❤️). */
  likes: { mine: boolean; names: string[] };
  attachments: ChatAttachment[];
};

export type DiscussionThread = {
  source: ChatSource;
  /** Titre de l'événement, ou noms des autres membres d'une discussion directe. */
  title: string;
  /** Date de l'événement (discussion d'événement). */
  startDate: string | null;
  /** Personnes de la discussion (sauf moi), de la plus récente à la plus ancienne. */
  participants: ChatPerson[];
  last: { authorName: string; body: string; at: string; mine: boolean } | null;
  unread: number;
  /** Une mention de moi parmi les non-lus. */
  mentioned: boolean;
  archived: boolean;
};

/** Résultats de la recherche de la bulle : personnes à qui écrire et événements. */
export type ChatSearchResults = {
  people: ChatPerson[];
  events: { id: string; title: string; startDate: string }[];
};

/**
 * Texte d'un message sans texte (vocal ou fichiers seuls) : affiché tel quel par l'appli
 * calendrier-lgef, les notifications et l'aperçu de la bulle ; masqué dans la conversation.
 */
export function attachmentFallback(attachments: { kind: string; filename: string }[]) {
  if (!attachments.length) return "";
  if (attachments.some((a) => a.kind === "audio")) return "🎤 Message vocal";
  if (attachments.every((a) => a.kind === "image")) return attachments.length > 1 ? `📷 ${attachments.length} photos` : "📷 Photo";
  return attachments.length > 1 ? `📎 ${attachments.length} fichiers` : `📎 ${attachments[0].filename}`;
}
export const isAttachmentFallback = (body: string) => /^(🎤 Message vocal|📷 (\d+ photos|Photo)|📎 .+)$/.test(body);
