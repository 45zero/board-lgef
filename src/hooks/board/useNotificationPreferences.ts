"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("notify_email, notify_push, hate_alert_email, hate_alert_push, daily_digest_email")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setNotifyEmailState(data.notify_email);
          setNotifyPushState(data.notify_push);
          setHateAlertEmailState(data.hate_alert_email);
          setHateAlertPushState(data.hate_alert_push);
          setDailyDigestState(data.daily_digest_email);
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

  return {
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
