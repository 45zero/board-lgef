import "server-only";
import type { ImapFlow, MessageStructureObject, SearchObject } from "imapflow";
import { simpleParser, type ParsedMail, type AddressObject, type Attachment } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type Mail from "nodemailer/lib/mailer";
import type { ConnectedAccount } from "@/generated/prisma";
import { ICLOUD_SMTP, icloudCredentials, withImap } from "@/lib/icloud/client";
import type { AttachmentMeta, DraftListItem, LabelItem, MailListItem, NewInboxMail } from "@/lib/google/gmail";

// Mail iCloud (IMAP imap.mail.me.com, SMTP smtp.mail.me.com) avec les mêmes formes de données que
// Gmail (lib/google/gmail.ts) : le module Mails ne voit pas la différence (voir lib/mail).
//
// Identifiant d'un mail : « dossier.uid » (dossier en base64url) — un UID IMAP n'a de sens que dans
// son dossier. Libellés système de Gmail traduits en dossiers iCloud : INBOX, SENT → « Sent
// Messages », SPAM → « Junk », TRASH → « Deleted Messages », DRAFTS, archivage → « Archive ».
// Les autres dossiers iCloud jouent le rôle des libellés.

const PAGE = 25;

export const encodeId = (folder: string, uid: number | bigint) => `${Buffer.from(folder, "utf8").toString("base64url")}.${uid}`;
export function decodeId(id: string) {
  const dot = id.lastIndexOf(".");
  const folder = Buffer.from(id.slice(0, dot), "base64url").toString("utf8");
  const uid = Number(id.slice(dot + 1));
  if (!folder || !Number.isFinite(uid)) throw new Error("Identifiant de mail iCloud invalide");
  return { folder, uid };
}

type Special = "INBOX" | "SENT" | "SPAM" | "TRASH" | "DRAFTS" | "ARCHIVE";
const SPECIAL_USE: Record<Exclude<Special, "INBOX">, { flag: string; fallback: string }> = {
  SENT: { flag: "\\Sent", fallback: "Sent Messages" },
  SPAM: { flag: "\\Junk", fallback: "Junk" },
  TRASH: { flag: "\\Trash", fallback: "Deleted Messages" },
  DRAFTS: { flag: "\\Drafts", fallback: "Drafts" },
  ARCHIVE: { flag: "\\Archive", fallback: "Archive" },
};

async function folders(client: ImapFlow) {
  const list = await client.list();
  const bySpecial = new Map(list.filter((m) => m.specialUse).map((m) => [m.specialUse!, m.path]));
  const path = (k: Special) => (k === "INBOX" ? "INBOX" : (bySpecial.get(SPECIAL_USE[k].flag) ?? SPECIAL_USE[k].fallback));
  const systemPaths = new Set<string>(["INBOX", ...(["SENT", "SPAM", "TRASH", "DRAFTS", "ARCHIVE"] as const).map(path)]);
  const labels: LabelItem[] = list
    .filter((m) => !systemPaths.has(m.path) && !m.specialUse && !m.flags.has("\\Noselect") && m.path.toUpperCase() !== "INBOX")
    .map((m) => ({ id: m.path, name: m.path }));
  return { path, labels };
}

/** Dossier IMAP d'un libellé de la liste (INBOX, SENT… ou chemin de dossier). */
async function folderOf(client: ImapFlow, label: string | undefined) {
  const key = (label ?? "INBOX").toUpperCase();
  if (key === "INBOX") return "INBOX";
  if (key in SPECIAL_USE) return (await folders(client)).path(key as Special);
  return label!;
}

const addr = (a?: { name?: string; address?: string }) => (a ? (a.name ? `"${a.name.replace(/"/g, "'")}" <${a.address ?? ""}>` : (a.address ?? "")) : "");
const addrText = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a.map((x) => x.text).join(", ") : (a?.text ?? ""));
const toDate = (d?: Date | string) => (d ? new Date(d) : new Date(0));

/** Requête de la barre de recherche (et des filtres façon Gmail du tableau de bord) en critères IMAP. */
function searchCriteria(query?: string): SearchObject {
  let rest = (query ?? "").trim();
  const criteria: SearchObject = {};
  if (/\bis:unread\b/i.test(rest)) criteria.seen = false;
  rest = rest.replace(/\b(is:unread|category:\w+|in:\w+)\b/gi, "").trim();
  if (rest) criteria.or = [{ subject: rest }, { from: rest }, { body: rest }];
  if (!Object.keys(criteria).length) criteria.all = true;
  return criteria;
}

