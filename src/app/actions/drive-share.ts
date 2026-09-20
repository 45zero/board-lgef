"use server";

import { createClient } from "@/lib/supabase/server";
import { getGoogleAccountById } from "@/lib/google/accounts";
import { getBoardDriveAccountId } from "@/app/actions/board-settings";
import { ensurePublicViewAccess } from "@/lib/google/drive";

/** Rend public (lecture seule, lien) un fichier du Drive du board — pour qu'un partage soit ouvrable par quelqu'un d'externe. */
export async function shareBoardDriveFile(fileId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const accountId = await getBoardDriveAccountId();
  const account = accountId ? await getGoogleAccountById(accountId) : null;
  if (!account) throw new Error("Aucun Drive de board configuré.");

  await ensurePublicViewAccess(account, fileId);
}
