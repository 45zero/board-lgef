"use server";

import { createClient } from "@/lib/supabase/server";
import { listConnectedAccounts, disconnectAccount } from "@/lib/google/accounts";
import { connectIcloudAccount } from "@/lib/icloud/accounts";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  return user.id;
}

export async function getMyConnectedAccounts() {
  const userId = await requireUserId();
  const accounts = await listConnectedAccounts(userId);
  // Ne jamais renvoyer les jetons (même chiffrés) au client.
  return accounts.map(({ access_token: _a, refresh_token: _r, ...safe }) => safe);
}

export async function disconnectMyAccount(accountId: string) {
  const userId = await requireUserId();
  await disconnectAccount(accountId, userId);
}

/** Compte iCloud : adresse + mot de passe pour app (appleid.apple.com), Mail et / ou Agenda. */
export async function connectMyIcloudAccount(input: { email: string; password: string; mail: boolean; calendar: boolean }) {
  const userId = await requireUserId();
  return connectIcloudAccount(userId, input);
}
