import "server-only";
import { google, gmail_v1 } from "googleapis";
import { createOAuth2Client } from "@/lib/google/oauth";
import { getValidGoogleAccessToken } from "@/lib/google/accounts";
import type { ConnectedAccount } from "@/generated/prisma";

async function gmailClient(account: ConnectedAccount) {
  const accessToken = await getValidGoogleAccessToken(account);
  const auth = createOAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

export const SYSTEM_LABELS = {
  inbox: "INBOX",
  sent: "SENT",
  spam: "SPAM",
  trash: "TRASH",
} as const;

export interface MailListItem {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  labelIds: string[];
  hasAttachments: boolean;
}

export interface AttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

function headerValue(headers: { name?: string | null; value?: string | null }[] | undefined, name: string) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function listMessages(
  account: ConnectedAccount,
  opts: { pageToken?: string; query?: string; labelIds?: string[] } = {}
) {
  const gmail = await gmailClient(account);

  const list = await gmail.users.messages.list({
    userId: "me",
    maxResults: 15,
    pageToken: opts.pageToken,
    q: opts.query,
    labelIds: opts.labelIds,
  });

  const ids = list.data.messages ?? [];
  const messages = await Promise.all(
    ids.map(async (m) => {
      const { data } = await gmail.users.messages.get({
        userId: "me",
        id: m.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });
      const item: MailListItem = {
        id: data.id!,
        threadId: data.threadId!,
        from: headerValue(data.payload?.headers, "From"),
        subject: headerValue(data.payload?.headers, "Subject") || "(sans objet)",
        snippet: data.snippet ?? "",
        date: headerValue(data.payload?.headers, "Date"),
        unread: (data.labelIds ?? []).includes("UNREAD"),
        labelIds: data.labelIds ?? [],
        hasAttachments: (data.payload?.parts ?? []).some((p) => !!p.filename),
      };
      return item;
    })
  );

  return { messages, nextPageToken: list.data.nextPageToken ?? null };
}

function decodeBody(data?: string | null) {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

function findBody(part: gmail_v1.Schema$MessagePart): { text: string; html: string } {
  let text = "";
  let html = "";
  if (part.mimeType === "text/plain" && part.body?.data) text = decodeBody(part.body.data);
  if (part.mimeType === "text/html" && part.body?.data) html = decodeBody(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findBody(child);
    text ||= found.text;
    html ||= found.html;
  }
  return { text, html };
}

function findAttachments(part: gmail_v1.Schema$MessagePart): AttachmentMeta[] {
  const found: AttachmentMeta[] = [];
  if (part.filename && part.body?.attachmentId) {
    found.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body.size ?? 0,
    });
  }
  for (const child of part.parts ?? []) {
    found.push(...findAttachments(child));
  }
  return found;
}

export async function getMessage(account: ConnectedAccount, messageId: string) {
  const gmail = await gmailClient(account);
  const { data } = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const { text, html } = findBody(data.payload ?? {});
  const attachments = findAttachments(data.payload ?? {});

  return {
    id: data.id!,
    threadId: data.threadId!,
    from: headerValue(data.payload?.headers, "From"),
    to: headerValue(data.payload?.headers, "To"),
    cc: headerValue(data.payload?.headers, "Cc"),
    subject: headerValue(data.payload?.headers, "Subject") || "(sans objet)",
    date: headerValue(data.payload?.headers, "Date"),
    messageIdHeader: headerValue(data.payload?.headers, "Message-ID"),
    referencesHeader: headerValue(data.payload?.headers, "References"),
    bodyText: text,
    bodyHtml: html,
    labelIds: data.labelIds ?? [],
    attachments,
  };
}

export async function getAttachment(account: ConnectedAccount, messageId: string, attachmentId: string) {
  const gmail = await gmailClient(account);
  const { data } = await gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
  return { data: data.data ?? "", size: data.size ?? 0 };
}

