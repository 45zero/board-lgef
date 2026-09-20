"use server";

import { createClient } from "@/lib/supabase/server";
import { getOwnedGoogleAccount } from "@/lib/google/accounts";
import {
  listFiles,
  getFile,
  createFolder,
  uploadFile,
  downloadFile,
  trashFile,
  type DriveTypeFilter,
} from "@/lib/google/drive";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  return user.id;
}

export async function listMyFiles(
  accountId: string,
  opts: {
    folderId?: string;
    query?: string;
    sharedWithMe?: boolean;
    type?: DriveTypeFilter;
    modifiedAfter?: string;
  } = {}
) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return listFiles(account, opts);
}

export async function getMyFile(accountId: string, fileId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return getFile(account, fileId);
}

export async function createMyFolder(accountId: string, params: { name: string; parentId?: string }) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return createFolder(account, params);
}

export async function uploadMyFile(
  accountId: string,
  params: { name: string; parentId?: string; mimeType: string; data: string }
) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return uploadFile(account, params);
}

export async function downloadMyFile(accountId: string, fileId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return downloadFile(account, fileId);
}

export async function trashMyFile(accountId: string, fileId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await trashFile(account, fileId);
}