/* ---------- Aperçu (snippet) : début de la partie texte, sans télécharger tout le mail ---------- */

function textPart(node: MessageStructureObject | undefined): MessageStructureObject | null {
  if (!node) return null;
  const isAttachment = node.disposition === "attachment" || !!node.dispositionParameters?.filename;
  if (!node.childNodes?.length) return !isAttachment && (node.type === "text/plain" || node.type === "text/html") ? node : null;
  let html: MessageStructureObject | null = null;
  for (const child of node.childNodes) {
    const found = textPart(child);
    if (found?.type === "text/plain") return found;
    html ??= found;
  }
  return html;
}

function hasAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.disposition === "attachment" || (node.dispositionParameters?.filename && node.disposition !== "inline")) return true;
  return (node.childNodes ?? []).some(hasAttachment);
}

function decodePart(raw: Buffer, node: MessageStructureObject) {
  let bytes = raw;
  const enc = (node.encoding ?? "").toLowerCase();
  if (enc === "base64") {
    const s = raw.toString("ascii").replace(/[^A-Za-z0-9+/=]/g, "");
    bytes = Buffer.from(s.slice(0, s.length - (s.length % 4)), "base64");
  } else if (enc === "quoted-printable") {
    const s = raw.toString("latin1").replace(/=\r?\n/g, "");
    bytes = Buffer.from(s.replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
  }
  let text: string;
  try {
    text = new TextDecoder(node.parameters?.charset || "utf-8").decode(bytes);
  } catch {
    text = bytes.toString("utf8");
  }
  if (node.type === "text/html") {
    text = text
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"');
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Début de la partie texte de chaque mail (1,5 ko au plus), sur la connexion déjà ouverte. */
async function snippets(client: ImapFlow, items: { uid: number; node: MessageStructureObject | null }[]) {
  const out = new Map<number, string>();
  for (const { uid, node } of items) {
    if (!node) continue;
    const key = node.part ?? "1";
    const msg = await client.fetchOne(String(uid), { uid: true, bodyParts: [{ key, maxLength: 1500 }] }, { uid: true }).catch(() => false as const);
    const raw = msg ? msg.bodyParts?.get(key) : undefined;
    if (raw) out.set(uid, decodePart(raw, node));
  }
  return out;
}

type Summary = { uid: number; from: string; to: string; subject: string; date: Date; unread: boolean; hasAttachments: boolean; node: MessageStructureObject | null };

async function summaries(client: ImapFlow, uids: number[]): Promise<Summary[]> {
  if (!uids.length) return [];
  const rows: Summary[] = [];
  for await (const m of client.fetch(uids, { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true }, { uid: true })) {
    rows.push({
      uid: m.uid,
      from: addr(m.envelope?.from?.[0]),
      to: (m.envelope?.to ?? []).map(addr).join(", "),
      subject: m.envelope?.subject || "(sans objet)",
      date: toDate(m.envelope?.date ?? m.internalDate),
      unread: !m.flags?.has("\\Seen"),
      hasAttachments: hasAttachment(m.bodyStructure),
      node: textPart(m.bodyStructure),
    });
  }
  return rows.sort((a, b) => b.uid - a.uid);
}

/* ---------- Liste, lecture ---------- */

export async function listMessages(account: ConnectedAccount, opts: { pageToken?: string; query?: string; labelIds?: string[] } = {}) {
  const label = opts.labelIds?.[0] ?? "INBOX";
  return withImap(account, async (client) => {
    const folder = await folderOf(client, label);
    const lock = await client.getMailboxLock(folder);
    try {
      const found = ((await client.search(searchCriteria(opts.query), { uid: true })) || []) as number[];
      const all = [...found].sort((a, b) => b - a);
      const offset = Number(opts.pageToken ?? 0) || 0;
      const page = all.slice(offset, offset + PAGE);
      const rows = await summaries(client, page);
      const snips = await snippets(client, rows);
      const messages: MailListItem[] = rows.map((r) => ({
        id: encodeId(folder, r.uid),
        threadId: encodeId(folder, r.uid),
        from: r.from,
        subject: r.subject,
        snippet: snips.get(r.uid) ?? "",
        date: r.date.toISOString(),
        unread: r.unread,
        labelIds: [label, ...(r.unread ? ["UNREAD"] : [])],
        hasAttachments: r.hasAttachments,
      }));
      return { messages, nextPageToken: offset + PAGE < all.length ? String(offset + PAGE) : null };
    } finally {
      lock.release();
    }
  });
}

async function downloadParsed(client: ImapFlow, folder: string, uid: number): Promise<ParsedMail> {
  const lock = await client.getMailboxLock(folder);
  try {
    const dl = await client.download(String(uid), undefined, { uid: true });
    if (!dl.content) throw new Error("Mail introuvable (déplacé ou supprimé ?)");
    const chunks: Buffer[] = [];
    for await (const c of dl.content) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return await simpleParser(Buffer.concat(chunks));
  } finally {
    lock.release();
  }
}

const parsedOf = (account: ConnectedAccount, messageId: string) => {
  const { folder, uid } = decodeId(messageId);
  return withImap(account, (client) => downloadParsed(client, folder, uid));
};

/** Pièces jointes affichées : hors images intégrées au HTML (cid:), déjà remplacées dans le corps par mailparser. */
const visibleAttachments = (parsed: ParsedMail) =>
  parsed.attachments.map((a, i) => ({ a, i })).filter(({ a }) => !a.related && !(a.contentDisposition === "inline" && a.cid));

export async function getMessage(account: ConnectedAccount, messageId: string) {
  const parsed = await parsedOf(account, messageId);
  const attachments: AttachmentMeta[] = visibleAttachments(parsed).map(({ a, i }) => ({
    attachmentId: String(i),
    filename: a.filename || `piece-jointe-${i + 1}`,
    mimeType: a.contentType || "application/octet-stream",
    size: a.size ?? a.content.length,
  }));
  const refs = parsed.references;
  return {
    id: messageId,
    threadId: messageId,
    from: addrText(parsed.from),
    to: addrText(parsed.to),
    cc: addrText(parsed.cc),
    subject: parsed.subject || "(sans objet)",
    // Format d'en-tête (comme Gmail) : relu par new Date() (cartes Team, tri).
    date: parsed.date ? parsed.date.toUTCString() : "",
    messageIdHeader: parsed.messageId ?? "",
    referencesHeader: Array.isArray(refs) ? refs.join(" ") : (refs ?? ""),
    bodyText: parsed.text ?? "",
    bodyHtml: typeof parsed.html === "string" ? parsed.html : "",
    labelIds: [] as string[],
    attachments,
  };
}

export async function getAttachment(account: ConnectedAccount, messageId: string, attachmentId: string) {
  const parsed = await parsedOf(account, messageId);
  const a = parsed.attachments[Number(attachmentId)];
  if (!a) throw new Error("Pièce jointe introuvable");
  return { data: a.content.toString("base64url"), size: a.content.length };
}

/* ---------- Actions ---------- */

async function inFolder<T>(account: ConnectedAccount, messageId: string, fn: (client: ImapFlow, uid: number) => Promise<T>) {
  const { folder, uid } = decodeId(messageId);
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      return await fn(client, uid);
    } finally {
      lock.release();
    }
  });
}

