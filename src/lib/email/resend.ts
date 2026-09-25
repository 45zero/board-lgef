import "server-only";

/** Envoi transactionnel via Resend (domaine lgef.fr vérifié — même compte que ir2f). */

export interface ResendMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
}

const BATCH_SIZE = 100; // limite de l'endpoint /emails/batch

export function isResendConfigured() {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL;
}

/**
 * Envoie par lots de 100. `onBatchSent` reçoit les index (dans `messages`) de chaque lot accepté,
 * pour marquer les envois au fil de l'eau. Un lot refusé n'arrête pas les suivants.
 */
export async function sendResendBatch(
  messages: ResendMessage[],
  onBatchSent: (indexes: number[]) => Promise<void>
): Promise<{ sent: number; errors: string[] }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Resend non configuré (RESEND_API_KEY / RESEND_FROM_EMAIL).");

  let sent = 0;
  const errors: string[] = [];
  for (let start = 0; start < messages.length; start += BATCH_SIZE) {
    const batch = messages.slice(start, start + BATCH_SIZE);
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        batch.map((m) => ({
          from,
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        }))
      ),
    });
    if (res.ok) {
      await onBatchSent(batch.map((_, i) => start + i));
      sent += batch.length;
    } else {
      const body = await res.json().catch(() => null);
      errors.push(body?.message ?? `Resend ${res.status}`);
      console.error("[resend] lot refusé", res.status, body);
    }
    // Limite de débit Resend (2 requêtes/s par défaut).
    if (start + BATCH_SIZE < messages.length) await new Promise((r) => setTimeout(r, 600));
  }
  return { sent, errors };
}
