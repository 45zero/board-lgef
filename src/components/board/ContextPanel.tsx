"use client";

import { useEffect, useState } from "react";
import { Bell, CalendarDays, ChevronRight, MapPin, SquareKanban, X } from "lucide-react";
import type { ContextPanelWidgets } from "@/hooks/board/useBoardPreferences";
import type { Recap } from "@/app/api/dashboard/recap/route";
import { useLive, useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";
import { useOpenTeamCard } from "@/components/board/team/TeamCardOpener";
import { readCache, writeCache } from "@/lib/board/localCache";
import { EVENT_TYPE_TO_ORG } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS } from "@/lib/board/tokens";

// Récapitulatif (colonne de droite de l'accueil, des Mails et du Calendrier) : événements du jour,
// mes cartes de l'Espace Team à traiter, et l'activité (mes dernières notifications).

const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return `il y a ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : `il y a ${d} jours`;
}

function Title({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-4">
      {children}
      {!!count && <span className="rounded-full bg-subtle px-1.5 text-[9px] font-bold text-ink-3">{count}</span>}
    </div>
  );
}

function Empty({ icon: Icon, children }: { icon: typeof Bell; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-btn border border-dashed border-line p-3 text-xs text-ink-4">
      <Icon size={14} className="shrink-0" /> {children}
    </div>
  );
}

export function ContextPanel({ widgets, onClose }: { widgets: ContextPanelWidgets; onClose: () => void }) {
  const [recap, setRecap] = useState<Recap | null>(() => readCache<Recap>("recap") ?? null);
  const [reloadKey, setReloadKey] = useState(0);
  // Heure de référence (« En cours », « En retard »), mise à jour à chaque relecture.
  const [now, setNow] = useState(() => Date.now());
  const { notifications, removeNotifications } = useLive();
  const { open: openEvent } = useOpenEvent();
  const { open: openCard } = useOpenTeamCard();
  // Une carte, un événement ou une notification qui change : récapitulatif relu.
  useLiveRefresh(null, () => setReloadKey((k) => k + 1), 1500);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/recap")
      .then((r) => (r.ok ? (r.json() as Promise<Recap>) : Promise.reject()))
      .then((r) => {
        if (cancelled) return;
        setRecap(r);
        setNow(Date.now());
        writeCache("recap", r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const activity = notifications.slice(0, 6);

  return (
    <aside className="hidden w-[280px] shrink-0 flex-col gap-5 overflow-y-auto rounded-panel border border-line bg-card/70 p-4 shadow-bar backdrop-blur xl:flex">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Récapitulatif</h3>
        <button onClick={onClose} className="text-ink-4 hover:text-ink" aria-label="Fermer le récapitulatif">
          <ChevronRight size={14} />
        </button>
      </div>

      {widgets.today && (
        <div>
          <Title count={recap?.today.length}>Aujourd&rsquo;hui à la Ligue</Title>
          {!recap ? (
            <div className="h-16 animate-pulse rounded-btn bg-subtle" />
          ) : recap.today.length === 0 ? (
            <Empty icon={CalendarDays}>Aucun événement aujourd&rsquo;hui.</Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {recap.today.map((e) => {
                const org = e.eventType ? EVENT_TYPE_TO_ORG[e.eventType] : null;
                const color = org ? ORG_COLORS[org] : null;
                const live = now >= new Date(e.start).getTime() && now < new Date(e.end).getTime();
                return (
                  <button
                    key={e.id}
                    onClick={() => void openEvent(e.id)}
                    className="rounded-btn border-l-4 p-2.5 text-left transition hover:brightness-95"
                    style={{ borderLeftColor: color?.base ?? "var(--navy)", background: color?.bg ?? "var(--sel-bg)" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-ink">{time(e.start)}</span>
                      {live ? (
                        <span className="rounded-full bg-good px-2 py-0.5 text-[9px] font-bold text-white">En cours</span>
                      ) : (
                        org && <span className="truncate rounded-full bg-card px-2 py-0.5 text-[9px] font-semibold text-ink-2">{ORG_LABELS[org]}</span>
                      )}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[13px] font-bold leading-tight text-ink">{e.title}</div>
                    {e.location && (
                      <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-ink-3">
                        <MapPin size={10} className="shrink-0" /> <span className="truncate">{e.location}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {widgets.cards && (
        <div>
          <Title count={recap?.cards.length}>Mes cartes</Title>
          {!recap ? (
            <div className="h-12 animate-pulse rounded-btn bg-subtle" />
          ) : recap.cards.length === 0 ? (
            <Empty icon={SquareKanban}>Aucune carte à traiter.</Empty>
          ) : (
            <div className="overflow-hidden rounded-btn border border-line bg-card">
              {recap.cards.map((c) => {
                const late = !!c.dueAt && new Date(c.dueAt).getTime() < now;
                return (
                  <button key={c.id} onClick={() => openCard(c.id)} className="block w-full border-b border-line px-2.5 py-2 text-left last:border-b-0 hover:bg-hover">
                    <div className="flex items-start gap-1.5">
                      {c.isNew && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red" title="Nouvelle carte" />}
                      <span className="line-clamp-2 text-xs font-bold leading-tight text-ink">{c.title}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-4">
                      <span className="truncate">{c.boardTitle}</span>
                      {c.dueAt && (
                        <span className={`shrink-0 ${late ? "font-bold text-bad" : ""}`}>
                          · {late ? "En retard" : new Date(c.dueAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {widgets.activity && (
        <div>
          <div className="flex items-start justify-between">
            <Title>Activité</Title>
            {activity.length > 0 && (
              <button onClick={() => void removeNotifications()} className="text-[10px] font-semibold text-ink-4 hover:text-bad hover:underline">
                Tout effacer
              </button>
            )}
          </div>
          {activity.length === 0 ? (
            <Empty icon={Bell}>Aucune activité récente.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {activity.map((n) => (
                <div key={n.id} className="group relative">
                <button
                  onClick={() => (n.data?.team_card_id ? openCard(n.data.team_card_id) : n.event_id ? void openEvent(n.event_id) : undefined)}
                  className="flex w-full gap-2 pr-5 text-left"
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-line-strong" : "bg-red"}`} />
                  <span className="min-w-0 text-xs text-ink-2">
                    <span className="font-bold text-ink">{n.title}</span>
                    <span className="line-clamp-2 text-ink-3">{n.message}</span>
                    <span className="text-[10px] text-ink-4">
                      {n.actor_name ? `${n.actor_name} · ` : ""}
                      {ago(n.created_at)}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => void removeNotifications([n.id])}
                  title="Supprimer"
                  aria-label="Supprimer cette activité"
                  className="absolute right-0 top-0 rounded-full p-0.5 text-ink-4 opacity-0 hover:bg-hover hover:text-bad group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
