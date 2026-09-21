"use server";

import { createClient } from "@/lib/supabase/server";
import { getGoogleAccountById } from "@/lib/google/accounts";
import { getBoardDriveAccountId } from "@/app/actions/board-settings";
import { listFiles, getFile, findOrCreateFolder, type DriveTypeFilter } from "@/lib/google/drive";

const ROOT_FOLDER_NAME = "LGEF Drive";

async function requireBoardDriveAccount() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const accountId = await getBoardDriveAccountId();
  const account = accountId ? await getGoogleAccountById(accountId) : null;
  if (!account) throw new Error("Aucun Drive de board configuré (Paramètres du board → Drive du board).");
  return account;
}

/** Id du dossier racine "LGEF Drive" — créé au premier appel si besoin. */
export async function getBoardDriveRootFolderId() {
  const account = await requireBoardDriveAccount();
  const root = await findOrCreateFolder(account, { name: ROOT_FOLDER_NAME });
  return root.id;
}

export async function listBoardFiles(
  opts: { folderId?: string; query?: string; type?: DriveTypeFilter; modifiedAfter?: string } = {}
) {
  const account = await requireBoardDriveAccount();
  return listFiles(account, opts);
}

export async function getBoardFile(fileId: string) {
  const account = await requireBoardDriveAccount();
  return getFile(account, fileId);
}
