import "server-only";
import { isBrevoConfigured, sendBrevoBatch } from "@/lib/email/brevo";
import { isResendConfigured, sendResendBatch } from "@/lib/email/resend";

/**
 * Point d'entrée unique des mails transactionnels du board (invitations, notifications, résumé du jour…).
 * Brevo (compte de la ligue) en priorité dès que BREVO_API_KEY / BREVO_FROM_EMAIL sont posés, Resend sinon.
 */

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
}

export function isTransactionalEmailConfigured() {
  return isBrevoConfigured() || isResendConfigured();
}

/** Envoi par lots ; `onBatchSent` reçoit les index (dans `messages`) acceptés, pour marquer les envois au fil de l'eau. */
export function sendTransactionalBatch(
  messages: EmailMessage[],
  onBatchSent: (indexes: number[]) => Promise<void>
): Promise<{ sent: number; errors: string[] }> {
  return isBrevoConfigured() ? sendBrevoBatch(messages, onBatchSent) : sendResendBatch(messages, onBatchSent);
}
