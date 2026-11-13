"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, CalendarDays, Info, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ComingSoon, useFiefHref } from "@/components/fief/ui";
import { MemberGate } from "@/components/fief/shell";
import { PushToggle } from "@/components/fief/notifications";

// Notifications FIEF de la membre (fief_notifications) : toutes / non lues ; ouvrir la page marque comme lu.

interface Notif {
  id: string;
  kind: "event" | "membership" | "info";
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

const ICONS = { event: CalendarDays, membership: UserCheck, info: Info } as const;

function Notifications() {
  const href = useFiefHref();
  const [rows, setRows] = useState<Notif[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("fief_notifications")
      .select("id, kind, title, body, route, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setRows((data ?? []) as Notif[]);
        // Vues : marquées comme lues en base (l'affichage garde l'état d'arrivée).
        if (data?.some((n) => !n.read_at)) void supabase.from("fief_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
      });
  }, []);

  const unread = (rows ?? []).filter((n) => !n.read_at).length;
  const shown = (rows ?? []).filter((n) => filter === "all" || !n.read_at);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-extrabold">Notifications</h1>
      <PushToggle variant="row" />
      <div className="flex gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${filter === f ? "bg-f-accent text-white" : "bg-f-surface text-f-text"}`}>
            {f === "all" ? "Toutes" : `Non lues${unread ? ` (${unread})` : ""}`}
          </button>
        ))}
      </div>
      {rows === null && <p className="text-sm text-f-muted">Chargement…</p>}
      {rows && shown.length === 0 && <ComingSoon icon={Bell} title="Rien de nouveau" text="Vous serez prévenue ici dès qu'un événement FIEF vous concerne." />}
      <div className="space-y-2">
        {shown.map((n) => {
          const I = ICONS[n.kind];
          const content = (
            <>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${n.read_at ? "bg-f-subtle text-f-link" : "bg-f-danger-bg text-[#D7262E]"}`}>
                <I size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{n.title}</span>
                {n.body && <span className="block text-sm text-f-muted">{n.body}</span>}
                <span className="block text-xs text-f-faint">{ago(n.created_at)}</span>
              </span>
              {!n.read_at && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#D7262E]" />}
            </>
          );
          return n.route ? (
            <Link key={n.id} href={href(n.route)} className="flex items-start gap-3 rounded-2xl bg-f-surface p-4 border border-f-border hover:ring-2 hover:ring-f-accent/15">
              {content}
            </Link>
          ) : (
            <div key={n.id} className="flex items-start gap-3 rounded-2xl bg-f-surface p-4 border border-f-border">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FiefNotificationsPage() {
  return <MemberGate>{() => <Notifications />}</MemberGate>;
}
