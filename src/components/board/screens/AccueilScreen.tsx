"use client";

import { useEffect, useState } from "react";
import { Clock, ChevronRight, MapPin, CheckCircle2, CalendarDays } from "lucide-react";
import { getDashboard, type Dashboard, type DashboardAction } from "@/app/actions/dashboard";
import { readCache, writeCache } from "@/lib/board/localCache";
import { EVENT_TYPE_TO_ORG } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS } from "@/lib/board/tokens";
import { ActionPopup } from "@/components/board/dashboard/ActionPopup";

type Period = "day" | "week";

const TODAY = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const TONE_CLASSES: Record<DashboardAction["tone"], { count: string; border: string }> = {
  red: { count: "bg-red text-white", border: "border-l-red" },
  orange: { count: "bg-warn text-white", border: "border-l-warn" },
  navy: { count: "bg-navy text-white", border: "border-l-navy" },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/**
 * Tableau de bord : les actions à faire (frais à déclarer ou à valider, captations à accepter,
 * médias à publier, présences à confirmer…) et le programme de la journée ou de la semaine. Chaque
 * action ouvre le module concerné. Affichage instantané depuis le cache, rafraîchi en arrière-plan.
 */
export function AccueilScreen({
  punchedIn,
  onTogglePunch,
  onNavigate,
}: {
  punchedIn: boolean;
  onTogglePunch: () => void;
  onNavigate?: (app: string) => void;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [data, setData] = useState<Dashboard | null>(() => readCache<Dashboard>("dashboard:day") ?? null);
  // Clic sur une action : popup de traitement rapide (valider, accepter…) plutôt que le module complet.
  const [openAction, setOpenAction] = useState<DashboardAction | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache<Dashboard>(`dashboard:${period}`);
    const load = () =>
      getDashboard(period)
        .then((d) => {
          if (cancelled) return;
          setData(d);
          writeCache(`dashboard:${period}`, d);
        })
        .catch(() => undefined);
    if (cached) queueMicrotask(() => !cancelled && setData(cached));
    void load();
    const timer = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [period, reloadKey]);

  const actions = data?.actions ?? [];
  const programme = data?.programme ?? [];
  const totalActions = actions.reduce((n, a) => n + a.count, 0);
  const periodLabel = period === "day" ? "aujourd'hui" : "cette semaine";

  // Programme groupé par jour (utile en vue semaine).
  const byDay = new Map<string, typeof programme>();
  for (const p of programme) {
    const k = new Date(p.start).toDateString();
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto rounded-panel p-1">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">Accueil · Mon tableau de bord</div>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-[-0.45px] text-ink">Ce qui vous attend</h1>
        </div>
        <div className="flex rounded-full bg-subtle p-1">
          {(["day", "week"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${period === p ? "bg-navy text-white" : "text-ink-3"}`}
            >
              {p === "day" ? "Aujourd'hui" : "Cette semaine"}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-panel p-7 text-white" style={{ background: "linear-gradient(160deg, var(--navy) 0%, var(--navy-500) 100%)" }}>
        <div className="font-mono text-[10px] tracking-[0.12em] text-white/70 uppercase">{TODAY}</div>
        <h1 className="mt-2 text-2xl font-extrabold">Bonjour{data?.firstName ? ` ${data.firstName}` : ""}.</h1>
        <p className="mt-1 text-sm text-white/80">
          {data === null
            ? "Chargement de votre journée…"
            : `${totalActions > 0 ? `${totalActions} action${totalActions > 1 ? "s" : ""} à faire` : "Aucune action en attente"} · ${
                programme.length
              } événement${programme.length > 1 ? "s" : ""} ${periodLabel}.`}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onTogglePunch}
            className="flex items-center gap-2 rounded-btn bg-red px-4 py-3 text-sm font-bold shadow-btn-red transition hover:bg-red-700"
          >
            <Clock size={16} />
            {punchedIn ? "Pointer la sortie" : "Pointer l'entrée"}
          </button>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-bold text-ink">Mes actions</h2>
          {data === null ? (
            <div className="rounded-panel border border-line bg-card p-6 text-sm text-ink-4">Chargement…</div>
          ) : actions.length === 0 ? (
            <div className="flex items-center gap-3 rounded-panel border border-line bg-card p-5 text-sm text-ink-2">
              <CheckCircle2 size={20} className="text-good" /> Rien à faire pour l&rsquo;instant, tout est à jour.
            </div>
          ) : (
            <div className="space-y-2">
              {actions.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setOpenAction(a)}
                  className={`flex w-full items-center gap-3 rounded-card border border-l-4 border-line bg-card p-4 text-left shadow-card transition hover:border-line-strong ${TONE_CLASSES[a.tone].border}`}
                >
                  <span className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-extrabold ${TONE_CLASSES[a.tone].count}`}>
                    {a.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-ink">{a.title}</span>
                    <span className="block text-xs text-ink-3">{a.detail}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-ink-4" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-ink">Mon programme {periodLabel}</h2>
          {data === null ? (
            <div className="rounded-panel border border-line bg-card p-6 text-sm text-ink-4">Chargement…</div>
          ) : programme.length === 0 ? (
            <div className="flex items-center gap-3 rounded-panel border border-line bg-card p-5 text-sm text-ink-3">
              <CalendarDays size={18} className="text-ink-4" /> Aucun événement où vous êtes sollicité {periodLabel}.
            </div>
          ) : (
            <div className="space-y-3">
              {[...byDay.entries()].map(([k, items]) => (
                <div key={k}>
                  {period === "week" && (
                    <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">{dayLabel(items[0].start)}</div>
                  )}
                  <div className="overflow-hidden rounded-panel border border-line bg-card">
                    {items.map((p) => {
                      const org = p.eventType ? EVENT_TYPE_TO_ORG[p.eventType] : null;
                      const color = org ? ORG_COLORS[org] : null;
                      return (
                        <button
                          key={p.eventId}
                          onClick={() => onNavigate?.("calendrier")}
                          className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover"
                        >
                          <span className="w-12 shrink-0 font-mono text-xs font-bold text-ink">{time(p.start)}</span>
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: color?.base ?? "var(--navy)" }} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-ink">{p.title}</span>
                            <span className="block truncate text-[11px] text-ink-3">
                              {p.roles.join(", ")}
                              {org ? ` · ${ORG_LABELS[org]}` : ""}
                            </span>
                            {p.location && (
                              <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-ink-4">
                                <MapPin size={10} /> {p.location}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {openAction && (
        <ActionPopup
          action={openAction}
          onClose={() => setOpenAction(null)}
          onNavigate={onNavigate}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
