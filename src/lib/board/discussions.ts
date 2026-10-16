// Discussions des événements : types et constantes partagés par les actions serveur
// (app/actions/event-comments.ts), la bulle « Discussions » et l'onglet Discussion de la fiche.

/** Événement navigateur : une discussion a été lue, archivée ou un message envoyé — la bulle se recharge. */
export const DISCUSSIONS_CHANGED = "board:discussions-changed";

/** Réactions — mêmes clés que l'appli calendrier-lgef (event_comment_reactions.type). */
export const REACTIONS = [
  { key: "like", label: "❤️" },
  { key: "thumbs_up", label: "👍" },
  { key: "smile", label: "😊" },
  { key: "party", label: "🎉" },
  { key: "clap", label: "👏" },
] as const;
export const REACTION_KEYS: string[] = REACTIONS.map((r) => r.key);
export const reactionLabel = (key: string) => REACTIONS.find((r) => r.key === key)?.label ?? "❤️";

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
  reactions: { type: string; count: number; mine: boolean; names: string[] }[];
  attachments: ChatAttachment[];
};

export type DiscussionThread = {
  eventId: string;
  title: string;
  startDate: string | null;
  /** Personnes de la discussion (sauf moi), de la plus récente à la plus ancienne. */
  participants: ChatPerson[];
  last: { authorName: string; body: string; at: string; mine: boolean };
  unread: number;
  /** Une mention de moi parmi les non-lus. */
  mentioned: boolean;
  archived: boolean;
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
