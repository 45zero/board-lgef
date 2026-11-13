"use client";

import { createClient } from "@/lib/supabase/client";

// Notifications push FIEF côté navigateur : service worker public/fief/sw.js, abonnement enregistré
// directement dans fief_push_subscriptions (RLS : sa propre ligne) — pas de server action, interdites
// aux comptes FIEF (src/proxy.ts). Sur iPhone, les push ne marchent qu'une fois FIEF ajouté à l'écran d'accueil.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export type FiefPushState = "unsupported" | "ios-install" | "denied" | "off" | "on";

const onFiefHost = () => window.location.host.startsWith("fief.");
const swUrl = () => (onFiefHost() ? "/sw.js" : "/fief/sw.js");
const swScope = () => (onFiefHost() ? "/" : "/fief/");

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function save(sub: PushSubscription) {
  const json = sub.toJSON();
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase
    .from("fief_push_subscriptions")
    .upsert({ endpoint: sub.endpoint, user_id: data.user.id, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" }, { onConflict: "endpoint" });
}

/** État actuel ; si l'appareil est déjà abonné, l'abonnement est renvoyé en base (rattrapage). */
export async function fiefPushState(): Promise<FiefPushState> {
  if (typeof window === "undefined" || !VAPID_PUBLIC_KEY || !window.isSecureContext) return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration(swScope());
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await save(sub).catch(() => {});
    return "on";
  }
  return "off";
}

/** À appeler dans la foulée d'un clic (Safari l'exige). */
export async function enableFiefPush(): Promise<FiefPushState> {
  if (!VAPID_PUBLIC_KEY) return "unsupported";
  const reg = await navigator.serviceWorker.register(swUrl(), { scope: swScope() });
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  await save(sub);
  return "on";
}

export async function disableFiefPush(): Promise<FiefPushState> {
  const reg = await navigator.serviceWorker.getRegistration(swScope());
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await createClient().from("fief_push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  return "off";
}
