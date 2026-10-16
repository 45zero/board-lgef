import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { isTransactionalEmailConfigured, sendTransactionalBatch, type EmailMessage } from "@/lib/email/transactional";
import { CHOICES, NOT_EMAILED, renderNotificationEmail, type EmailEvent, type EmailNotification } from "@/lib/email/notificationEmails";
import { createActionToken } from "@/lib/email/actionTokens";
import { sendNotificationPushes } from "@/lib/push/notificationPush";
import { DISCUSSION_TYPES, discussionSourceOf, loadThreadForEmail, renderDiscussionEmail } from "@/lib/email/discussionEmails";
import { isBoardDiscussion, sourceKey, type ChatSource } from "@/lib/board/discussions";

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
  // Push (publication, Espace Team) : indépendants des e-mails, une erreur ne bloque pas l'envoi des e-mails.
  await sendNotificationPushes(createServiceClient()).catch((e) => console.error("[notification-push]", e));
  if (!isTransactionalEmailConfigured()) return NextResponse.json({ error: "Envoi d'e-mails non configuré (Brevo / Resend)" }, { status: 500 });

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
    .select("id, user_id, type, title, message, actor_name, data, event_id, created_at");
  const rows = (claimed ?? []) as {
    id: string;
    user_id: string;
    type: string;
    title: string | null;
    message: string | null;
    actor_name: string | null;
    data: Record<string, unknown> | null;
    event_id: string | null;
    created_at: string;
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
  const messages: EmailMessage[] = [];
  // Notifications de chaque e-mail (un e-mail de discussion regroupe celles d'un même fil).
  const messageIds: string[][] = [];
  const discussions = new Map<string, { source: ChatSource; rows: typeof rows }>();
  for (const r of rows) {
    const profile = profileById.get(r.user_id);
    // Rappels envoyés par le board (/api/cron/event-reminders) : e-mailés ici, contrairement à ceux de l'ancien calendrier.
    const boardReminder = r.type === "event_reminder" && r.data?.board_reminder === true;
    if (!profile?.email || profile.notify_email === false || (NOT_EMAILED.has(r.type) && !boardReminder) || r.data?.skip_email === true) {
      skipped.push(r.id);
      continue;
    }
    // Discussion de l'ancienne appli calendrier : elle envoie déjà son propre e-mail.
    if (DISCUSSION_TYPES.has(r.type) && !isBoardDiscussion(r)) {
      skipped.push(r.id);
      continue;
    }
    // Discussion : regroupée par destinataire et par fil, envoyée plus bas avec le fil des messages.
    const source = DISCUSSION_TYPES.has(r.type) ? discussionSourceOf(r) : null;
    if (source) {
      const key = `${r.user_id}|${sourceKey(source)}`;
      const group = discussions.get(key) ?? { source, rows: [] };
      group.rows.push(r);
      discussions.set(key, group);
      continue;
    }
    const n: EmailNotification = { ...r, eventId: eventIdOf(r) };
    // Réponse depuis l'e-mail : couverture vidéo et comité directeur (pas les postes photo du Week-end, sans réponse attendue).
    const token = CHOICES[r.type] && n.eventId && r.data?.trade !== "photo" ? createActionToken(r.id, r.user_id) : null;
    messages.push(
      renderNotificationEmail(n, { email: profile.email, firstName: profile.first_name }, n.eventId ? (eventById.get(n.eventId) ?? null) : null, token)
    );
    messageIds.push([r.id]);
  }

  for (const { source, rows: group } of discussions.values()) {
    const first = group[0];
    const profile = profileById.get(first.user_id)!;
    const ids = group.map((g) => g.id);
    // Seuil des « nouveaux » messages : un peu avant la première notification (créée juste après le message).
    const newSince = new Date(new Date(group.reduce((min, g) => (g.created_at < min ? g.created_at : min), first.created_at)).getTime() - 60_000).toISOString();
    try {
      const thread = await loadThreadForEmail(service, source, first.user_id);
      // Déjà lu dans le board entre-temps : pas d'e-mail.
      if (await alreadyRead(service, source, first.user_id, thread.messages.filter((m) => m.authorId !== first.user_id && m.createdAt >= newSince).map((m) => m.id))) {
        skipped.push(...ids);
        continue;
      }
      const latest = group[group.length - 1];
      messages.push(
        renderDiscussionEmail({
          type: group.some((g) => g.type === "event_mentioned") ? "event_mentioned" : latest.type,
          source,
          recipient: { id: first.user_id, email: profile.email!, firstName: profile.first_name },
          actor: latest.actor_name,
          thread,
          newSince,
        })
      );
      messageIds.push(ids);
    } catch (e) {
      console.error("[notification-emails.discussion]", e);
      skipped.push(...ids);
    }
  }

  if (skipped.length) await service.from("notifications").update({ email_status: "skipped" }).in("id", skipped);
  const allIds = messageIds.flat();

  const sentIds = new Set<string>();
  const result = messages.length
    ? await sendTransactionalBatch(messages, async (indexes) => {
        const ids = indexes.flatMap((i) => messageIds[i]);
        ids.forEach((id) => sentIds.add(id));
        await service.from("notifications").update({ email_status: "sent", email_sent_at: new Date().toISOString() }).in("id", ids);
      })
    : { sent: 0, errors: [] as string[] };
  const failed = allIds.filter((id) => !sentIds.has(id));
  if (failed.length) await service.from("notifications").update({ email_status: "failed" }).in("id", failed);

  return NextResponse.json({ sent: result.sent, skipped: skipped.length, failed: failed.length, errors: result.errors });
}

/** Les nouveaux messages ont déjà été lus dans le board (lectures d'un événement, dernière lecture d'une discussion directe). */
async function alreadyRead(service: ReturnType<typeof createServiceClient>, source: ChatSource, userId: string, newIds: string[]) {
  if (!newIds.length) return true;
  if (source.kind === "event") {
    const { data } = await service.from("event_comment_reads").select("comment_id").eq("user_id", userId).in("comment_id", newIds);
    return (data ?? []).length >= newIds.length;
  }
  const [{ data: member }, { data: latest }] = await Promise.all([
    service.from("chat_conversation_members").select("last_read_at").eq("conversation_id", source.id).eq("user_id", userId).maybeSingle(),
    service.from("chat_messages").select("created_at").in("id", newIds).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return !!member?.last_read_at && !!latest && member.last_read_at >= latest.created_at;
}
