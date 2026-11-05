"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Channel, NotificationCategory, NotificationPrefs } from "@/lib/board/notificationPrefs";

/** Préférences de notification propres au compte (pas au device) — email et push,
 * lues/écrites sur profiles. Le push n'a pas encore de canal de livraison réel
 * (pas de PWA/service worker) ; ce réglage prépare le terrain. */
export function useNotificationPreferences() {
  const { user } = useAuth();
  const [notifyEmail, setNotifyEmailState] = useState(true);
  const [notifyPush, setNotifyPushState] = useState(true);
  const [hateAlertEmail, setHateAlertEmailState] = useState(true);
  const [hateAlertPush, setHateAlertPushState] = useState(true);
  const [dailyDigest, setDailyDigestState] = useState(false);
  const [prefs, setPrefsState] = useState<NotificationPrefs>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("notify_email, notify_push, hate_alert_email, hate_alert_push, daily_digest_email, notification_prefs")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setNotifyEmailState(data.notify_email);
          setNotifyPushState(data.notify_push);
          setHateAlertEmailState(data.hate_alert_email);
          setHateAlertPushState(data.hate_alert_push);
          setDailyDigestState(data.daily_digest_email);
          setPrefsState((data.notification_prefs ?? {}) as NotificationPrefs);
        }
        setLoaded(true);
      });
  }, [user?.id]);

  const setNotifyEmail = async (value: boolean) => {
    setNotifyEmailState(value);
    if (!user?.id) return;
    const supabase = createClient();
    await supabase.from("profiles").update({ notify_email: value }).eq("id", user.id);
  };

  const setNotifyPush = async (value: boolean) => {
    setNotifyPushState(value);
    if (!user?.id) return;
    const supabase = createClient();
    await supabase.from("profiles").update({ notify_push: value }).eq("id", user.id);
  };

  /** Alertes « commentaire haineux » (modération des publications) — canaux propres, indépendants des notifications générales. */
  const setHateAlertEmail = async (value: boolean) => {
    setHateAlertEmailState(value);
    if (!user?.id) return;
    await createClient().from("profiles").update({ hate_alert_email: value }).eq("id", user.id);
  };

  const setHateAlertPush = async (value: boolean) => {
    setHateAlertPushState(value);
    if (!user?.id) return;
    await createClient().from("profiles").update({ hate_alert_push: value }).eq("id", user.id);
  };

  /** Programme de la journée par e-mail à 7 h (voir /api/cron/daily-digest). */
  const setDailyDigest = async (value: boolean) => {
    setDailyDigestState(value);
    if (!user?.id) return;
    await createClient().from("profiles").update({ daily_digest_email: value }).eq("id", user.id);
  };

  /**
   * Écrit une modification des préférences par application (notificationPrefs.ts). Relu avant
   * d'écrire pour garder la date du dernier rappel « à valider » posée par le serveur.
   */
  const patchPrefs = async (change: (p: NotificationPrefs) => NotificationPrefs) => {
    setPrefsState((prev) => change(prev));
    if (!user?.id) return;
    const supabase = createClient();
    const { data } = await supabase.from("profiles").select("notification_prefs").eq("id", user.id).single();
    const next = change((data?.notification_prefs ?? {}) as NotificationPrefs);
    await supabase.from("profiles").update({ notification_prefs: next as never }).eq("id", user.id);
  };

  /** E-mail et/ou push pour une catégorie. */
  const setChannel = (category: NotificationCategory, channel: Channel, value: boolean) =>
    patchPrefs((p) => ({ ...p, channels: { ...p.channels, [category]: { ...p.channels?.[category], [channel]: value } } }));

  /** « À valider » : au plus un e-mail / push toutes les 12 h. */
  const setGrouped = (value: boolean) => patchPrefs((p) => ({ ...p, frais_a_valider_grouped: value }));

  return {
    prefs,
    setChannel,
    setGrouped,
    dailyDigest,
    setDailyDigest,
    notifyEmail,
    notifyPush,
    setNotifyEmail,
    setNotifyPush,
    hateAlertEmail,
    hateAlertPush,
    setHateAlertEmail,
    setHateAlertPush,
    loaded,
  };
}
