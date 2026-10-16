"use client";

import { Capacitor } from "@capacitor/core";
import { subscribeWebPush, unsubscribeWebPush } from "@/app/actions/web-push";

// Notifications sur ordinateur (Web Push) : service worker public/sw.js, abonnement enregistré par
// l'action subscribeWebPush. Dans l'appli mobile, ce sont les push natifs (src/lib/native/push.ts).

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/** Dans l'appli mobile : push natifs, pas de réglage « ordinateur ». */
export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

/** Ce qui empêche les notifications dans ce navigateur (null si rien), affiché dans les Paramètres. */
export function webPushIssue(): string | null {
  if (typeof window === "undefined") return "Navigateur indisponible";
  if (!VAPID_PUBLIC_KEY) return "Clé de notification absente de cette version du board";
  if (!window.isSecureContext) return "Page non sécurisée (https requis)";
  if (!("serviceWorker" in navigator)) return "Service worker indisponible (navigation privée ou Mode Isolement ?)";
  if (!("PushManager" in window) || !("Notification" in window))
    return "Ce navigateur ne gère pas les notifications web : mettez à jour Safari ou utilisez Chrome";
  return null;
}

export function webPushSupported() {
  return typeof window !== "undefined" && !isNativeApp() && webPushIssue() === null;
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

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  await subscribeWebPush({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" });
}

/**
 * Service worker installé à l'avance (dès l'affichage du réglage ou de la proposition) : Safari
 * n'accepte pushManager.subscribe() que dans la foulée immédiate d'un clic, sans attente préalable.
 */
let readyRegistration: ServiceWorkerRegistration | null = null;
export async function prepareWebPush() {
  if (!webPushSupported()) return;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  readyRegistration = await navigator.serviceWorker.ready;
}

/**
 * Ce navigateur reçoit-il déjà les notifications ? Si oui, l'abonnement est renvoyé au serveur
 * (enregistrement idempotent) : un abonnement du navigateur jamais arrivé en base est ainsi rattrapé.
 */
export async function isWebPushEnabled() {
  if (!webPushSupported()) return false;
  await prepareWebPush();
  if (Notification.permission !== "granted") return false;
  const sub = await currentSubscription();
  if (!sub) return false;
  await saveSubscription(sub);
  return true;
}

/**
 * Abonne ce navigateur — à appeler directement depuis un clic. subscribe() est le premier appel
 * (Safari l'exige) et affiche lui-même la demande d'autorisation du système, dans tous les navigateurs.
 * Renvoie « denied » si l'utilisateur a refusé (à réactiver dans les réglages du navigateur / du Mac).
 */
export async function enableWebPush(): Promise<"ok" | "denied" | "unsupported"> {
  if (!webPushSupported()) return "unsupported";
  const reg = readyRegistration ?? (await prepareWebPush().then(() => readyRegistration));
  if (!reg) return "unsupported";
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) });
  } catch (e) {
    if (Notification.permission === "denied") return "denied";
    throw e;
  }
  await saveSubscription(sub);
  return "ok";
}

export async function disableWebPush() {
  if (!webPushSupported()) return;
  const sub = await currentSubscription();
  if (!sub) return;
  await unsubscribeWebPush(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
