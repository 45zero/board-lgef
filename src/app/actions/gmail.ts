"use server";

import { createClient } from "@/lib/supabase/server";
import { getOwnedGoogleAccount } from "@/lib/google/accounts";
import {
  listMessages,
  getMessage,
  sendMessage,
  replyToMessage,
  forwardMessage,
  archiveMessage,
  trashMessage,
  untrashMessage,
  modifyMessageLabels,
  listLabels,
  createLabel,
  deleteLabel,
  getAttachment,
  listDrafts,
  getDraft,
  saveDraft,
  sendDraft,
  deleteDraft,
} from "@/lib/google/gmail";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  return user.id;
}

export async function listMyMessages(
  accountId: string,
  opts: { pageToken?: string; query?: string; labelIds?: string[] } = {}
) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return listMessages(account, opts);
}

export async function getMyMessage(accountId: string, messageId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return getMessage(account, messageId);
}

export async function sendMyMessage(
  accountId: string,
  params: { to: string; subject: string; body: string }
) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await sendMessage(account, params);
}

export async function replyToMyMessage(accountId: string, messageId: string, params: { body: string }) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await replyToMessage(account, messageId, params);
}

export async function forwardMyMessage(
  accountId: string,
  messageId: string,
  params: { to: string; body: string }
) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await forwardMessage(account, messageId, params);
}

export async function archiveMyMessage(accountId: string, messageId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await archiveMessage(account, messageId);
}

export async function trashMyMessage(accountId: string, messageId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await trashMessage(account, messageId);
}

export async function untrashMyMessage(accountId: string, messageId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await untrashMessage(account, messageId);
}

export async function modifyMyMessageLabels(
  accountId: string,
  messageId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] }
) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await modifyMessageLabels(account, messageId, changes);
}

export async function listMyLabels(accountId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return listLabels(account);
}

export async function createMyLabel(accountId: string, name: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return createLabel(account, name);
}

export async function deleteMyLabel(accountId: string, labelId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await deleteLabel(account, labelId);
}

export async function getMyAttachment(accountId: string, messageId: string, attachmentId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return getAttachment(account, messageId, attachmentId);
}

export async function listMyDrafts(accountId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return listDrafts(account);
}

export async function getMyDraft(accountId: string, draftId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return getDraft(account, draftId);
}

export async function saveMyDraft(
  accountId: string,
  params: { draftId?: string; to: string; subject: string; body: string }
) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return saveDraft(account, params);
}

export async function sendMyDraft(accountId: string, draftId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await sendDraft(account, draftId);
}

export async function deleteMyDraft(accountId: string, draftId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await deleteDraft(account, draftId);
}
