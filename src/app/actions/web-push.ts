"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { saveWebPushSubscription, deleteWebPushSubscription } from "@/lib/push/webPush";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  return user.id;
}

/** Enregistre l'abonnement Web Push de ce navigateur pour l'utilisateur connecté (Paramètres > Notifications). */
export async function subscribeWebPush(sub: { endpoint: string; p256dh: string; auth: string }) {
  const userId = await requireUserId();
  if (!/^https:\/\//.test(sub.endpoint) || !sub.p256dh || !sub.auth) throw new Error("Abonnement invalide");
  const userAgent = (await headers()).get("user-agent");
  await saveWebPushSubscription(userId, sub, userAgent?.slice(0, 300) ?? null);
}

export async function unsubscribeWebPush(endpoint: string) {
  const userId = await requireUserId();
  await deleteWebPushSubscription(userId, endpoint);
}
