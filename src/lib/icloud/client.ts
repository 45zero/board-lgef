import "server-only";
import { ImapFlow } from "imapflow";
import { decrypt } from "@/lib/crypto";
import type { ConnectedAccount } from "@/generated/prisma";

// Comptes iCloud : Apple n'a pas d'OAuth pour le mail et l'agenda des applications tierces. La
// personne crée un « mot de passe pour app » (appleid.apple.com → Connexion et sécurité), chiffré
// dans connected_accounts.access_token comme les jetons Google (AES-256-GCM, lib/crypto).
// scopes : "icloud:mail" et / ou "icloud:calendar" selon ce qui a été coché à la connexion.

export const ICLOUD_IMAP = { host: "imap.mail.me.com", port: 993, secure: true } as const;
export const ICLOUD_SMTP = { host: "smtp.mail.me.com", port: 587, secure: false } as const;
export const ICLOUD_CALDAV = "https://caldav.icloud.com";

export const ICLOUD_MAIL_SCOPE = "icloud:mail";
export const ICLOUD_CALENDAR_SCOPE = "icloud:calendar";

export const isIcloud = (account: Pick<ConnectedAccount, "provider">) => account.provider === "icloud";

export function icloudCredentials(account: ConnectedAccount) {
  return { user: account.email, pass: decrypt(account.access_token) };
}

/** Message d'erreur lisible quand Apple refuse la connexion. */
export function icloudAuthError(e: unknown): string {
  const raw = e instanceof Error ? `${e.message} ${(e as { responseText?: string }).responseText ?? ""}` : String(e);
  if (/auth|login|credentials|401|invalid/i.test(raw)) {
    return "Apple refuse la connexion : vérifiez l'adresse iCloud et le mot de passe pour app (pas le mot de passe de l'identifiant Apple).";
  }
  return `Connexion à iCloud impossible : ${raw.slice(0, 160)}`;
}

export function imapClient(creds: { user: string; pass: string }) {
  return new ImapFlow({ ...ICLOUD_IMAP, auth: creds, logger: false, emitLogs: false, socketTimeout: 60_000 });
}

/** Ouvre une connexion IMAP, exécute `fn`, puis la ferme (fonction serverless : pas de connexion gardée). */
export async function withImap<T>(account: ConnectedAccount | { user: string; pass: string }, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const creds = "access_token" in account ? icloudCredentials(account) : account;
  const client = imapClient(creds);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}