export async function trashMessage(account: ConnectedAccount, messageId: string) {
  const gmail = await gmailClient(account);
  await gmail.users.messages.trash({ userId: "me", id: messageId });
}

export async function untrashMessage(account: ConnectedAccount, messageId: string) {
  const gmail = await gmailClient(account);
  await gmail.users.messages.untrash({ userId: "me", id: messageId });
}

export async function modifyMessageLabels(
  account: ConnectedAccount,
  messageId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] }
) {
  const gmail = await gmailClient(account);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: changes.addLabelIds, removeLabelIds: changes.removeLabelIds },
  });
}

export interface LabelItem {
  id: string;
  name: string;
}

/** Nombre de mails non lus dans la boîte de réception (compteur du rail/dock). */
export async function getInboxUnreadCount(account: ConnectedAccount): Promise<number> {
  const gmail = await gmailClient(account);
  const { data } = await gmail.users.labels.get({ userId: "me", id: "INBOX" });
  return data.messagesUnread ?? 0;
}

export async function listLabels(account: ConnectedAccount): Promise<LabelItem[]> {
  const gmail = await gmailClient(account);
  const { data } = await gmail.users.labels.list({ userId: "me" });
  return (data.labels ?? [])
    .filter((l) => l.type === "user")
    .map((l) => ({ id: l.id!, name: l.name! }));
}

export async function createLabel(account: ConnectedAccount, name: string): Promise<LabelItem> {
  const gmail = await gmailClient(account);
  const { data } = await gmail.users.labels.create({ userId: "me", requestBody: { name } });
  return { id: data.id!, name: data.name! };
}

export async function deleteLabel(account: ConnectedAccount, labelId: string) {
  const gmail = await gmailClient(account);
  await gmail.users.labels.delete({ userId: "me", id: labelId });
}

