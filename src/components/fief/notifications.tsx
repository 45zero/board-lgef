"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { disableFiefPush, enableFiefPush, fiefPushState, type FiefPushState } from "@/lib/fief/pushClient";

// Notifications FIEF côté membre : cloche (non lues), activation des push sur l'appareil.

/** Nombre de notifications non lues de la membre connectée (RLS : les siennes). */
export function useFiefUnread() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      createClient()
        .from("fief_notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
        .then(({ count: c }) => {
          if (alive) setCount(c ?? 0);
        });
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return count;
}

export function BellLink({ href }: { href: string }) {
  const unread = useFiefUnread();
  return (
    <Link
      href={href}
      aria-label={unread ? `${unread} notification(s) non lue(s)` : "Notifications"}
      className="relative flex h-10 w-10 items-center justify-center rounded-full text-white/85 hover:bg-white/10"
    >
      <Bell size={20} />
      {unread > 0 && (
        <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-[#D7262E] px-1 text-center text-[10px] font-bold leading-[18px] text-white">{unread > 9 ? "9+" : unread}</span>
      )}
    </Link>
  );
}

/** Carte « Activer les notifications » (accueil) ou ligne de réglage (profil). */
export function PushToggle({ variant = "card" }: { variant?: "card" | "row" }) {
  const [state, setState] = useState<FiefPushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fiefPushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      setState(state === "on" ? await disableFiefPush() : await enableFiefPush());
    } catch {
      setState("unsupported");
    }
    setBusy(false);
  };

  if (state === null || (variant === "card" && (state === "on" || state === "unsupported"))) return null;
  const hint =
    state === "ios-install"
      ? "Sur iPhone : touchez Partager puis « Sur l'écran d'accueil », ouvrez FIEF depuis l'icône, puis activez les notifications."
      : state === "denied"
        ? "Les notifications sont bloquées pour FIEF dans les réglages de votre navigateur ou de votre téléphone."
        : state === "unsupported"
          ? "Ce navigateur ne permet pas les notifications : vous les recevrez par e-mail."
          : state === "on"
            ? "Vous êtes prévenue sur cet appareil dès qu'un événement vous concerne."
            : "Soyez prévenue sur cet appareil dès qu'un événement vous concerne.";
  const canToggle = state === "on" || state === "off";

  if (variant === "row")
    return (
      <div className="flex items-center gap-3 rounded-3xl bg-f-surface p-5 border border-f-border">
        {state === "on" ? <BellRing size={22} className="text-f-text" /> : <BellOff size={22} className="text-f-faint" />}
        <div className="min-w-0 flex-1">
          <p className="font-bold">Notifications sur cet appareil</p>
          <p className="text-sm text-f-muted">{hint}</p>
        </div>
        {canToggle && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggle()}
            className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold disabled:opacity-60 ${state === "on" ? "border-2 border-f-accent text-f-text" : "bg-f-accent text-white"}`}
          >
            {state === "on" ? "Désactiver" : "Activer"}
          </button>
        )}
      </div>
    );

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-f-warn-border bg-f-warn-bg p-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#D7262E] text-white">
        <BellRing size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">Activer les notifications</p>
        <p className="text-sm text-f-muted">{hint}</p>
      </div>
      {canToggle && (
        <button type="button" disabled={busy} onClick={() => void toggle()} className="shrink-0 rounded-xl bg-f-accent px-3.5 py-2 text-sm font-bold text-white disabled:opacity-60">
          Activer
        </button>
      )}
    </div>
  );
}
