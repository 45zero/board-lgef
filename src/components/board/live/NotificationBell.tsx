"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useLive, type BoardNotification } from "@/components/board/live/LiveProvider";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

/**
 * Cloche des notifications : compteur des non lues en direct, liste des 30 dernières. Un clic
 * marque comme lu et ouvre l'événement concerné.
 */
export function NotificationBell({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const { notifications, unread, markRead, markAllRead } = useLive();
  const { open: openEvent } = useOpenEvent();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const click = (n: BoardNotification) => {
    void markRead(n.id);
    if (n.event_id) {
      setOpen(false);
      void openEvent(n.event_id);
    }
  };

  const mobile = variant === "mobile";
  const label = unread > 99 ? "99+" : String(unread);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          mobile
            ? "relative flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/10"
            : "relative flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-hover"
        }
        aria-label={`Notifications${unread ? ` (${unread} non lues)` : ""}`}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span
            className={`absolute flex items-center justify-center rounded-full bg-red font-bold text-white ${
              mobile ? "right-0 top-0 h-4 min-w-4 px-1 text-[9px]" : "-right-1 -top-1 h-4 min-w-4 px-1 text-[10px] ring-2 ring-card"
            }`}
          >
            {label}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`z-[70] overflow-hidden rounded-modal border border-line bg-card shadow-modal ${
            mobile ? "fixed inset-x-2 top-14" : "absolute right-0 mt-2 w-[380px]"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-bold text-ink">
              Notifications{unread > 0 && <span className="ml-1.5 text-xs font-semibold text-red">{unread} non lue{unread > 1 ? "s" : ""}</span>}
            </span>
            {unread > 0 && (
              <button onClick={() => void markAllRead()} className="flex items-center gap-1 text-xs font-semibold text-link hover:underline">
                <CheckCheck size={13} /> Tout marquer comme lu
              </button>
            )}
          </div>
          <div className="max-h-[min(480px,70vh)] overflow-y-auto">
            {notifications.length === 0 && <p className="p-6 text-center text-sm text-ink-4">Aucune notification.</p>}
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => click(n)}
                className={`flex w-full items-start gap-2.5 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover ${n.read ? "" : "bg-sel-bg/40"}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-red"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.read ? "font-semibold text-ink-2" : "font-bold text-ink"}`}>{n.title}</span>
                  <span className="block text-xs text-ink-3">{n.message}</span>
                  <span className="mt-0.5 block text-[10px] text-ink-4">
                    {ago(n.created_at)}
                    {n.actor_name ? ` · ${n.actor_name}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
