import "server-only";
import type { EmailMessage } from "@/lib/email/transactional";

/** Envoi transactionnel via Brevo (compte de la ligue, domaine lgef.fr). */

const BATCH_SIZE = 1000; // limite de messageVersions par appel /smtp/email

export function isBrevoConfigured() {
  return !!process.env.BREVO_API_KEY && !!process.env.BREVO_FROM_EMAIL;
}

/** « LGEF <notifications@lgef.fr> » → { name, email } (format partagé avec RESEND_FROM_EMAIL). */
function parseSender(from: string) {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? { name: match[1].trim() || undefined, email: match[2].trim() } : { email: from.trim() };
}

/**
 * Un appel par lot de 1000 : chaque message devient une « version » (destinataires, objet,
 * HTML et texte propres). `onBatchSent` reçoit les index des messages acceptés.
 */
export async function sendBrevoBatch(
  messages: EmailMessage[],
  onBatchSent: (indexes: number[]) => Promise<void>
): Promise<{ sent: number; errors: string[] }> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Brevo non configuré (BREVO_API_KEY / BREVO_FROM_EMAIL).");
  const sender = parseSender(from);

  let sent = 0;
  const errors: string[] = [];
  for (let start = 0; start < messages.length; start += BATCH_SIZE) {
    const batch = messages.slice(start, start + BATCH_SIZE);
    const [first] = batch;
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender,
        // Contenu de base obligatoire même si chaque version le remplace.
        subject: first.subject,
        htmlContent: first.html,
        textContent: first.text,
        messageVersions: batch.map((m) => ({
          to: m.to.map((email) => ({ email })),
          subject: m.subject,
          htmlContent: m.html,
          textContent: m.text,
          ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
        })),
      }),
    });
    if (res.ok) {
      await onBatchSent(batch.map((_, i) => start + i));
      sent += batch.length;
    } else {
      const body = await res.json().catch(() => null);
      errors.push(body?.message ?? `Brevo ${res.status}`);
      console.error("[brevo] lot refusé", res.status, body);
    }
  }
  return { sent, errors };
}
