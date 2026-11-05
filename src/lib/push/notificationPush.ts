import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { sendPush, type PushIcon } from "@/lib/push/sendPush";
import { usersWithWebPush } from "@/lib/push/webPush";
import { discussionOfNotification, isBoardDiscussion } from "@/lib/board/discussions";
import { wantsChannel, type NotificationPrefs } from "@/lib/board/notificationPrefs";

const TEAM = { icon: "ic_stat_team", route: "/?app=trello" } as const;
const FRAIS = { icon: "ic_stat_lgef", route: "/?app=frais" } as const;
/** « event » : l'événement de la notification s'il y en a un, sinon l'accueil. */
const EVENT = { icon: "ic_stat_lgef", route: "event" } as const;

/**
 * Notifications du board qui peuvent partir en push, avec leur icône et l'écran ouvert au toucher.
 * Chacun choisit par catégorie (Paramètres → Notifications, notificationPrefs.ts) ; par défaut,
 * seules celles qui partaient déjà en push (Espace Team, publication, discussions, frais à valider).
 */
const PUSHED: Record<string, { icon: PushIcon; route: string }> = {
  publication_to_publish: { icon: "ic_stat_publication", route: "/?app=audiovisuel" },
  card_assigned: TEAM,
  card_mentioned: TEAM,
  card_commented: TEAM,
  card_due_soon: TEAM,
  board_shared: TEAM,
  event_mentioned: { icon: "ic_stat_lgef", route: "/" },
  event_commented: { icon: "ic_stat_lgef", route: "/" },
  direct_message: { icon: "ic_stat_lgef", route: "/" },
  expense_to_validate: FRAIS,
  expense_submitted: FRAIS,
  expense_approved: FRAIS,
  expense_rejected: FRAIS,
  event_deleted: EVENT,
  event_team_added: EVENT,
  assignment_created: EVENT,
  assignment_updated: EVENT,
  registration_response: { icon: "ic_stat_lgef", route: "/?app=inscription" },
  coverage_request: EVENT,
  coverage_request_created: EVENT,
  coverage_approved: EVENT,
  coverage_denied: EVENT,
  coverage_assignment: EVENT,
  coverage_rejected: EVENT,
  coverage_accepted: EVENT,
  coverage_accepted_admin: EVENT,
  director_assignment: EVENT,
  director_request: EVENT,
  director_approved: EVENT,
  director_denied: EVENT,
  director_reassigned: EVENT,
  director_invitation: EVENT,
  director_accepted: EVENT,
  director_declined: EVENT,
  account_request: { icon: "ic_stat_lgef", route: "/" },
  support_ticket: { icon: "ic_stat_lgef", route: "/" },
  support_resolved: { icon: "ic_stat_lgef", route: "/" },
};

/** Écran ouvert au toucher : pour une discussion (message, mention, message direct), la conversation dans la bulle. */
function routeOf(n: { type: string; event_id: string | null; data: unknown }, fallback: string) {
  const chat = discussionOfNotification(n);
  if (chat) return `/?openChat=${chat.kind}:${chat.id}`;
  if (fallback !== "event") return fallback;
  const eventId = n.event_id ?? ((n.data as { event_id?: unknown } | null)?.event_id as string | undefined);
  return eventId ? `/?openEvent=${eventId}` : "/";
}

/** Pas d'envoi d'historique : seules les notifications récentes partent en push. */
const WINDOW_MS = 30 * 60 * 1000;

/**
 * Push des nouvelles notifications « média à publier » et Espace Team (appelé chaque minute par
 * /api/cron/notification-emails). Chacune part une fois (notifications.push_sent_at), seulement si
 * son destinataire a l'appli (fcm_tokens) ou un ordinateur abonné (web_push_subscriptions) et n'a pas coupé les push (profiles.notify_push).
 */
export async function sendNotificationPushes(service: ReturnType<typeof createServiceClient>): Promise<number> {
  const { data: pending } = await service
    .from("notifications")
    .select("id")
    .is("push_sent_at", null)
    .in("type", Object.keys(PUSHED) as never[])
    .gte("created_at", new Date(Date.now() - WINDOW_MS).toISOString())
    .limit(50);
  if (!pending?.length) return 0;

  // Réservation : push_sent_at passe de null à maintenant une seule fois, même si deux appels se croisent.
  const { data: claimed } = await service
    .from("notifications")
    .update({ push_sent_at: new Date().toISOString() })
    .in("id", pending.map((p) => p.id))
    .is("push_sent_at", null)
    .select("id, user_id, type, title, message, event_id, data");
  if (!claimed?.length) return 0;

  const userIds = [...new Set(claimed.map((n) => n.user_id).filter((id): id is string => !!id))];
  const [{ data: tokens }, { data: profiles }, withComputer] = await Promise.all([
    service.from("fcm_tokens").select("user_id").in("user_id", userIds),
    service.from("profiles").select("id, notify_push, notification_prefs").in("id", userIds),
    usersWithWebPush(userIds),
  ]);
  const withApp = new Set([...(tokens ?? []).map((t) => t.user_id), ...withComputer]);
  const muted = new Set((profiles ?? []).filter((p) => p.notify_push === false).map((p) => p.id));
  const prefsBy = new Map((profiles ?? []).map((p) => [p.id, p.notification_prefs as NotificationPrefs]));

  let sent = 0;
  for (const n of claimed) {
    const conf = PUSHED[n.type];
    // Discussion de l'ancienne appli calendrier : elle a déjà envoyé son push (sinon deux pour un message).
    const legacy = (n.type === "event_commented" || n.type === "event_mentioned") && !isBoardDiscussion(n);
    if (!n.user_id || !conf || legacy || !withApp.has(n.user_id) || muted.has(n.user_id)) continue;
    // Push choisi ou non pour la catégorie (Paramètres → Notifications), ou notification discrète (`quiet`).
    if (!wantsChannel(prefsBy.get(n.user_id), n, "push")) continue;
    const ok = await sendPush({
      userId: n.user_id,
      title: n.title || "Board LGEF",
      body: n.message || "",
      type: n.type,
      icon: conf.icon,
      data: { route: routeOf(n, conf.route), notification_id: n.id },
    });
    await service.from("notifications").update({ push_last_status: ok ? "sent" : "failed" }).eq("id", n.id);
    if (ok) sent++;
  }
  return sent;
}
