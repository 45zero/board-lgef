import "server-only";
import { prisma } from "@/lib/prisma";
import type { ConnectedAccount } from "@/generated/prisma";
import * as gmail from "@/lib/google/gmail";
import * as icloud from "@/lib/icloud/imap";
import { ICLOUD_MAIL_SCOPE, isIcloud } from "@/lib/icloud/client";

// Messagerie, quel que soit le fournisseur du compte : Gmail (API Google) ou iCloud (IMAP / SMTP).
// Mêmes signatures et mêmes données que lib/google/gmail.ts ; les écrans et les routes passent par
// ici. Un futur Outlook (portail Azure de la FFF) s'ajoutera de la même façon.

/** Compte de messagerie de l'utilisateur (Google, ou iCloud avec le mail coché à la connexion). */
export async function getOwnedMailAccount(accountId: string, userId: string) {
  const account = await prisma.connectedAccount.findFirst({ where: { id: accountId, user_id: userId, provider: { in: ["google", "icloud"] } } });
  if (!account || (isIcloud(account) && !account.scopes.includes(ICLOUD_MAIL_SCOPE))) throw new Error("Compte introuvable ou non autorisé");
  return account;
}

/** Comptes de messagerie (d'un utilisateur, ou de tous pour le push) : Google avec Gmail autorisé, iCloud avec le mail coché. */
export async function listMailAccounts(where: { user_id?: string } = {}) {
  const accounts = await prisma.connectedAccount.findMany({ where: { ...where, provider: { in: ["google", "icloud"] } }, orderBy: { created_at: "asc" } });
  return accounts.filter((a) => (isIcloud(a) ? a.scopes.includes(ICLOUD_MAIL_SCOPE) : a.scopes.some((s) => s.includes("gmail"))));
}

type A = ConnectedAccount;

export const listMessages = (a: A, opts: { pageToken?: string; query?: string; labelIds?: string[] } = {}) =>
  isIcloud(a) ? icloud.listMessages(a, opts) : gmail.listMessages(a, opts);
export const getMessage = (a: A, id: string, opts: { inlineImages?: boolean } = {}) => (isIcloud(a) ? icloud.getMessage(a, id) : gmail.getMessage(a, id, opts));
export const getAttachment = (a: A, id: string, attachmentId: string) => (isIcloud(a) ? icloud.getAttachment(a, id, attachmentId) : gmail.getAttachment(a, id, attachmentId));
export const trashMessage = (a: A, id: string) => (isIcloud(a) ? icloud.trashMessage(a, id) : gmail.trashMessage(a, id));
export const untrashMessage = (a: A, id: string) => (isIcloud(a) ? icloud.untrashMessage(a, id) : gmail.untrashMessage(a, id));
export const archiveMessage = (a: A, id: string) => (isIcloud(a) ? icloud.archiveMessage(a, id) : gmail.archiveMessage(a, id));
export const modifyMessageLabels = (a: A, id: string, changes: { addLabelIds?: string[]; removeLabelIds?: string[] }) =>
  isIcloud(a) ? icloud.modifyMessageLabels(a, id, changes) : gmail.modifyMessageLabels(a, id, changes);
export const getInboxUnreadCount = (a: A) => (isIcloud(a) ? icloud.getInboxUnreadCount(a) : gmail.getInboxUnreadCount(a));
export const markAllInboxRead = (a: A) => (isIcloud(a) ? icloud.markAllInboxRead(a) : gmail.markAllInboxRead(a));
export const listLabels = (a: A) => (isIcloud(a) ? icloud.listLabels(a) : gmail.listLabels(a));
export const createLabel = (a: A, name: string) => (isIcloud(a) ? icloud.createLabel(a, name) : gmail.createLabel(a, name));
export const deleteLabel = (a: A, labelId: string) => (isIcloud(a) ? icloud.deleteLabel(a, labelId) : gmail.deleteLabel(a, labelId));
export const sendMessage = (a: A, params: { to: string; cc?: string; bcc?: string; subject: string; body: string; html?: string; replyTo?: string }) =>
  isIcloud(a) ? icloud.sendMessage(a, params) : gmail.sendMessage(a, params);
export const replyToMessage = (a: A, id: string, params: { body: string }) => (isIcloud(a) ? icloud.replyToMessage(a, id, params) : gmail.replyToMessage(a, id, params));
export const forwardMessage = (a: A, id: string, params: { to: string; body: string }) =>
  isIcloud(a) ? icloud.forwardMessage(a, id, params) : gmail.forwardMessage(a, id, params);
export const listDrafts = (a: A) => (isIcloud(a) ? icloud.listDrafts(a) : gmail.listDrafts(a));
export const getDraft = (a: A, id: string) => (isIcloud(a) ? icloud.getDraft(a, id) : gmail.getDraft(a, id));
export const saveDraft = (a: A, params: { draftId?: string; to: string; cc?: string; bcc?: string; subject: string; body: string }) =>
  isIcloud(a) ? icloud.saveDraft(a, params) : gmail.saveDraft(a, params);
export const sendDraft = (a: A, id: string) => (isIcloud(a) ? icloud.sendDraft(a, id) : gmail.sendDraft(a, id));
export const deleteDraft = (a: A, id: string) => (isIcloud(a) ? icloud.deleteDraft(a, id) : gmail.deleteDraft(a, id));
export const listNewPrimaryInbox = (a: A, afterMs: number) => (isIcloud(a) ? icloud.listNewPrimaryInbox(a, afterMs) : gmail.listNewPrimaryInbox(a, afterMs));
