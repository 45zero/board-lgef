"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { readCache, writeCache } from "@/lib/board/localCache";
import type { AppBadges } from "@/app/api/badges/route";

// Board en direct : UN canal Supabase Realtime par utilisateur. Chaque changement d'une table
// publiée (sql/2026-09-27_live.sql) — que la RLS l'autorise à voir — prévient les écrans abonnés
// (useLiveRefresh), recalcule les pastilles et, pour ses propres notifications, met la cloche à
// jour instantanément. Les mails (Gmail, hors base) sont interrogés toutes les 30 s onglet visible.

export const LIVE_TABLES = [
  "events",
  "coverage_requests",
  "director_attendance",
  "event_assignments",
  "event_team_members",
  "media_publications",
  "comment_moderation",
  "event_registration_campaigns",
  "event_registration_recipients",
  "event_expenses",
  "expense_submissions",
  "match_details",
  "photo_missions",
  "module_access",
  "team_boards",
  "team_lists",
  "team_cards",
  "team_card_members",
  "team_checklist_items",
  "team_card_comments",
] as const;
export type LiveTable = (typeof LIVE_TABLES)[number] | "notifications" | "mails";

export type BoardNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  event_id: string | null;
  actor_name: string | null;
  data: { team_card_id?: string; support_ticket_id?: string } | null;
};

type Listener = { tables: Set<LiveTable> | null; fn: () => void };

type LiveContextValue = {
  subscribe: (tables: LiveTable[] | null, fn: () => void) => () => void;
  badges: Partial<AppBadges> | null;
  notifications: BoardNotification[];
  unread: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Supprime des notifications (is_deleted) : toutes si `ids` est absent. */
  removeNotifications: (ids?: string[]) => Promise<void>;
};

const LiveContext = createContext<LiveContextValue | null>(null);

