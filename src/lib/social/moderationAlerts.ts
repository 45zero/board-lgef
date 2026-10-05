import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isTransactionalEmailConfigured, sendTransactionalBatch, type EmailMessage } from "@/lib/email/transactional";
import { networkLabel, type NetworkKey } from "@/lib/social/targets";

type Client = SupabaseClient<Database>;

export type FlaggedComment = {
  moderationId: string;
  publicationId: string;
  publicationTitle: string;
  network: NetworkKey;
  author: string;
  text: string;
  verdict: "hateful" | "review";
  severity: string | null;
  reason: string | null;
  action: "hidden" | "hide_failed" | "none";
  permalink?: string;
  /** Personnes liées à la publication (qui l'a publiée / créée) — prévenues en plus des admins et des destinataires choisis. */
  ownerIds: string[];
};

type Recipient = { id: string; email: string | null; first_name: string | null; hate_alert_email: boolean; hate_alert_push: boolean };

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function actionLabel(c: FlaggedComment) {
  if (c.verdict === "review") return "À vérifier (laissé visible)";
  if (c.action === "hidden") return "Masqué automatiquement";
  if (c.action === "hide_failed") return "⚠️ Masquage impossible — à traiter à la main";
  return "Signalé";
}

/**
 * Prévient, pour chaque commentaire signalé : les admins/super-utilisateurs, les destinataires
 * choisis dans les réglages du board (board_settings.moderation_recipient_ids) et les personnes
 * liées à la publication. Chacun reçoit un seul récapitulatif par passage, par e-mail et/ou en
 * notification push selon ses préférences (profiles.hate_alert_email / hate_alert_push).
 */
export async function sendModerationAlerts(client: Client, flagged: FlaggedComment[]): Promise<{ notified: string[]; errors: string[] }> {
  if (flagged.length === 0) return { notified: [], errors: [] };

  const [{ data: settings }, { data: admins }] = await Promise.all([
    client.from("board_settings").select("moderation_recipient_ids").eq("id", true).single(),
    client.from("profiles").select("id").in("role", ["admin", "super_user"]),
  ]);
  const everyone = new Set<string>([...(settings?.moderation_recipient_ids ?? []), ...(admins ?? []).map((a) => a.id)]);
  const allIds = new Set<string>([...everyone, ...flagged.flatMap((f) => f.ownerIds)]);

  const { data: profiles } = await client
    .from("profiles")
    .select("id, email, first_name, hate_alert_email, hate_alert_push")
    .in("id", [...allIds]);

  const perRecipient = new Map<string, { recipient: Recipient; comments: FlaggedComment[] }>();
  for (const p of (profiles as Recipient[] | null) ?? []) {
    const comments = flagged.filter((f) => everyone.has(p.id) || f.ownerIds.includes(p.id));
    if (comments.length > 0) perRecipient.set(p.id, { recipient: p, comments });
  }

  const boardUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const emails: EmailMessage[] = [];
  const errors: string[] = [];

  for (const { recipient, comments } of perRecipient.values()) {
    const hateful = comments.filter((c) => c.verdict === "hateful").length;
    const title =
      hateful > 0
        ? `⚠️ ${hateful} commentaire${hateful > 1 ? "s" : ""} haineux sur vos publications`
        : `${comments.length} commentaire${comments.length > 1 ? "s" : ""} à vérifier sur vos publications`;
    const summary = comments
      .slice(0, 3)
      .map((c) => `${networkLabel(c.network)} — ${c.author} : « ${c.text.slice(0, 80)} »`)
      .join("\n");

    if (recipient.hate_alert_push) {
      const body = `${summary}${comments.length > 3 ? `\n… et ${comments.length - 3} autre(s)` : ""}`;
      const data = { kind: "hateful_comment", publication_ids: [...new Set(comments.map((c) => c.publicationId))] };
      const { data: notif } = await client
        .from("notifications")
        .insert({ user_id: recipient.id, type: "hateful_comment", title, message: body, data })
        .select("id")
        .single();
      const { error } = await client
        .from("push_outbox")
        .insert({ user_id: recipient.id, title, body, data, type: "hateful_comment", notification_id: notif?.id ?? null } as never);
      if (error) errors.push(`push ${recipient.id} : ${error.message}`);
    }

    if (recipient.hate_alert_email && recipient.email) {
      const rows = comments
        .map(
          (c) => `<tr>
  <td style="padding:10px;border-bottom:1px solid #eef0f3;vertical-align:top">
    <div style="font-size:12px;color:#6b7280">${escapeHtml(networkLabel(c.network))} · ${escapeHtml(c.publicationTitle)}</div>
    <div style="margin:4px 0;font-size:14px"><strong>${escapeHtml(c.author)}</strong> : « ${escapeHtml(c.text)} »</div>
    <div style="font-size:12px;color:${c.verdict === "hateful" ? "#E1141B" : "#9A6B00"}"><strong>${escapeHtml(actionLabel(c))}</strong>${
      c.reason ? ` — ${escapeHtml(c.reason)}` : ""
    }</div>
    ${c.permalink ? `<div style="margin-top:4px;font-size:12px"><a href="${escapeHtml(c.permalink)}">Voir la publication</a></div>` : ""}
  </td>
</tr>`
        )
        .join("");
      emails.push({
        to: [recipient.email],
        subject: title,
        html: `<div style="font-family:Arial,sans-serif;color:#0E2A55;max-width:640px">
<p>Bonjour ${escapeHtml(recipient.first_name ?? "")},</p>
<p>La modération automatique du board LGEF a détecté ${comments.length} commentaire${comments.length > 1 ? "s" : ""} sous les publications de la Ligue.</p>
<table style="width:100%;border-collapse:collapse">${rows}</table>
<p style="margin-top:16px"><a href="${escapeHtml(boardUrl)}" style="background:#12305F;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Ouvrir le centre de publication</a></p>
<p style="font-size:12px;color:#6b7280">Vous recevez cet e-mail selon vos préférences d'alerte (Paramètres du board → Notifications).</p>
</div>`,
        text: `${title}\n\n${comments
          .map((c) => `- ${networkLabel(c.network)} · ${c.publicationTitle}\n  ${c.author} : « ${c.text} »\n  ${actionLabel(c)}${c.reason ? ` — ${c.reason}` : ""}`)
          .join("\n\n")}\n\n${boardUrl}`,
      });
    }
  }

  if (emails.length > 0) {
    if (!isTransactionalEmailConfigured()) errors.push("E-mails non envoyés : envoi d'e-mails non configuré (Brevo / Resend).");
    else {
      const res = await sendTransactionalBatch(emails, async () => {});
      errors.push(...res.errors);
    }
  }

  return { notified: [...perRecipient.keys()], errors };
}
