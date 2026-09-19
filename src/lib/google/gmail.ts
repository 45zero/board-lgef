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
    maxResults: 25,
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
  subject: string;
  body: string;
  from: string;
  inReplyTo?: string;
  references?: string;
}) {
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject, "utf8").toString("base64")}?=`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`] : []),
    ...(params.references ? [`References: ${params.references}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    params.body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendMessage(
  account: ConnectedAccount,
  params: { to: string; subject: string; body: string }
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
    subject: headerValue(data.message?.payload?.headers, "Subject") || "",
    bodyText: text,
  };
}

export async function saveDraft(
  account: ConnectedAccount,
  params: { draftId?: string; to: string; subject: string; body: string }
) {
  const gmail = await gmailClient(account);
  const raw = buildRawMessage({ to: params.to, subject: params.subject, body: params.body, from: account.email });
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