async function moveTo(account: ConnectedAccount, messageId: string, target: Special) {
  await inFolder(account, messageId, async (client, uid) => {
    const dest = (await folders(client)).path(target);
    await client.messageMove(String(uid), dest, { uid: true });
  });
}

export const archiveMessage = (account: ConnectedAccount, messageId: string) => moveTo(account, messageId, "ARCHIVE");
export const trashMessage = (account: ConnectedAccount, messageId: string) => moveTo(account, messageId, "TRASH");
export const untrashMessage = (account: ConnectedAccount, messageId: string) => moveTo(account, messageId, "INBOX");

/** Libellés façon Gmail : UNREAD = drapeau \Seen inversé, retrait d'INBOX = archivage, autre libellé = copie dans le dossier. */
export async function modifyMessageLabels(account: ConnectedAccount, messageId: string, changes: { addLabelIds?: string[]; removeLabelIds?: string[] }) {
  const add = changes.addLabelIds ?? [];
  const remove = changes.removeLabelIds ?? [];
  await inFolder(account, messageId, async (client, uid) => {
    if (remove.includes("UNREAD")) await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    if (add.includes("UNREAD")) await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
    for (const label of add.filter((l) => l !== "UNREAD" && l !== "INBOX")) await client.messageCopy(String(uid), label, { uid: true });
  });
  if (remove.includes("INBOX")) await archiveMessage(account, messageId);
}

