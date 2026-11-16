"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AtSign, Bell, BellOff, BellRing, CalendarDays, Info, MessageCircle, Newspaper, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ComingSoon, useFiefHref } from "@/components/fief/ui";
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
    window.addEventListener(NOTIFS_READ_EVENT, onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTIFS_READ_EVENT, onFocus);
    };
  }, []);
  return count;
}

/** Prévient la cloche que des notifications viennent d'être lues. */
const NOTIFS_READ_EVENT = "fief:notifs-read";

interface Notif {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  route: string | null;
  read_at: string | null;
  created_at: string;
}

function ago(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h} h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `Il y a ${d} j` : new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// Une icône par type ; type inconnu (ajouté plus tard) : icône par défaut, jamais de plantage.
const ICONS: Record<string, typeof Info> = { event: CalendarDays, membership: UserCheck, info: Info, comment: MessageCircle, message: MessageCircle, post: Newspaper, mention: AtSign };

/**
 * Liste des notifications (page Notifications et fenêtre de la cloche). Ouvrir la liste les marque
 * comme lues en base ; l'affichage garde l'état d'arrivée.
 */
export function NotificationsList({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const href = useFiefHref();
  const [rows, setRows] = useState<Notif[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("fief_notifications")
      .select("id, kind, title, body, route, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(compact ? 30 : 100)
      .then(async ({ data }) => {
        setRows((data ?? []) as Notif[]);
        if (data?.some((n) => !n.read_at)) {
          await supabase.from("fief_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
          window.dispatchEvent(new Event(NOTIFS_READ_EVENT));
        }
      });
  }, [compact]);

  const unread = (rows ?? []).filter((n) => !n.read_at).length;
  const shown = (rows ?? []).filter((n) => filter === "all" || !n.read_at);
  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      <div className="flex gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${filter === f ? "bg-f-accent text-white" : compact ? "bg-f-subtle text-f-text" : "bg-f-surface text-f-text"}`}
          >
            {f === "all" ? "Toutes" : `Non lues${unread ? ` (${unread})` : ""}`}
          </button>
        ))}
      </div>
      {rows === null && <p className="text-sm text-f-muted">Chargement…</p>}
      {rows && shown.length === 0 &&
        (compact ? (
          <p className="px-2 py-6 text-center text-sm text-f-muted">Rien de nouveau.</p>
        ) : (
          <ComingSoon icon={Bell} title="Rien de nouveau" text="Vous serez prévenue ici dès qu'un événement FIEF vous concerne." />
        ))}
      <div className={compact ? "space-y-0.5" : "space-y-2"}>
        {shown.map((n) => {
          const I = ICONS[n.kind] ?? Bell;
          const box = compact ? "flex items-start gap-3 rounded-xl p-2.5 hover:bg-f-subtle" : "flex items-start gap-3 rounded-2xl bg-f-surface p-4 border border-f-border hover:ring-2 hover:ring-f-accent/15";
          const content = (
            <>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${n.read_at ? "bg-f-subtle text-f-link" : "bg-f-danger-bg text-[#D7262E]"}`}>
                <I size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block ${compact ? "text-sm" : ""} font-bold`}>{n.title}</span>
                {n.body && <span className={`block ${compact ? "line-clamp-2 text-xs" : "text-sm"} text-f-muted`}>{n.body}</span>}
                <span className={`block text-xs ${n.read_at ? "text-f-faint" : "font-semibold text-f-link"}`}>{ago(n.created_at)}</span>
              </span>
              {!n.read_at && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#D7262E]" />}
            </>
          );
          return n.route ? (
            <Link key={n.id} href={href(n.route)} onClick={onNavigate} className={box}>
              {content}
            </Link>
          ) : (
            <div key={n.id} className={box}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
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