const MAILS_EVERY_MS = 30_000;
const DB_FALLBACK_MS = 120_000;
const NOTIF_FIELDS = "id, type, title, message, read, created_at, event_id, actor_name, data";

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const listeners = useRef(new Set<Listener>());
  const [badges, setBadges] = useState<Partial<AppBadges> | null>(() => readCache<AppBadges>("badges") ?? null);
  const [notifications, setNotifications] = useState<BoardNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const emit = useCallback((table: LiveTable) => {
    for (const l of listeners.current) if (!l.tables || l.tables.has(table)) l.fn();
  }, []);

  const subscribe = useCallback((tables: LiveTable[] | null, fn: () => void) => {
    const l: Listener = { tables: tables ? new Set(tables) : null, fn };
    listeners.current.add(l);
    return () => void listeners.current.delete(l);
  }, []);

  /* ---------- Pastilles ---------- */

  const lastMails = useRef<number | null>(null);
  const loadBadges = useCallback(
    async (scope?: "db" | "mails") => {
      try {
        const res = await fetch(`/api/badges${scope ? `?scope=${scope}` : ""}`);
        if (!res.ok) return;
        const part = (await res.json()) as Partial<AppBadges>;
        const defined = Object.fromEntries(Object.entries(part).filter(([, v]) => v !== undefined)) as Partial<AppBadges>;
        setBadges((prev) => {
          const next = { ...(prev ?? {}), ...defined };
          writeCache("badges", next);
          return next;
        });
        // Nouveau mail (ou mail lu ailleurs) : les écrans Mails se rafraîchissent.
        if (defined.mails !== undefined) {
          if (lastMails.current !== null && defined.mails !== lastMails.current) emit("mails");
          lastMails.current = defined.mails;
        }
      } catch {
        // hors ligne : on garde les derniers compteurs
      }
    },
    [emit]
  );

  // Recalcul des compteurs de la base, regroupé (plusieurs changements d'affilée = un seul appel).
  const dbTimer = useRef<number | null>(null);
  const scheduleDbBadges = useCallback(() => {
    if (dbTimer.current) window.clearTimeout(dbTimer.current);
    dbTimer.current = window.setTimeout(() => void loadBadges("db"), 800);
  }, [loadBadges]);

  useEffect(() => {
    if (!userId) return;
    queueMicrotask(() => void loadBadges());
    const visible = () => document.visibilityState === "visible";
    const mails = window.setInterval(() => visible() && void loadBadges("mails"), MAILS_EVERY_MS);
    const db = window.setInterval(() => visible() && void loadBadges("db"), DB_FALLBACK_MS);
    const onVisible = () => visible() && void loadBadges();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(mails);
      window.clearInterval(db);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, loadBadges]);

  /* ---------- Notifications ---------- */

  const loadNotifications = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();
    const [{ data }, { count }] = await Promise.all([
      supabase
        .from("notifications")
        .select(NOTIF_FIELDS)
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_deleted", false).eq("read", false),
    ]);
    setNotifications(((data ?? []) as BoardNotification[]).map((n) => ({ ...n, read: !!n.read })));
    setUnread(count ?? 0);
  }, [userId]);

  useEffect(() => {
    queueMicrotask(() => void loadNotifications());
  }, [loadNotifications]);

  const markRead = useCallback(
    async (id: string) => {
      const target = notifications.find((n) => n.id === id);
      if (!target || target.read || !userId) return;
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
      await createClient().from("notifications").update({ read: true }).eq("id", id).eq("user_id", userId);
    },
    [notifications, userId]
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await createClient().from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  }, [userId]);

  const removeNotifications = useCallback(
    async (ids?: string[]) => {
      if (!userId) return;
      const gone = new Set(ids ?? notifications.map((n) => n.id));
      const unreadGone = notifications.filter((n) => gone.has(n.id) && !n.read).length;
      setNotifications((prev) => prev.filter((n) => !gone.has(n.id)));
      setUnread((u) => Math.max(0, u - unreadGone));
      let query = createClient().from("notifications").update({ is_deleted: true, read: true }).eq("user_id", userId);
      if (ids) query = query.in("id", ids);
      await query;
    },
    [notifications, userId]
  );

  /* ---------- Canal temps réel ---------- */

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase.channel(`board-live-${userId}-${crypto.randomUUID()}`);
    for (const table of LIVE_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        emit(table);
        scheduleDbBadges();
      });
    }
    // Filtre obligatoire : les admins ont le droit de lire les notifications de tout le monde.
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
      const n = payload.new as BoardNotification & { is_deleted?: boolean };
      if (n.is_deleted) return;
      setNotifications((prev) => [{ ...n, read: !!n.read }, ...prev.filter((p) => p.id !== n.id)].slice(0, 30));
      if (!n.read) setUnread((u) => u + 1);
      emit("notifications");
      scheduleDbBadges();
    });
    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => {
      void loadNotifications();
    });
    channel.subscribe((status) => {
      // (Re)connexion après une veille ou une coupure réseau : on rattrape ce qui a pu être manqué.
      if (status === "SUBSCRIBED") {
        void loadNotifications();
        scheduleDbBadges();
      }
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, emit, scheduleDbBadges, loadNotifications]);

  const value = useMemo(
    () => ({ subscribe, badges, notifications, unread, markRead, markAllRead, removeNotifications }),
    [subscribe, badges, notifications, unread, markRead, markAllRead, removeNotifications]
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive doit être utilisé sous <LiveProvider>.");
  return ctx;
}

/**
 * Relance `fn` dès qu'une des tables change (toutes si `tables` est nul), regroupé sur `delay` ms
 * pour qu'une rafale de changements ne déclenche qu'un rechargement.
 */
export function useLiveRefresh(tables: LiveTable[] | null, fn: () => void, delay = 600) {
  const { subscribe } = useLive();
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const key = tables ? tables.join(",") : "*";
  useEffect(() => {
    let timer: number | null = null;
    const unsubscribe = subscribe(key === "*" ? null : (key.split(",") as LiveTable[]), () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => fnRef.current(), delay);
    });
    return () => {
      unsubscribe();
      if (timer) window.clearTimeout(timer);
    };
  }, [subscribe, key, delay]);
}
