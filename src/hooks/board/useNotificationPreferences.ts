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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("notify_email, notify_push")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setNotifyEmailState(data.notify_email);
          setNotifyPushState(data.notify_push);
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

  return { notifyEmail, notifyPush, setNotifyEmail, setNotifyPush, loaded };
}
