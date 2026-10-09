"use server";

import { toResult, unwrap } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { getOwnedGoogleAccount } from "@/lib/google/accounts";
import { getMessage } from "@/lib/google/gmail";
import { attachTeamFilesFromEmail } from "./team-attachments";

// E-mails liés aux cartes de l'Espace Team (sql/2026-10-09_team_card_emails.sql). Le message est
// copié à la liaison (objet, expéditeur, corps) : tous ceux qui voient la carte peuvent le lire,
// sans accès à la boîte Gmail de celui qui l'a lié. Ses pièces jointes, si demandé, deviennent des
// pièces jointes de la carte (Drive du board). La RLS décide : voir la carte → lire, la modifier → lier.

export type TeamCardEmailSummary = {
  id: string;
  subject: string;
  from: string;
  sentAt: string | null;
  snippet: string;
  linkedBy: string | null;
  linkedAt: string;
  accountEmail: string;
  gmailMessageId: string;
  attachmentNames: string[];
};

export type TeamCardEmail = TeamCardEmailSummary & { to: string; cc: string; bodyText: string; bodyHtml: string };

const MAX_TEXT = 100_000;
const MAX_HTML = 300_000;

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return { supabase, userId };
}

const check = <R extends { data: unknown; error: { message: string } | null }>(res: R): NonNullable<R["data"]> => {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<R["data"]>;
};

const attachmentNames = (raw: Json) =>
  Array.isArray(raw) ? raw.flatMap((a) => (a && typeof a === "object" && !Array.isArray(a) && typeof a.filename === "string" ? [a.filename] : [])) : [];

const SUMMARY = "id, subject, from_header, sent_at, snippet, linked_by, linked_at, account_email, gmail_message_id, attachments";

type SummaryRow = {
  id: string;
  subject: string;
  from_header: string;
  sent_at: string | null;
  snippet: string;
  linked_by: string | null;
  linked_at: string;
  account_email: string;
  gmail_message_id: string;
  attachments: Json;
};

const toSummary = (r: SummaryRow): TeamCardEmailSummary => ({
  id: r.id,
  subject: r.subject,
  from: r.from_header,
  sentAt: r.sent_at,
  snippet: r.snippet,
  linkedBy: r.linked_by,
  linkedAt: r.linked_at,
  accountEmail: r.account_email,
  gmailMessageId: r.gmail_message_id,
  attachmentNames: attachmentNames(r.attachments),
});

/** Cartes où je peux lier un e-mail : celles de mes tableaux et celles qui me sont assignées. */
export const searchLinkableTeamCards = async (query: string) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    const [boards, assigned] = await Promise.all([
      supabase.from("team_boards").select("id, title").eq("owner_id", userId).then(check),
      supabase.from("team_card_members").select("card_id").eq("user_id", userId).then(check),
    ]);
    if (!boards.length && !assigned.length) return [];
    const ors = [
      boards.length ? `board_id.in.(${boards.map((b) => b.id).join(",")})` : null,
      assigned.length ? `id.in.(${assigned.map((a) => a.card_id).join(",")})` : null,
    ].filter(Boolean);
    let q = supabase
      .from("team_cards")
      .select("id, title, board_id, updated_at")
      .is("archived_at", null)
      .or(ors.join(","))
      .order("updated_at", { ascending: false })
      .limit(30);
    if (query.trim()) q = q.ilike("title", `%${query.trim().replace(/[%_,()]/g, "")}%`);
    const cards = check(await q);
    const missing = [...new Set(cards.map((c) => c.board_id))].filter((id) => !boards.some((b) => b.id === id));
    const others = missing.length ? check(await supabase.from("team_boards").select("id, title").in("id", missing)) : [];
    const boardTitle = new Map([...boards, ...others].map((b) => [b.id, b.title]));
    return cards.map((c) => ({ id: c.id, title: c.title, boardTitle: boardTitle.get(c.board_id) ?? "" }));
  });

/**
 * Lie un e-mail de ma boîte à une carte (copie du message). Avec copyAttachments, ses pièces jointes
 * sont aussi copiées dans la carte ; renvoie les noms de celles qui n'ont pas pu l'être.
 */
export const linkEmailToTeamCard = async (cardId: string, accountId: string, messageId: string, opts: { copyAttachments: boolean }) =>
  toResult(async (): Promise<{ alreadyLinked: boolean; failedAttachments: string[] }> => {
    const { supabase, userId } = await session();
    const account = await getOwnedGoogleAccount(accountId, userId);
    const m = await getMessage(account, messageId);
    const sent = m.date ? new Date(m.date) : null;
    const html = m.bodyHtml.length <= MAX_HTML ? m.bodyHtml : "";
    const text = (m.bodyText || (html ? "" : m.bodyHtml.replace(/<[^>]+>/g, " "))).slice(0, MAX_TEXT);
    const { error } = await supabase.from("team_card_emails").insert({
      card_id: cardId,
      linked_by: userId,
      account_email: account.email,
      gmail_message_id: m.id,
      gmail_thread_id: m.threadId,
      subject: m.subject,
      from_header: m.from,
      to_header: m.to,
      cc_header: m.cc,
      sent_at: sent && !Number.isNaN(sent.getTime()) ? sent.toISOString() : null,
      snippet: (text || html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 200),
      body_text: text,
      body_html: html,
      attachments: m.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })),
    });
    if (error?.code === "23505") return { alreadyLinked: true, failedAttachments: [] };
    if (error) throw new Error(error.code === "42501" ? "Vous ne pouvez pas modifier cette carte." : error.message);
    const failedAttachments =
      opts.copyAttachments && m.attachments.length
        ? unwrap(await attachTeamFilesFromEmail(cardId, accountId, messageId, m.attachments.map((a) => a.attachmentId)))
        : [];
    return { alreadyLinked: false, failedAttachments };
  });

export const listTeamCardEmails = async (cardId: string) =>
  toResult(async () => {
    const { supabase } = await session();
    const rows = check(await supabase.from("team_card_emails").select(SUMMARY).eq("card_id", cardId).order("sent_at", { ascending: false, nullsFirst: false }));
    return rows.map(toSummary);
  });

export const getTeamCardEmail = async (id: string) =>
  toResult(async (): Promise<TeamCardEmail> => {
    const { supabase } = await session();
    const r = check(await supabase.from("team_card_emails").select(`${SUMMARY}, to_header, cc_header, body_text, body_html`).eq("id", id).maybeSingle());
    if (!r) throw new Error("E-mail introuvable ou non accessible.");
    return { ...toSummary(r), to: r.to_header, cc: r.cc_header, bodyText: r.body_text, bodyHtml: r.body_html };
  });

/** Délie l'e-mail de la carte (les pièces jointes copiées restent dans la carte). */
export const unlinkTeamCardEmail = async (id: string) =>
  toResult(async () => {
    const { supabase } = await session();
    const deleted = check(await supabase.from("team_card_emails").delete().eq("id", id).select("id"));
    if (!deleted.length) throw new Error("Vous ne pouvez pas délier cet e-mail.");
  });
