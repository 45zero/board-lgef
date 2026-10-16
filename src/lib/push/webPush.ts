import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";

/**
 * Notifications sur ordinateur (Web Push) : abonnements des navigateurs dans web_push_subscriptions
 * (sql/2026-10-16_web_push.sql), activés dans Paramètres > Notifications. Affichées par public/sw.js.
 * Clés VAPID : NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
 */

let configured: boolean | null = null;
function configure() {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  configured = !!(publicKey && privateKey);
  if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@lgef.fr", publicKey!, privateKey!);
  return configured;
}

type Subscription = { endpoint: string; p256dh: string; auth: string };

/** Envoie à tous les navigateurs abonnés de l'utilisateur ; retire ceux qui n'existent plus. Vrai si au moins un a reçu. */
export async function sendWebPush(params: { userId: string; title: string; body: string; route?: string; tag?: string }): Promise<boolean> {
  if (!configure()) return false;
  let subs: Subscription[];
  try {
    subs = await prisma.$queryRaw<Subscription[]>`
      select endpoint, p256dh, auth from public.web_push_subscriptions where user_id = ${params.userId}::uuid`;
  } catch (e) {
    console.error("[sendWebPush]", e);
    return false;
  }
  if (!subs.length) return false;

  const payload = JSON.stringify({ title: params.title, body: params.body, route: params.route, tag: params.tag });
  const results = await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
        return true;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // Abonnement expiré ou révoqué (notifications coupées, navigateur réinitialisé).
        if (status === 404 || status === 410) {
          await prisma.$executeRaw`delete from public.web_push_subscriptions where endpoint = ${s.endpoint}`.catch(() => {});
        } else {
          console.error("[sendWebPush]", status, e);
        }
        return false;
      }
    })
  );
  return results.some(Boolean);
}

/** Utilisateurs ayant au moins un ordinateur abonné. */
export async function usersWithWebPush(userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  try {
    const rows = await prisma.$queryRaw<{ user_id: string }[]>`
      select distinct user_id::text as user_id from public.web_push_subscriptions where user_id = any(${userIds}::uuid[])`;
    return new Set(rows.map((r) => r.user_id));
  } catch (e) {
    // Table pas encore créée : seuls les téléphones reçoivent.
    console.error("[usersWithWebPush]", e);
    return new Set();
  }
}

export async function saveWebPushSubscription(userId: string, sub: Subscription, userAgent: string | null) {
  await prisma.$executeRaw`
    insert into public.web_push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
    values (${sub.endpoint}, ${userId}::uuid, ${sub.p256dh}, ${sub.auth}, ${userAgent})
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      user_agent = excluded.user_agent`;
}

export async function deleteWebPushSubscription(userId: string, endpoint: string) {
  await prisma.$executeRaw`delete from public.web_push_subscriptions where endpoint = ${endpoint} and user_id = ${userId}::uuid`;
}