function buildRawMessage(params: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: string;
  from: string;
  inReplyTo?: string;
  references?: string;
}) {
  const headerLines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    ...(params.bcc ? [`Bcc: ${params.bcc}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(params.subject, "utf8").toString("base64")}?=`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`] : []),
    ...(params.references ? [`References: ${params.references}`] : []),
    "MIME-Version: 1.0",
  ];

  let lines: string[];
  if (params.html) {
    const boundary = `----=_Part_${Date.now()}`;
    lines = [
      ...headerLines,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      params.body,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      params.html,
      "",
      `--${boundary}--`,
    ];
  } else {
    lines = [...headerLines, "Content-Type: text/plain; charset=UTF-8", "", params.body];
  }

  return Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendMessage(
  account: ConnectedAccount,
  params: { to: string; cc?: string; bcc?: string; subject: string; body: string; html?: string }
) {
  const gmail = await gmailClient(account);
  const raw = buildRawMessage({ ...params, from: account.email });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

export async function replyToMessage(account: ConnectedAccount, messageId: string, params: { body: string }) {
  const original = await getMessage(account, messageId);
  const gmail = await gmailClient(account);
  const subject = /^re\s*:/i.test(original.subject) ? original.subject : `Re : ${original.subject}`;
  const references = [original.referencesHeader, original.messageIdHeader].filter(Boolean).join(" ");
  const raw = buildRawMessage({
    to: original.from,
    subject,
    body: params.body,
    from: account.email,
    inReplyTo: original.messageIdHeader || undefined,
    references: references || undefined,
  });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: original.threadId } });
}

interface ForwardPart {
  mimeType: string;
  filename: string;
  contentId: string | null;
  data: Buffer;
}

/** Parties « fichier » de l'original (images intégrées cid: et pièces jointes) — tout sauf les corps texte/HTML. */
function collectFileParts(part: gmail_v1.Schema$MessagePart, out: gmail_v1.Schema$MessagePart[] = []) {
  const isBody = !part.filename && (part.mimeType === "text/plain" || part.mimeType === "text/html");
  const isLeaf = !part.parts?.length;
  if (isLeaf && !isBody && (part.body?.attachmentId || part.body?.data)) out.push(part);
  for (const child of part.parts ?? []) collectFileParts(child, out);
  return out;
}

function escapeHtmlText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** En-tête MIME encodé RFC 2047 si non-ASCII (noms de fichiers accentués). */
function mimeWord(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? s.replace(/"/g, "'") : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function base64Lines(data: Buffer) {
  return (data.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

/**
 * Transfert complet, comme Gmail : version HTML de l'original (images comprises),
 * images intégrées (cid:) et pièces jointes réattachées. Envoi en upload média
 * (message/rfc822) pour ne pas être bridé par la taille du corps JSON.
 */
export async function forwardMessage(
  account: ConnectedAccount,
  messageId: string,
  params: { to: string; body: string }
) {
  const gmail = await gmailClient(account);
  const { data: full } = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const payload = full.payload ?? {};
  const headers = payload.headers;
  const originalSubject = headerValue(headers, "Subject") || "(sans objet)";
  const from = headerValue(headers, "From");
  const date = headerValue(headers, "Date");
  const to = headerValue(headers, "To");
  const cc = headerValue(headers, "Cc");
  const { text, html } = findBody(payload);

  const subject = /^fwd?\s*:/i.test(originalSubject) ? originalSubject : `Fwd : ${originalSubject}`;
  const headerBlockText = [
    "---------- Message transféré ----------",
    `De : ${from}`,
    `Date : ${date}`,
    `Objet : ${originalSubject}`,
    `À : ${to}`,
    ...(cc ? [`Cc : ${cc}`] : []),
  ];
  const plain = [params.body, "", ...headerBlockText, "", text || ""].join("\n");

  const noteHtml = params.body.trim()
    ? `<div>${escapeHtmlText(params.body).replace(/\n/g, "<br>")}</div><br>`
    : "";
  const headerBlockHtml = `<div style="color:#555;">---------- Message transféré ----------<br>
De : ${escapeHtmlText(from)}<br>
Date : ${escapeHtmlText(date)}<br>
Objet : ${escapeHtmlText(originalSubject)}<br>
À : ${escapeHtmlText(to)}${cc ? `<br>\nCc : ${escapeHtmlText(cc)}` : ""}</div><br>`;
  const originalHtml = html || `<div style="white-space:pre-wrap;">${escapeHtmlText(text || "")}</div>`;
  const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>${noteHtml}${headerBlockHtml}${originalHtml}</body></html>`;

  const files: ForwardPart[] = await Promise.all(
    collectFileParts(payload).map(async (p) => {
      let b64 = p.body?.data ?? "";
      if (p.body?.attachmentId) {
        const { data } = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: p.body.attachmentId,
        });
        b64 = data.data ?? "";
      }
      const rawCid = headerValue(p.headers, "Content-ID") || headerValue(p.headers, "X-Attachment-Id");
      return {
        mimeType: p.mimeType ?? "application/octet-stream",
        filename: p.filename || "",
        contentId: rawCid ? rawCid.replace(/^<|>$/g, "") : null,
        data: Buffer.from(b64, "base64url"),
      };
    })
  );
  // Image intégrée = référencée par cid: dans le HTML ; tout le reste part en pièce jointe classique.
  const inline = files.filter((f) => f.contentId && originalHtml.includes(`cid:${f.contentId}`));
  const attached = files.filter((f) => !inline.includes(f));

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const bMixed = `mixed_${stamp}`;
  const bRelated = `related_${stamp}`;
  const bAlt = `alt_${stamp}`;

  const filePart = (f: ForwardPart, disposition: "inline" | "attachment") => {
    const name = f.filename ? `; name="${mimeWord(f.filename)}"` : "";
    const fname = f.filename ? `; filename="${mimeWord(f.filename)}"` : "";
    return [
      `Content-Type: ${f.mimeType}${name}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: ${disposition}${fname}`,
      ...(f.contentId ? [`Content-ID: <${f.contentId}>`] : []),
      "",
      base64Lines(f.data),
    ].join("\r\n");
  };

  const alternative = [
    `Content-Type: multipart/alternative; boundary="${bAlt}"`,
    "",
    `--${bAlt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(plain, "utf8")),
    `--${bAlt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(fullHtml, "utf8")),
    `--${bAlt}--`,
  ].join("\r\n");

  const related = inline.length
    ? [
        `Content-Type: multipart/related; boundary="${bRelated}"`,
        "",
        `--${bRelated}`,
        alternative,
        ...inline.flatMap((f) => [`--${bRelated}`, filePart(f, "inline")]),
        `--${bRelated}--`,
      ].join("\r\n")
    : alternative;

  const bodyPart = attached.length
    ? [
        `Content-Type: multipart/mixed; boundary="${bMixed}"`,
        "",
        `--${bMixed}`,
        related,
        ...attached.flatMap((f) => [`--${bMixed}`, filePart(f, "attachment")]),
        `--${bMixed}--`,
      ].join("\r\n")
    : related;

  const mime = [
    `From: ${account.email}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    bodyPart,
  ].join("\r\n");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {},
    media: { mimeType: "message/rfc822", body: mime },
  });
}

/** Archiver = retirer le libellé INBOX (le message reste accessible, contrairement à la corbeille). */
export async function archiveMessage(account: ConnectedAccount, messageId: string) {
  await modifyMessageLabels(account, messageId, { removeLabelIds: ["INBOX"] });
}

// --- Brouillons ---

export interface DraftListItem {
  id: string;
  messageId: string;
  to: string;
  subject: string;
  snippet: string;
}

export async function listDrafts(account: ConnectedAccount, opts: { pageToken?: string } = {}) {
  const gmail = await gmailClient(account);
  const list = await gmail.users.drafts.list({ userId: "me", maxResults: 25, pageToken: opts.pageToken });
  const ids = list.data.drafts ?? [];
  const drafts = await Promise.all(
    ids.map(async (d) => {
      const { data } = await gmail.users.drafts.get({ userId: "me", id: d.id!, format: "metadata" });
      const item: DraftListItem = {
        id: data.id!,
        messageId: data.message?.id ?? "",
        to: headerValue(data.message?.payload?.headers, "To"),
        subject: headerValue(data.message?.payload?.headers, "Subject") || "(sans objet)",
        snippet: data.message?.snippet ?? "",
      };
      return item;
    })
  );
  return { drafts, nextPageToken: list.data.nextPageToken ?? null };
}

export async function getDraft(account: ConnectedAccount, draftId: string) {
  const gmail = await gmailClient(account);
  const { data } = await gmail.users.drafts.get({ userId: "me", id: draftId, format: "full" });
  const { text } = findBody(data.message?.payload ?? {});
  return {
    id: data.id!,
    to: headerValue(data.message?.payload?.headers, "To"),
    cc: headerValue(data.message?.payload?.headers, "Cc"),
    subject: headerValue(data.message?.payload?.headers, "Subject") || "",
    bodyText: text,
  };
}

export async function saveDraft(
  account: ConnectedAccount,
  params: { draftId?: string; to: string; cc?: string; bcc?: string; subject: string; body: string }
) {
  const gmail = await gmailClient(account);
  const raw = buildRawMessage({
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    from: account.email,
  });
  if (params.draftId) {
    await gmail.users.drafts.update({ userId: "me", id: params.draftId, requestBody: { message: { raw } } });
    return params.draftId;
  }
  const { data } = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
  return data.id!;
}

export async function sendDraft(account: ConnectedAccount, draftId: string) {
  const gmail = await gmailClient(account);
  await gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
}

export async function deleteDraft(account: ConnectedAccount, draftId: string) {
  const gmail = await gmailClient(account);
  await gmail.users.drafts.delete({ userId: "me", id: draftId });
}
