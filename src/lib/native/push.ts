"use client";

import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";

// Push de l'appli mobile (coque Capacitor, capacitor.config.ts) : jeton FCM du téléphone enregistré
// dans fcm_tokens, lu par la fonction send_push_v1 (rappels d'événement, /api/cron/event-reminders).
// Sans effet dans un navigateur.

const TOKEN_KEY = "board-lgef:fcm-token";
let listenersReady = false;

const readToken = () => {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (token: string | null) => {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // stockage indisponible : le jeton sera simplement réenregistré au prochain lancement
  }
};

/** Demande l'autorisation, crée le canal Android et enregistre le jeton du téléphone pour l'utilisateur connecté. */
export async function registerNativePush() {
  if (!Capacitor.isNativePlatform()) return;
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;

    // Canal attendu par send_push_v1 (android.notification.channel_id).
    if (platform === "android") {
      await PushNotifications.createChannel({
        id: "push_default",
        name: "Notifications",
        description: "Rappels et notifications du board LGEF",
        importance: 5,
        visibility: 1,
        sound: "default",
        lights: true,
        vibration: true,
      }).catch(() => {});
    }

    if (!listenersReady) {
      listenersReady = true;
      await PushNotifications.addListener("registration", async ({ value }) => {
        if (!value) return;
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) return;
        // Un téléphone = une ligne : le jeton est retiré puis réinséré pour le compte connecté.
        await supabase.from("fcm_tokens").delete().eq("token", value);
        const { error } = await supabase.from("fcm_tokens").insert({ user_id: session.user.id, token: value, device_platform: platform });
        if (error) console.error("[registerNativePush]", error);
        else writeToken(value);
      });
      await PushNotifications.addListener("registrationError", (e) => console.error("[registerNativePush]", e));
      // Toucher une notification : ouvre l'écran concerné (ex. /?openEvent=<id>).
      await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
        const route = notification?.data?.route;
        if (typeof route === "string" && route.startsWith("/")) window.location.href = route;
      });
    }
    await PushNotifications.register();
  } catch (e) {
    console.warn("[registerNativePush]", e);
  }
}

/** Déconnexion : ce téléphone ne reçoit plus les push de ce compte. */
export async function unregisterNativePush() {
  if (!Capacitor.isNativePlatform()) return;
  const token = readToken();
  if (!token) return;
  await createClient().from("fcm_tokens").delete().eq("token", token);
  writeToken(null);
}
