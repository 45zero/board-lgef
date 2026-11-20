import "server-only";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { ICLOUD_CALENDAR_SCOPE, ICLOUD_MAIL_SCOPE, icloudAuthError } from "@/lib/icloud/client";
import { verifyImapLogin } from "@/lib/icloud/imap";
import { verifyCaldavLogin } from "@/lib/icloud/caldav";

/** Le mot de passe pour app ne s'utilise pas en jeton OAuth : pas d'expiration, date lointaine. */
const NEVER = new Date("2100-01-01T00:00:00Z");

/**
 * Connecte (ou met à jour) un compte iCloud : adresse + mot de passe pour app, Mail et / ou Agenda.
 * Chaque service coché est vérifié auprès d'Apple avant l'enregistrement (rien n'est gardé si Apple
 * refuse). Renvoie un message d'erreur lisible plutôt que de lever une exception.
 */
export async function connectIcloudAccount(
  userId: string,
  input: { email: string; password: string; mail: boolean; calendar: boolean }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  // Collé depuis appleid.apple.com : « abcd-efgh-ijkl-mnop », parfois avec des espaces.
  const password = input.password.replace(/\s+/g, "");
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: "Adresse e-mail invalide." };
  if (!password) return { ok: false, error: "Collez le mot de passe pour app créé sur appleid.apple.com." };
  if (!input.mail && !input.calendar) return { ok: false, error: "Cochez au moins Mail ou Agenda." };

  const creds = { user: email, pass: password };
  try {
    if (input.mail) await verifyImapLogin(creds);
    if (input.calendar) await verifyCaldavLogin(creds);
  } catch (e) {
    return { ok: false, error: icloudAuthError(e) };
  }

  const scopes = [...(input.mail ? [ICLOUD_MAIL_SCOPE] : []), ...(input.calendar ? [ICLOUD_CALENDAR_SCOPE] : [])];
  const secret = encrypt(password);
  const key = { user_id_provider_provider_account_id: { user_id: userId, provider: "icloud", provider_account_id: email } };
  const account = await prisma.connectedAccount.upsert({
    where: key,
    create: { user_id: userId, provider: "icloud", provider_account_id: email, email, access_token: secret, refresh_token: secret, token_expires_at: NEVER, scopes },
    update: { email, access_token: secret, refresh_token: secret, token_expires_at: NEVER, scopes },
  });
  return { ok: true, id: account.id };
}
