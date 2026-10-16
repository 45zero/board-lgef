import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { sendPush, type PushIcon } from "@/lib/push/sendPush";
import { usersWithWebPush } from "@/lib/push/webPush";

/** Notifications du board envoyées aussi en push, avec leur icône et l'écran ouvert au toucher. */
const PUSHED: Record<string, { icon: PushIcon; route: string }> = {
  publication_to_publish: { icon: "ic_stat_publication", route: "/?app=audiovisuel" },
  card_assigned: { icon: "ic_stat_team", route: "/?app=trello" },
  card_mentioned: { icon: "ic_stat_team", route: "/?app=trello" },
  card_commented: { icon: "ic_stat_team", route: "/?app=trello" },
  card_due_soon: { icon: "ic_stat_team", route: "/?app=trello" },
  board_shared: { icon: "ic_stat_team", route: "/?app=trello" },
};

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
    .select("id, user_id, type, title, message");
  if (!claimed?.length) return 0;

  const userIds = [...new Set(claimed.map((n) => n.user_id).filter((id): id is string => !!id))];
  const [{ data: tokens }, { data: profiles }, withComputer] = await Promise.all([
    service.from("fcm_tokens").select("user_id").in("user_id", userIds),
    service.from("profiles").select("id, notify_push").in("id", userIds),
    usersWithWebPush(userIds),
  ]);
  const withApp = new Set([...(tokens ?? []).map((t) => t.user_id), ...withComputer]);
  const muted = new Set((profiles ?? []).filter((p) => p.notify_push === false).map((p) => p.id));

  let sent = 0;
  for (const n of claimed) {
    const conf = PUSHED[n.type];
    if (!n.user_id || !conf || !withApp.has(n.user_id) || muted.has(n.user_id)) continue;
    const ok = await sendPush({
      userId: n.user_id,
      title: n.title || "Board LGEF",
      body: n.message || "",
      type: n.type,
      icon: conf.icon,
      data: { route: conf.route, notification_id: n.id },
    });
    await service.from("notifications").update({ push_last_status: ok ? "sent" : "failed" }).eq("id", n.id);
    if (ok) sent++;
  }
  return sent;
}
