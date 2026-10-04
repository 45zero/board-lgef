import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { isResendConfigured, sendResendBatch, type ResendMessage } from "@/lib/email/resend";
import { CHOICES, NOT_EMAILED, renderNotificationEmail, type EmailEvent, type EmailNotification } from "@/lib/email/notificationEmails";
import { createActionToken } from "@/lib/email/actionTokens";

export const maxDuration = 60;

/** Notifications plus anciennes ignorées (pas d'envoi d'historique, ni de rattrapage d'une panne longue). */
const WINDOW_MS = 30 * 60 * 1000;
const BATCH = 40;

/**
 * Notifications du board par e-mail — appelé chaque minute par pg_cron (job « notification-emails »,
 * sql/2026-10-04_calendar_prefs_notification_emails.sql) avec le secret CRON_SECRET. Chaque nouvelle
 * notification part une fois (notifications.email_status), seulement si son destinataire a gardé
 * « Notifications par e-mail » (profiles.notify_email). Les futures notifications push suivront le
 * même chemin avec profiles.notify_push.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!isResendConfigured()) return NextResponse.json({ error: "Resend non configuré" }, { status: 500 });

  const service = createServiceClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  // Réservation : une ligne passe de null à « sending » une seule fois, même si deux appels se croisent.
  const { data: pending, error } = await service
    .from("notifications")
    .select("id")
    .is("email_status", null)
    .gte("created_at", since)
    .order("created_at")
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pending?.length) return NextResponse.json({ sent: 0 });

  const { data: claimed } = await service
    .from("notifications")
    .update({ email_status: "sending" })
    .in("id", pending.map((p) => p.id))
    .is("email_status", null)
    .select("id, user_id, type, title, message, actor_name, data, event_id");
  const rows = (claimed ?? []) as {
    id: string;
    user_id: string;
    type: string;
    title: string | null;
    message: string | null;
    actor_name: string | null;
    data: Record<string, unknown> | null;
    event_id: string | null;
  }[];
  if (rows.length === 0) return NextResponse.json({ sent: 0 });

  const eventIdOf = (r: (typeof rows)[number]) => r.event_id ?? (typeof r.data?.event_id === "string" ? r.data.event_id : null);
  const [{ data: profiles }, { data: events }] = await Promise.all([
    service.from("profiles").select("id, email, first_name, notify_email").in("id", [...new Set(rows.map((r) => r.user_id))]),
    service
      .from("events")
      .select("id, title, start_date, end_date, location")
      .in("id", [...new Set(rows.map(eventIdOf).filter((id): id is string => !!id))]),
  ]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const eventById = new Map(((events ?? []) as EmailEvent[]).map((e) => [e.id, e]));

  const skipped: string[] = [];
  const messages: ResendMessage[] = [];
  const messageIds: string[] = [];
  for (const r of rows) {
    const profile = profileById.get(r.user_id);
    if (!profile?.email || profile.notify_email === false || NOT_EMAILED.has(r.type) || r.data?.skip_email === true) {
      skipped.push(r.id);
      continue;
    }
    const n: EmailNotification = { ...r, eventId: eventIdOf(r) };
    // Réponse depuis l'e-mail : couverture vidéo et comité directeur (pas les postes photo du Week-end, sans réponse attendue).
    const token = CHOICES[r.type] && n.eventId && r.data?.trade !== "photo" ? createActionToken(r.id, r.user_id) : null;
    messages.push(
      renderNotificationEmail(n, { email: profile.email, firstName: profile.first_name }, n.eventId ? (eventById.get(n.eventId) ?? null) : null, token)
    );
    messageIds.push(r.id);
  }

  if (skipped.length) await service.from("notifications").update({ email_status: "skipped" }).in("id", skipped);

  const sentIds = new Set<string>();
  const result = messages.length
    ? await sendResendBatch(messages, async (indexes) => {
        const ids = indexes.map((i) => messageIds[i]);
        ids.forEach((id) => sentIds.add(id));
        await service.from("notifications").update({ email_status: "sent", email_sent_at: new Date().toISOString() }).in("id", ids);
      })
    : { sent: 0, errors: [] as string[] };
  const failed = messageIds.filter((id) => !sentIds.has(id));
  if (failed.length) await service.from("notifications").update({ email_status: "failed" }).in("id", failed);

  return NextResponse.json({ sent: result.sent, skipped: skipped.length, failed: failed.length, errors: result.errors });
}