export async function getInboxUnreadCount(account: ConnectedAccount): Promise<number> {
  return withImap(account, async (client) => {
    const status = await client.status("INBOX", { unseen: true });
    return status ? (status.unseen ?? 0) : 0;
  });
}

export async function markAllInboxRead(account: ConnectedAccount): Promise<number> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = ((await client.search({ seen: false }, { uid: true })) || []) as number[];
      if (uids.length) await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      return uids.length;
    } finally {
      lock.release();
    }
  });
}

export async function listLabels(account: ConnectedAccount): Promise<LabelItem[]> {
  return withImap(account, async (client) => (await folders(client)).labels);
}

export async function createLabel(account: ConnectedAccount, name: string): Promise<LabelItem> {
  return withImap(account, async (client) => {
    const res = await client.mailboxCreate(name);
    return { id: res.path, name: res.path };
  });
}

export async function deleteLabel(account: ConnectedAccount, labelId: string) {
  await withImap(account, (client) => client.mailboxDelete(labelId));
}

/* ---------- Envoi (SMTP) : copie dans « Envoyés », iCloud ne la fait pas pour les applis tierces ---------- */

type ComposeOptions = Mail.Options & { keepBcc?: boolean };
const build = (opts: ComposeOptions) => new MailComposer(opts).compile().build();

function transport(account: ConnectedAccount) {
  return nodemailer.createTransport({ ...ICLOUD_SMTP, requireTLS: true, auth: icloudCredentials(account) });
}

const splitAddresses = (s?: string) => (s ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);

