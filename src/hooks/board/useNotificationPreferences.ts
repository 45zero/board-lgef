"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { FraisCategory, FraisPrefValue, NotificationPrefs } from "@/lib/board/notificationPrefs";

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
  const [fraisPrefs, setFraisPrefsState] = useState<NotificationPrefs>({});
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
          setFraisPrefsState((data.notification_prefs ?? {}) as NotificationPrefs);
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
   * Module Frais : tout de suite, au plus toutes les 12 h, ou board seulement, par catégorie
   * (notificationPrefs.ts). Relu avant d'écrire pour garder la date du dernier rappel posée par le serveur.
   */
  const setFraisPref = async (category: FraisCategory, value: FraisPrefValue) => {
    setFraisPrefsState((prev) => ({ ...prev, [category]: value }));
    if (!user?.id) return;
    const supabase = createClient();
    const { data } = await supabase.from("profiles").select("notification_prefs").eq("id", user.id).single();
    const current = (data?.notification_prefs ?? {}) as NotificationPrefs;
    await supabase.from("profiles").update({ notification_prefs: { ...current, [category]: value } }).eq("id", user.id);
  };

  return {
    fraisPrefs,
    setFraisPref,
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
