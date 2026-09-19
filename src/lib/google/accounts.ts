import "server-only";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { refreshGoogleAccessToken } from "@/lib/google/oauth";
import type { ConnectedAccount } from "@/generated/prisma";

export function listConnectedAccounts(userId: string) {
  return prisma.connectedAccount.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "asc" },
  });
}

export async function upsertGoogleAccount(params: {
  userId: string;
  providerAccountId: string;
  email: string;
  accessToken: string;
  refreshToken: string | null | undefined;
  expiryDate: number | null | undefined;
  scopes: string[];
}) {
  const existing = await prisma.connectedAccount.findUnique({
    where: {
      user_id_provider_provider_account_id: {
        user_id: params.userId,
        provider: "google",
        provider_account_id: params.providerAccountId,
      },
    },
  });

  // Google ne renvoie un refresh_token qu'à la première autorisation
  // (ou avec prompt=consent) — on garde l'ancien si absent cette fois-ci.
  const refreshToken = params.refreshToken
    ? encrypt(params.refreshToken)
    : existing?.refresh_token;

  if (!refreshToken) {
    throw new Error("Aucun refresh_token reçu de Google et aucun existant à conserver.");
  }

  return prisma.connectedAccount.upsert({
    where: {
      user_id_provider_provider_account_id: {
        user_id: params.userId,
        provider: "google",
        provider_account_id: params.providerAccountId,
      },
    },
    create: {
      user_id: params.userId,
      provider: "google",
      provider_account_id: params.providerAccountId,
      email: params.email,
      access_token: encrypt(params.accessToken),
      refresh_token: refreshToken,
      token_expires_at: new Date(params.expiryDate ?? Date.now()),
      scopes: params.scopes,
    },
    update: {
      email: params.email,
      access_token: encrypt(params.accessToken),
      refresh_token: refreshToken,
      token_expires_at: new Date(params.expiryDate ?? Date.now()),
      scopes: params.scopes,
    },
  });
}

export function disconnectAccount(id: string, userId: string) {
  return prisma.connectedAccount.deleteMany({ where: { id, user_id: userId } });
}

/** Charge un compte Google en vérifiant qu'il appartient bien à l'utilisateur courant. */
export async function getOwnedGoogleAccount(accountId: string, userId: string) {
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, user_id: userId, provider: "google" },
  });
  if (!account) throw new Error("Compte introuvable ou non autorisé");
  return account;
}

/** Retourne un access_token Google valide, en le rafraîchissant si besoin. */
export async function getValidGoogleAccessToken(account: ConnectedAccount): Promise<string> {
  const expiresInMs = account.token_expires_at.getTime() - Date.now();

  if (expiresInMs > 60_000) {
    return decrypt(account.access_token);
  }

  const refreshToken = decrypt(account.refresh_token);
  const credentials = await refreshGoogleAccessToken(refreshToken);

  if (!credentials.access_token) {
    throw new Error("Échec du rafraîchissement du token Google — reconnexion nécessaire.");
  }

  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      access_token: encrypt(credentials.access_token),
      token_expires_at: new Date(credentials.expiry_date ?? Date.now() + 3600_000),
    },
  });

  return credentials.access_token;
}