async function sendAndKeep(account: ConnectedAccount, opts: Mail.Options) {
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@board.lgef.fr>`;
  const full: Mail.Options = { ...opts, from: account.email, messageId };
  await transport(account).sendMail(full);
  // Copie « Envoyés » (Cci gardé, comme dans Mail d'Apple) ; un échec ici n'annule pas l'envoi.
  const raw = await build({ ...full, keepBcc: true });
  await withImap(account, async (client) => {
    await client.append((await folders(client)).path("SENT"), raw, ["\\Seen"]);
  }).catch((e) => console.error("[icloud] copie Envoyés", e));
}

export async function sendMessage(
  account: ConnectedAccount,
  params: { to: string; cc?: string; bcc?: string; subject: string; body: string; html?: string; replyTo?: string }
) {
  await sendAndKeep(account, {
    to: splitAddresses(params.to),
    cc: splitAddresses(params.cc),
    bcc: splitAddresses(params.bcc),
    subject: params.subject,
    text: params.body,
    html: params.html,
    replyTo: params.replyTo,
  });
}

export async function replyToMessage(account: ConnectedAccount, messageId: string, params: { body: string }) {
  const parsed = await parsedOf(account, messageId);
  const subject = parsed.subject ?? "";
  const previous = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
  await sendAndKeep(account, {
    to: addrText(parsed.replyTo) || addrText(parsed.from),
    subject: /^re\s*:/i.test(subject) ? subject : `Re : ${subject}`,
    text: params.body,
    inReplyTo: parsed.messageId,
    references: [...previous, ...(parsed.messageId ? [parsed.messageId] : [])],
  });
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Transfert complet : message ajouté, original en HTML (images comprises) et pièces jointes réattachées. */
export async function forwardMessage(account: ConnectedAccount, messageId: string, params: { to: string; body: string }) {
  const parsed = await parsedOf(account, messageId);
  const header = [
    "---------- Message transféré ----------",
    `De : ${addrText(parsed.from)}`,
    `Date : ${parsed.date?.toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) ?? ""}`,
    `Objet : ${parsed.subject ?? ""}`,
    `À : ${addrText(parsed.to)}`,
    ...(parsed.cc ? [`Cc : ${addrText(parsed.cc)}`] : []),
  ];
  const originalHtml = typeof parsed.html === "string" && parsed.html ? parsed.html : `<pre>${escapeHtml(parsed.text ?? "")}</pre>`;
  const subject = parsed.subject ?? "";
  await sendAndKeep(account, {
    to: splitAddresses(params.to),
    subject: /^(tr|fwd?)\s*:/i.test(subject) ? subject : `Tr : ${subject}`,
    text: [params.body, "", ...header, "", parsed.text ?? ""].join("\n"),
    html: `<div>${escapeHtml(params.body).replace(/\n/g, "<br>")}</div><br><div>${header.map(escapeHtml).join("<br>")}</div><br>${originalHtml}`,
    attachments: parsed.attachments.map((a: Attachment) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
      cid: a.related ? a.cid : undefined,
    })),
  });
}

/* ---------- Brouillons (dossier « Drafts ») ---------- */

export async function listDrafts(account: ConnectedAccount) {
  return withImap(account, async (client) => {
    const folder = (await folders(client)).path("DRAFTS");
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = (((await client.search({ all: true }, { uid: true })) || []) as number[]).sort((a, b) => b - a).slice(0, PAGE);
      const rows = await summaries(client, uids);
      const drafts: DraftListItem[] = rows.map((r) => ({ id: encodeId(folder, r.uid), messageId: encodeId(folder, r.uid), to: r.to, subject: r.subject, snippet: "" }));
      return { drafts, nextPageToken: null as string | null };
    } finally {
      lock.release();
    }
  });
}

export async function getDraft(account: ConnectedAccount, draftId: string) {
  const parsed = await parsedOf(account, draftId);
  return { id: draftId, to: addrText(parsed.to), cc: addrText(parsed.cc), subject: parsed.subject ?? "", bodyText: parsed.text ?? "" };
}

export async function deleteDraft(account: ConnectedAccount, draftId: string) {
  await inFolder(account, draftId, (client, uid) => client.messageDelete(String(uid), { uid: true }));
}

export async function saveDraft(account: ConnectedAccount, params: { draftId?: string; to: string; cc?: string; bcc?: string; subject: string; body: string }) {
  const raw = await build({
    from: account.email,
    to: splitAddresses(params.to),
    cc: splitAddresses(params.cc),
    bcc: splitAddresses(params.bcc),
    subject: params.subject,
    text: params.body,
    keepBcc: true,
  });
  const id = await withImap(account, async (client) => {
    const folder = (await folders(client)).path("DRAFTS");
    const res = await client.append(folder, raw, ["\\Draft", "\\Seen"]);
    if (!res || res.uid === undefined) throw new Error("Brouillon enregistré, mais iCloud n'a pas renvoyé son identifiant.");
    return encodeId(folder, res.uid);
  });
  if (params.draftId) await deleteDraft(account, params.draftId).catch(() => undefined);
  return id;
}

export async function sendDraft(account: ConnectedAccount, draftId: string) {
  const parsed = await parsedOf(account, draftId);
  await sendAndKeep(account, {
    to: splitAddresses(addrText(parsed.to)),
    cc: splitAddresses(addrText(parsed.cc)),
    bcc: splitAddresses(addrText(parsed.bcc)),
    subject: parsed.subject ?? "",
    text: parsed.text ?? "",
  });
  await deleteDraft(account, draftId);
}

/* ---------- Push des nouveaux mails (/api/cron/mail-push) ---------- */

export async function listNewPrimaryInbox(account: ConnectedAccount, afterMs: number): Promise<NewInboxMail[]> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // SINCE est au jour près : filtre exact sur la date de réception ensuite.
      const uids = (((await client.search({ since: new Date(afterMs - 86_400_000) }, { uid: true })) || []) as number[]).sort((a, b) => b - a).slice(0, 20);
      if (!uids.length) return [];
      const fresh: { uid: number; from: string; subject: string; internalDate: number; node: MessageStructureObject | null }[] = [];
      for await (const m of client.fetch(uids, { uid: true, envelope: true, internalDate: true, bodyStructure: true }, { uid: true })) {
        const internalDate = toDate(m.internalDate).getTime();
        if (internalDate > afterMs) fresh.push({ uid: m.uid, from: addr(m.envelope?.from?.[0]), subject: m.envelope?.subject || "(sans objet)", internalDate, node: textPart(m.bodyStructure) });
      }
      const snips = await snippets(client, fresh);
      return fresh
        .map((m) => ({ id: encodeId("INBOX", m.uid), from: m.from, subject: m.subject, snippet: snips.get(m.uid) ?? "", internalDate: m.internalDate }))
        .sort((a, b) => a.internalDate - b.internalDate);
    } finally {
      lock.release();
    }
  });
}

/** Vérifie l'adresse et le mot de passe pour app (connexion d'un compte). */
export async function verifyImapLogin(creds: { user: string; pass: string }) {
  await withImap(creds, async (client) => {
    await client.status("INBOX", { messages: true });
  });
}
