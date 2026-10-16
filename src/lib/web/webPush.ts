"use client";

import { Capacitor } from "@capacitor/core";
import { subscribeWebPush, unsubscribeWebPush } from "@/app/actions/web-push";

// Notifications sur ordinateur (Web Push) : service worker public/sw.js, abonnement enregistré par
// l'action subscribeWebPush. Dans l'appli mobile, ce sont les push natifs (src/lib/native/push.ts).

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function webPushSupported() {
  return (
    typeof window !== "undefined" &&
    !Capacitor.isNativePlatform() &&
    !!VAPID_PUBLIC_KEY &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Ce navigateur reçoit-il déjà les notifications ? */
export async function isWebPushEnabled() {
  if (!webPushSupported() || Notification.permission !== "granted") return false;
  return !!(await currentSubscription());
}

/**
 * Demande l'autorisation (à appeler depuis un clic : Safari l'exige) et abonne ce navigateur.
 * Renvoie « denied » si l'utilisateur a refusé (à réactiver dans les réglages du navigateur / du Mac).
 */
export async function enableWebPush(): Promise<"ok" | "denied" | "unsupported"> {
  if (!webPushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) }));
  const json = sub.toJSON();
  await subscribeWebPush({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" });
  return "ok";
}

export async function disableWebPush() {
  if (!webPushSupported()) return;
  const sub = await currentSubscription();
  if (!sub) return;
  await unsubscribeWebPush(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
