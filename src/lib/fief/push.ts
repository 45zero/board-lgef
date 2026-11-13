import "server-only";
import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Push FIEF : navigateurs / appli installée des membres (fief_push_subscriptions,
// sql/2026-11-13_fief_evenements.sql), affichés par public/fief/sw.js. Mêmes clés VAPID que le board.

let configured: boolean | null = null;
function configure() {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  configured = !!(publicKey && privateKey);
  if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@lgef.fr", publicKey!, privateKey!);
  return configured;
}

/** Envoie à tous les appareils abonnés des membres ; retire les abonnements expirés. Renvoie les membres atteintes. */
export async function sendFiefPush(userIds: string[], payload: { title: string; body: string; route: string; tag?: string }): Promise<Set<string>> {
  const reached = new Set<string>();
  if (!userIds.length || !configure()) return reached;
  const service = createServiceClient();
  const { data: subs, error } = await service.from("fief_push_subscriptions").select("endpoint, user_id, p256dh, auth").in("user_id", userIds);
  if (error) {
    console.error("[sendFiefPush]", error.message);
    return reached;
  }
  const body = JSON.stringify(payload);
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 24 * 3600 });
        reached.add(s.user_id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await service.from("fief_push_subscriptions").delete().eq("endpoint", s.endpoint);
        else console.error("[sendFiefPush]", status, e);
      }
    })
  );
  return reached;
}
