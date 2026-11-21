"use client";

import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useEffect, useRef, useState } from "react";
import {
  Eye,
  Heart,
  MessageCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ImageIcon,
  ListChecks,
  MapPin,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { getDashboard, setFraisDeclarationMode, type Dashboard, type DashboardAction, type ProgrammeItem } from "@/app/actions/dashboard";
import { DefaultMenu } from "@/components/board/calendar/DefaultMenu";
import { EventModal } from "@/components/board/calendar/EventModal";
import type { RecentPost } from "@/lib/board/recentPosts";
import { readCache, writeCache } from "@/lib/board/localCache";
import { EVENT_TYPE_TO_ORG, type DbEventType } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS, type OrgKey } from "@/lib/board/tokens";
import { ActionPopup } from "@/components/board/dashboard/ActionPopup";
import { PANEL, PanelHead } from "@/components/board/dashboard/Panel";
import { MyCardsPanel } from "@/components/board/team/MyCardsPanel";
import { MediaDeliveriesPanel } from "@/components/board/dashboard/MediaDeliveriesPanel";
import { EventArrow, useOpenEvent } from "@/components/board/calendar/EventOpener";
import { useForecast } from "@/components/board/calendar/DayWeather";
import { UnreadMails } from "@/components/board/dashboard/UnreadMails";
import { useDashboardAgenda, type AgendaEvent } from "@/components/board/dashboard/GoogleAgenda";
import { BoxChips, BoxTag } from "@/components/board/mail/MailBoxes";
import { GoogleEventModal } from "@/components/board/calendar/GoogleEventModal";
import { FacebookIcon, InstagramIcon, YoutubeIcon } from "@/components/board/publication/BrandIcons";
import { weatherIcon } from "@/lib/board/weather";

type Period = "day" | "week";

const TODAY = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const TONES: Record<DashboardAction["tone"], { count: string; border: string }> = {
  red: { count: "bg-red text-white", border: "border-l-red" },
  orange: { count: "bg-warn text-white", border: "border-l-warn" },
  navy: { count: "bg-navy text-white", border: "border-l-navy" },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return `il y a ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : d < 7 ? `il y a ${d} jours` : new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** En cours / À venir / Terminé, d'après l'heure actuelle. */
function eventState(p: ProgrammeItem) {
  const now = Date.now();
  if (now >= new Date(p.end).getTime()) return { label: "Terminé", className: "bg-subtle text-ink-4" };
  if (now >= new Date(p.start).getTime()) return { label: "En cours", className: "bg-good-bg text-good" };
  return { label: "À venir", className: "bg-sel-bg text-link" };
}



/** Libellés courts des pôles pour les filtres de médias (les longs ne tiennent pas en pastille). */
const ORG_SHORT: Partial<Record<OrgKey, string>> = { pem: "PEM", tirages: "Tirages" };
/** Filtres de médias : les matchs du week-end sont rangés sous Compétitions (pas de filtre « Matchs »). */
const MEDIA_ORG_MERGE: Partial<Record<OrgKey, OrgKey>> = { matchs: "red" };
const ORG_ORDER = Object.keys(ORG_LABELS) as OrgKey[];
const postOrg = (p: RecentPost): OrgKey | null => {
  const org = p.eventType ? (EVENT_TYPE_TO_ORG[p.eventType as DbEventType] ?? null) : null;
  return org ? (MEDIA_ORG_MERGE[org] ?? org) : null;
};

/**
 * Tableau de bord : bandeau (météo, pointage, anniversaires), les actions à faire et le programme
 * côte à côte — y compris sur mobile —, puis les derniers médias publiés sur les réseaux de la Ligue.
 * Chaque action ouvre une popup de traitement rapide. Affichage instantané depuis le cache.
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
  // Affichage instantané depuis le cache (miniatures Drive signées jusqu'au lendemain), puis rafraîchi.
  const [posts, setPosts] = useState<RecentPost[] | null>(() => readCache<RecentPost[]>("dashboard:posts") ?? null);
  // Clic sur une action : popup de traitement rapide (valider, accepter…) plutôt que le module complet.
  const [openAction, setOpenAction] = useState<DashboardAction | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Heure de lancement de la demande qui a produit `data` : les choix faits sur l'accueil après cette
  // heure (statut, relance, case cochée) restent affichés jusqu'à la réponse suivante (MyCardsPanel).
  const [dataAt, setDataAt] = useState(0);
  const { open: openEvent } = useOpenEvent();
  // Clic droit sur « Mes actions » : frais à déclarer proposés d'office ou saisis soi-même.
  const changeFraisMode = (mode: "auto" | "manuel") => {
    if (data?.fraisMode === mode || (!data?.fraisMode && mode === "auto")) return;
    setData((d) => (d ? { ...d, fraisMode: mode } : d));
    void setFraisDeclarationMode(mode).then(() => setReloadKey((k) => k + 1));
  };
  // Appui long (mobile) sur « Mes actions » : même menu que le clic droit. Annulé si le doigt bouge.
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  // En direct : toute action (frais, captation, inscription, notification…) met le tableau de bord à jour.
  // Seulement les tables dont dépend le tableau de bord (dashboardCore.ts : cartes, frais, captations,
  // comité, publications, inscriptions, programme, accès aux modules) et le retour après absence ;
  // plus les détails de match, checklists et commentaires de cartes (audit de vitesse du 20/11).
  useLiveRefresh(
    [
      "events",
      "coverage_requests",
      "director_attendance",
      "event_assignments",
      "event_team_members",
      "photo_missions",
      "media_publications",
      "comment_moderation",
      "event_registration_campaigns",
      "event_registration_recipients",
      "event_expenses",
      "expense_submissions",
      "event_presence_days",
      "event_presence_requests",
      "media_deliveries",
      "team_boards",
      "team_lists",
      "team_cards",
      "team_card_members",
      "module_access",
      "notifications",
      "resume",
    ],
    () => setReloadKey((k) => k + 1),
    1000
  );

  // Cache affiché seulement au changement de période : le recopier à chaque événement en direct
  // réaffichait une version plus ancienne qu'un clic (pastille qui disparaissait puis revenait).
  const shownPeriod = useRef(period);
  useEffect(() => {
    if (shownPeriod.current === period) return;
    shownPeriod.current = period;
    const cached = readCache<Dashboard>(`dashboard:${period}`);
    if (cached) queueMicrotask(() => setData(cached));
  }, [period]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const startedAt = Date.now();
      return getDashboard(period)
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setDataAt(startedAt);
          writeCache(`dashboard:${period}`, d);
        })
        .catch(() => undefined);
    };
    void load();
    const timer = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [period, reloadKey]);

  // Derniers médias publiés : route GET, chargée en parallèle des server actions (exécutées une par une).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/recent-posts")
      .then((r) => (r.ok ? (r.json() as Promise<RecentPost[]>) : Promise.reject()))
      .then((p) => {
        if (cancelled) return;
        setPosts(p);
        writeCache("dashboard:posts", p);
      })
      .catch(() => !cancelled && setPosts((prev) => prev ?? []));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Les cartes Espace Team ont leur propre panneau (« Mes cartes », archivage direct) et les remises de
  // photos / vidéos leur encart en tête : hors de « Mes actions » (ces actions servent au mail de 7 h).
  const actions = (data?.actions ?? []).filter((a) => a.id !== "cartes" && a.id !== "remises");
  const programme = data?.programme ?? [];
  const periodLabel = period === "day" ? "aujourd'hui" : "cette semaine";
  // Agendas des comptes connectés (Google), mêlés au programme ; plusieurs comptes : pastilles.
  const agenda = useDashboardAgenda(period, reloadKey);
  const [openAgenda, setOpenAgenda] = useState<AgendaEvent | null>(null);
  const [newEvent, setNewEvent] = useState(false);

  // Programme et agendas, dans l'ordre des heures, groupés par jour (utile en vue semaine).
  type Entry = { kind: "board"; p: (typeof programme)[number]; start: string } | { kind: "agenda"; g: AgendaEvent; start: string };
  // Journée entière (Google : « AAAA-MM-JJ ») : lue en heure locale, placée en tête du jour.
  const agendaStart = (g: AgendaEvent) => (g.allDay ? `${g.start.slice(0, 10)}T00:00:00` : g.start);
  const entries: Entry[] = [
    ...programme.map((p) => ({ kind: "board" as const, p, start: p.start })),
    ...(data === null ? [] : agenda.events.map((g) => ({ kind: "agenda" as const, g, start: agendaStart(g) }))),
  ].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = new Date(e.start).toDateString();
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  return (
    <div className="relative h-full overflow-hidden rounded-panel">
      {/* Filigrane : logo LGEF en fond, opacité réduite, fixe pendant le défilement. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- simple décor, pas d'optimisation utile */}
        <img src="/lgef-logo.png" alt="" className="w-[min(42%,380px)] opacity-[0.06]" />
      </div>
      {/* Un seul défilement (aussi sur mobile) ; en blocs, pour qu'aucune section ne soit écrasée. Marge basse : barre d'onglets mobile. */}
      <div className="relative h-full overflow-y-auto p-1 pb-28 md:pb-2">
        {/* Ordinateur : à gauche bandeau fin, ligne des derniers médias, actions ; à droite mails puis agenda.
            Mobile : bandeau, médias, actions, mails, agenda. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:grid-rows-[auto_auto_1fr] lg:items-start">
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-1">
            <HomeBanner firstName={data?.firstName ?? null} birthdays={data?.birthdays ?? []} punchedIn={punchedIn} onTogglePunch={onTogglePunch} />
          </div>

          <RecentPosts posts={posts} onSeeAll={onNavigate ? () => onNavigate("audiovisuel") : undefined} />

          {/* Deux colonnes : « Mes actions » à gauche, « Mes cartes » à droite (pleine largeur sans cartes). */}
          <div className={"grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2 lg:col-start-1"}>
          <DefaultMenu
            title="Mes frais"
            atCursor
            className="min-w-0"
            footnote={null}
            options={[
              {
                label: "Automatique",
                hint: "Les événements où vous êtes sollicité arrivent ici, à déclarer.",
                selected: (data?.fraisMode ?? "auto") === "auto",
                onSelect: () => changeFraisMode("auto"),
              },
              {
                label: "Manuel",
                hint: "Vous déclarez vos frais directement dans Frais et les rattachez à l'événement ; ils ne seront plus proposés ici.",
                selected: data?.fraisMode === "manuel",
                onSelect: () => changeFraisMode("manuel"),
              },
            ]}
          >
          {(onContextMenu, openMenuAt) => (
          <section
            onContextMenu={onContextMenu}
            onTouchStart={(e) => {
              const t = e.touches[0];
              cancelPress();
              longPressed.current = false;
              pressTimer.current = window.setTimeout(() => {
                pressTimer.current = null;
                longPressed.current = true;
                navigator.vibrate?.(10);
                openMenuAt(t.clientX, t.clientY);
              }, 550);
            }}
            onTouchMove={cancelPress}
            onTouchEnd={(e) => {
              cancelPress();
              // Appui long : pas de clic sur la carte touchée en relâchant.
              if (longPressed.current) e.preventDefault();
            }}
            onTouchCancel={cancelPress}
            className={PANEL}
          >
            <PanelHead
              icon={<ListChecks size={14} />}
              title="Mes actions"
              count={actions.length}
              right={
              /* Toujours visible : le réglage reste accessible quand « Frais à déclarer » a disparu. */
              <button
                type="button"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  openMenuAt(r.right - 256, r.bottom + 6);
                }}
                title="Mes frais : automatiques ou manuels (aussi au clic droit ou à l'appui long)"
                className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-ink-3 hover:bg-hover hover:text-ink md:text-xs"
              >
                <SlidersHorizontal size={12} />
                {data?.fraisMode === "manuel" ? "Frais manuels" : "Frais auto"}
              </button>
              }
            />
            {/* Mobile : carrousel de petites cartes (comme les médias), le nombre en pastille. */}
            {data !== null && actions.length > 0 && (
              <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 lg:hidden">
                {actions.map((a) => (
                  <ActionCard key={a.id} action={a} onClick={() => setOpenAction(a)} />
                ))}
              </div>
            )}
            <div className={data !== null && actions.length > 0 ? "hidden lg:block" : ""}>
            {data === null ? (
              <div className="rounded-card bg-panel p-6 text-sm text-ink-4">Chargement…</div>
            ) : actions.length === 0 ? (
              <div className="flex flex-col items-start gap-2 rounded-card bg-panel p-4 text-sm text-ink-2 sm:flex-row sm:items-center">
                <CheckCircle2 size={20} className="shrink-0 text-good" /> Rien à faire, tout est à jour.
              </div>
            ) : (
              <div className="grid gap-2">
                {actions.map((a) => {
                  const tone = TONES[a.tone];
                  return (
                    <button
                      key={a.id}
                      onClick={() => setOpenAction(a)}
                      className={`flex w-full flex-col gap-2 rounded-card border border-l-4 border-line bg-panel px-2.5 py-2 text-left transition hover:-translate-y-px hover:border-line-strong hover:shadow-card sm:flex-row sm:items-center sm:gap-3 ${tone.border}`}
                    >
                      {/* Même photo que la vignette mobile, le nombre en pastille dans le coin. */}
                      <span className="relative block h-10 w-10 shrink-0">
                        <span className="block h-full w-full overflow-hidden rounded-xl bg-subtle">
                          <ActionPhoto action={a} />
                        </span>
                        <span className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-extrabold shadow-card ring-2 ring-card ${tone.count}`}>
                          {a.count}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block text-[13px] font-bold leading-tight text-ink sm:text-sm">{a.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[11px] text-ink-3 sm:text-xs">{a.detail}</span>
                      </span>
                      <ChevronRight size={16} className="hidden shrink-0 text-ink-4 sm:block" />
                    </button>
                  );
                })}
              </div>
            )}
            </div>
          </section>
          )}
          </DefaultMenu>

          <section className={`min-w-0 ${PANEL}`}>
            <PanelHead
              icon={<CalendarDays size={14} />}
              title="Agenda"
              count={entries.length}
              middle={
                /* Aujourd'hui / Semaine : la période du calendrier, en petit sur la ligne du titre. */
                <div className="flex justify-center">
                  <div className="flex rounded-full bg-subtle p-0.5">
                    {(["day", "week"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition-colors ${period === p ? "bg-navy text-white" : "text-ink-3 hover:text-ink"}`}
                      >
                        {p === "day" ? "Aujourd'hui" : "Semaine"}
                      </button>
                    ))}
                  </div>
                </div>
              }
              right={
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Nouvel événement : même fiche que le « + » du Calendrier. */}
                  <button
                    type="button"
                    onClick={() => setNewEvent(true)}
                    title="Nouvel événement"
                    aria-label="Nouvel événement"
                    className="flex h-6 w-6 items-center justify-center rounded-btn bg-navy text-white transition hover:opacity-90"
                  >
                    <Plus size={14} strokeWidth={2.5} />
                  </button>
                  {onNavigate && (
                    <button onClick={() => onNavigate("calendrier")} className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-link hover:underline md:text-xs">
                      Calendrier <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              }
            />
            {agenda.box.multiple && (
              <div className="-mt-0.5 mb-2">
                <BoxChips
                  accounts={agenda.accounts}
                  scope={agenda.box.scope}
                  onScope={agenda.box.setScope}
                  defaultScope={agenda.box.defaultScope}
                  onSetDefault={agenda.box.setDefault}
                  wrap
                />
              </div>
            )}
            {data === null ? (
              <div className="rounded-card bg-panel p-6 text-sm text-ink-4">Chargement…</div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-start gap-2 rounded-card bg-panel p-4 text-sm text-ink-3 sm:flex-row sm:items-center">
                <CalendarDays size={18} className="shrink-0 text-ink-4" /> Aucun événement où vous êtes sollicité {periodLabel}{agenda.accounts.length ? ", rien non plus dans vos agendas" : ""}.
              </div>
            ) : (
              <div className="space-y-2.5">
                {[...byDay.entries()].map(([k, items]) => (
                  <div key={k} className="space-y-1.5">
                    {period === "week" && <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">{dayLabel(items[0].start)}</div>}
                    {items.map((entry) => {
                      if (entry.kind === "agenda") {
                        const g = entry.g;
                        return (
                          <button
                            key={`g:${g.accountId}:${g.id}`}
                            onClick={() => setOpenAgenda(g)}
                            className="flex w-full flex-col gap-1.5 rounded-card border border-dashed border-line-strong bg-panel px-2.5 py-2 text-left transition hover:-translate-y-px hover:shadow-card sm:flex-row sm:items-start sm:gap-3"
                          >
                            <span className="flex items-center gap-1.5 sm:w-14 sm:shrink-0 sm:flex-col sm:items-start sm:gap-1">
                              <span className="font-mono text-xs font-extrabold text-ink sm:text-sm">{g.allDay ? "Journée" : time(g.start)}</span>
                              <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[9px] font-bold text-ink-3">Agenda</span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 text-[13px] font-bold leading-tight text-ink sm:text-sm">{g.summary}</span>
                              {agenda.box.multiple && (
                                <span className="mt-1 flex">
                                  <BoxTag accounts={agenda.accounts} accountId={g.accountId} />
                                </span>
                              )}
                              {g.location && (
                                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-4">
                                  <MapPin size={10} className="shrink-0" /> <span className="truncate">{g.location}</span>
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      }
                      const p = entry.p;
                      const org = p.eventType ? EVENT_TYPE_TO_ORG[p.eventType] : null;
                      const color = org ? ORG_COLORS[org] : null;
                      const state = eventState(p);
                      return (
                        <button
                          key={p.eventId}
                          onClick={() => void openEvent(p.eventId)}
                          className="flex w-full flex-col gap-1.5 rounded-card border border-line bg-panel px-2.5 py-2 text-left transition hover:-translate-y-px hover:border-line-strong hover:shadow-card sm:flex-row sm:items-start sm:gap-3"
                        >
                          <span className="flex items-center gap-1.5 sm:w-14 sm:shrink-0 sm:flex-col sm:items-start sm:gap-1">
                            <span className="font-mono text-xs font-extrabold text-ink sm:text-sm">{time(p.start)}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${state.className}`}>{state.label}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start gap-1.5">
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color?.base ?? "var(--navy)" }} />
                              <span className="line-clamp-2 text-[13px] font-bold leading-tight text-ink sm:text-sm">{p.title}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-ink-3">
                              {p.roles.join(", ")}
                              {org ? ` · ${ORG_LABELS[org]}` : ""}
                            </span>
                            {p.myPresence && (
                              <span className="mt-0.5 block truncate text-[11px] font-semibold text-link" title={p.myPresence}>
                                Vous : {p.myPresence}
                              </span>
                            )}
                            {p.location && (
                              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-4">
                                <MapPin size={10} className="shrink-0" /> <span className="truncate">{p.location}</span>
                              </span>
                            )}
                          </span>
                          <EventArrow eventId={p.eventId} className="mt-0.5 hidden sm:block" />
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>
          </div>

          {/* Colonne de droite : l'encart d'alerte des photos / vidéos à remettre (TeamMedia) et des
              retards de l'équipe (N+1), les mails non lus, puis « Mes cartes ». */}
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <MediaDeliveriesPanel deliveries={data?.deliveries} onChanged={() => setReloadKey((k) => k + 1)} />
          <section className={`min-w-0 ${PANEL}`}>
            <UnreadMails onOpenMails={onNavigate ? () => onNavigate("mails") : undefined} />
          </section>

          <MyCardsPanel
            cards={data?.cards ?? null}
            cardsAt={dataAt}
            onOpenBoard={onNavigate ? () => onNavigate("trello") : undefined}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
          </div>
        </div>

        {newEvent && (
          <EventModal
            event={null}
            onClose={() => setNewEvent(false)}
            onSaved={() => setReloadKey((k) => k + 1)}
          />
        )}
        {openAgenda && (
          <GoogleEventModal
            accountId={openAgenda.accountId}
            calendarId={openAgenda.calendarId}
            event={openAgenda}
            onClose={() => {
              setOpenAgenda(null);
              agenda.reload();
            }}
          />
        )}

        {openAction && (
          <ActionPopup
            action={openAction}
            onClose={() => setOpenAction(null)}
            onNavigate={onNavigate}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
        )}
      </div>
    </div>
  );
}


/** Carte d'action du carrousel mobile : image (premier média) ou pictogramme, « Titre (n) ». */
/**
 * Photo d'illustration de chaque action (public/actions/<id>.jpg, 360 px) — photos StockSnap,
 * domaine public (CC0), récupérées via Openverse : sticky-notes-NCEC9BTO9Z, coffee-cafelatte-F9A95133A1,
 * calculator-numbers-VVXW9WBTB8 / JY874BSKKC, camera-lens-W7RWLHPKX4, soccer-field-5FKA3VHPRW,
 * soccer-net-1IIEPDOFFI, team-meeting-VQXYE2ZEHC, mobile-smartphone-DLITZEAVJJ,
 * iphone-smartphone-ODN23L0AC9, mailboxes-letters-38F072B2D5, soccer-ball-LHHL7FKKVD.
 */
const ACTION_PHOTOS = new Set([
  "frais-declarer",
  "frais-valider",
  "frais-refuses",
  "captation-repondre",
  "captation-attribuer",
  "couverture-refusee",
  "presence",
  "publier",
  "commentaires",
  "inscriptions",
  "cartes",
]);
// Factures : mêmes photos que les frais correspondants.
const PHOTO_ALIASES: Record<string, string> = { "factures-deposer": "frais-declarer", "factures-refusees": "frais-refuses", "factures-valider": "frais-valider", "a-payer": "frais-valider" };
const actionPhoto = (id: string) => {
  const photo = PHOTO_ALIASES[id] ?? id;
  return `/actions/${ACTION_PHOTOS.has(photo) ? photo : "default"}.jpg`;
};

/** Miniature du premier média, sinon photo statique de l'action (repli sur la photo si la miniature échoue). */
function ActionPhoto({ action: a, className = "" }: { action: DashboardAction; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- miniature signée du premier média, sinon photo statique
    <img
      src={a.thumbUrl ?? actionPhoto(a.id)}
      alt=""
      loading="lazy"
      className={`h-full w-full object-cover ${className}`}
      onError={(e) => {
        if (!e.currentTarget.src.endsWith(actionPhoto(a.id))) e.currentTarget.src = actionPhoto(a.id);
      }}
    />
  );
}

/** Carte d'action du carrousel mobile, au format des vignettes Airbnb : photo carrée, titre et détail dessous. */
function ActionCard({ action: a, onClick }: { action: DashboardAction; onClick: () => void }) {
  const tone = TONES[a.tone];
  return (
    <button onClick={onClick} className="group w-28 shrink-0 snap-start text-left">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-subtle shadow-card">
        <ActionPhoto action={a} className="transition group-active:scale-[0.98]" />
        <span className={`absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-extrabold shadow-card ${tone.count}`}>
          {a.count}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-2 text-[12px] font-bold leading-tight text-ink">{a.title}</div>
      <div className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-ink-3">{a.detail}</div>
    </button>
  );
}

const NETWORK_ICON = {
  facebook: { Icon: FacebookIcon, label: "Facebook", color: "#1877F2" },
  instagram: { Icon: InstagramIcon, label: "Instagram", color: "#E1306C" },
  youtube: { Icon: YoutubeIcon, label: "YouTube", color: "#FF0000" },
} as const;

/** Derniers médias publiés sur les réseaux de la Ligue (Facebook, Instagram, YouTube), avec le lien vers chaque post. */
function RecentPosts({ posts, onSeeAll }: { posts: RecentPost[] | null; onSeeAll?: () => void }) {
  // Filtre par pôle (événement rattaché) : seulement les pôles qui ont des médias, « Tous » par défaut.
  const [filter, setFilter] = useState<OrgKey | "all">("all");
  // Loupe : recherche sur toutes les publications publiées (titre, légende), pas seulement les dernières.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<RecentPost[] | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/dashboard/recent-posts?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? (r.json() as Promise<RecentPost[]>) : Promise.reject()))
        .then((res) => !cancelled && setFound(res))
        .catch(() => !cancelled && setFound([]));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);
  const searching = searchOpen && q.length >= 2;
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setFound(null);
  };
  if (posts !== null && posts.length === 0) return null;
  const source = searching ? found : posts;
  const present = new Set((source ?? []).map(postOrg).filter((o): o is OrgKey => o !== null));
  const orgs = ORG_ORDER.filter((o) => present.has(o));
  const active = filter !== "all" && present.has(filter) ? filter : "all";
  const visible = source === null ? null : active === "all" ? source : source.filter((p) => postOrg(p) === active);
  const chip = (on: boolean) =>
    `shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${on ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:text-ink"}`;
  return (
    <section className={`min-w-0 lg:col-start-1 ${PANEL}`}>
      <PanelHead
        icon={<ImageIcon size={14} />}
        title="Derniers médias"
        middle={
          searchOpen ? (
            <div className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1">
              <Search size={12} className="shrink-0 text-ink-4" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value.trim().length < 2) setFound(null);
                }}
                onKeyDown={(e) => e.key === "Escape" && closeSearch()}
                placeholder="Rechercher un média…"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-4"
              />
            </div>
          ) : (
          orgs.length > 0 && (
            <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button type="button" onClick={() => setFilter("all")} className={chip(active === "all")}>
                Tous
              </button>
              {orgs.map((o) => (
                <button key={o} type="button" onClick={() => setFilter(o)} className={`${chip(active === o)} flex items-center gap-1.5`}>
                  {active !== o && <span className="h-1.5 w-1.5 rounded-full" style={{ background: ORG_COLORS[o].base }} />}
                  {ORG_SHORT[o] ?? ORG_LABELS[o]}
                </button>
              ))}
            </div>
          )
          )
        }
        right={
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              title={searchOpen ? "Fermer la recherche" : "Rechercher un média"}
              aria-label={searchOpen ? "Fermer la recherche" : "Rechercher un média"}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
            >
              {searchOpen ? <X size={14} /> : <Search size={14} />}
            </button>
            {onSeeAll && (
              <button onClick={onSeeAll} className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-link hover:underline md:text-xs">
                Voir tout <ChevronRight size={12} />
              </button>
            )}
          </div>
        }
      />
      {searching && found !== null && visible!.length === 0 ? (
        <div className="rounded-card bg-panel p-4 text-sm text-ink-3">Aucun média publié ne correspond à « {q} ».</div>
      ) : (
      <HScroll>
        {visible === null
          ? Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-square w-28 shrink-0 animate-pulse rounded-xl bg-subtle sm:w-32" />)
          : visible.map((p) => {
              const link = p.networks.find((n) => n.url)?.url ?? null;
              const tip = [p.title, ago(p.publishedAt), p.views != null ? `${p.views.toLocaleString("fr-FR")} vues` : null].filter(Boolean).join(" · ");
              const thumb = (
                <div className="relative aspect-square overflow-hidden rounded-xl bg-gradient-to-br from-navy to-navy-500">
                  <div className="absolute inset-0 flex items-center justify-center text-white/50">
                    <ImageIcon size={20} />
                  </div>
                  {p.thumbUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- miniature signée (Drive, Storage ou YouTube)
                    <img
                      src={p.thumbUrl}
                      alt=""
                      loading="lazy"
                      className="relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                  )}
                  {p.kind === "video" && (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white">
                      <Play size={9} fill="currentColor" />
                    </span>
                  )}
                  {/* Dégradé bas : réseaux et vues lisibles sur toute image. */}
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4">
                    <span className="flex gap-0.5">
                      {p.networks.map((n) => {
                        const { Icon, label, color } = NETWORK_ICON[n.network];
                        return (
                          <span key={n.network} title={label} className="flex h-4 w-4 items-center justify-center rounded-full bg-white" style={{ color }}>
                            <Icon size={9} />
                          </span>
                        );
                      })}
                    </span>
                    {p.views != null && (
                      <span className="flex items-center gap-0.5 text-[9px] font-bold text-white">
                        <Eye size={9} /> {p.views.toLocaleString("fr-FR")}
                      </span>
                    )}
                  </div>
                </div>
              );
              const content = (
                <>
                  {thumb}
                  <div className="mt-1.5 line-clamp-2 text-[11px] font-semibold leading-tight text-ink">{p.title}</div>
                  {/* Ligne de la date : likes et commentaires cumulés sur les réseaux (dernier relevé). */}
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-4">
                    <span className="truncate">{ago(p.publishedAt)}</span>
                    {p.likes != null && (
                      <span className="flex shrink-0 items-center gap-0.5 font-semibold text-ink-3" title="J'aime cumulés sur les réseaux">
                        <Heart size={10} /> {p.likes.toLocaleString("fr-FR")}
                      </span>
                    )}
                    {p.comments != null && (
                      <span className="flex shrink-0 items-center gap-0.5 font-semibold text-ink-3" title="Commentaires cumulés sur les réseaux">
                        <MessageCircle size={10} /> {p.comments.toLocaleString("fr-FR")}
                      </span>
                    )}
                  </div>
                </>
              );
              return link ? (
                <a key={p.id} href={link} target="_blank" rel="noreferrer" title={tip} className="group w-28 shrink-0 snap-start sm:w-32">
                  {content}
                </a>
              ) : (
                <div key={p.id} title={tip} className="group w-28 shrink-0 snap-start sm:w-32">
                  {content}
                </div>
              );
            })}
      </HScroll>
      )}
    </section>
  );
}

/** Rangée horizontale : défilement au doigt, et flèches ‹ › au survol pour la souris (barres masquées). */
function HScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  const arrow = "absolute top-1/2 z-[1] hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-card text-ink shadow-modal hover:bg-hover md:group-hover/row:flex";
  return (
    <div className="group/row relative">
      <div ref={ref} className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
      <button type="button" onClick={() => scroll(-1)} className={`${arrow} -left-2`} aria-label="Précédents">
        <ChevronLeft size={16} />
      </button>
      <button type="button" onClick={() => scroll(1)} className={`${arrow} -right-2`} aria-label="Suivants">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/**
 * Bandeau d'accueil (bureau et mobile) : « Bonjour Prénom », puis la date et la météo du jour au
 * domicile (sinon Metz), puis le pointage. Le jour de son anniversaire, la personne a le visuel de fête avec son prénom ;
 * les autres voient « C'est l'anniversaire de … ».
 */
function HomeBanner({
  firstName,
  birthdays,
  punchedIn,
  onTogglePunch,
}: {
  firstName: string | null;
  birthdays: NonNullable<Dashboard["birthdays"]>;
  punchedIn: boolean;
  onTogglePunch: () => void;
}) {
  const forecast = useForecast();
  const mine = birthdays.find((b) => b.isMe);
  const others = birthdays.filter((b) => !b.isMe).map((b) => `${b.firstName} ${b.lastName}`.trim());
  const othersLabel = others.length > 1 ? `${others.slice(0, -1).join(", ")} et ${others.at(-1)}` : others[0];
  const now = forecast?.current;
  const sep = <span className="text-white/40">|</span>;

  return (
    <section className="relative overflow-hidden rounded-panel bg-navy text-white shadow-card">
      {/* eslint-disable-next-line @next/next/no-img-element -- visuel statique de /public, pleine largeur */}
      <img
        src={mine ? "/banners/anniversaire.jpg" : "/banners/accueil.jpg"}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[72%_center] md:object-right"
      />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-navy via-navy/85 to-navy/20 md:via-navy/50 md:to-transparent" />

      <div className="relative flex min-h-[150px] max-w-full flex-col justify-center px-5 py-4 md:min-h-[160px] md:max-w-[60%] md:px-7">
        {mine ? (
          <h1 className="text-xl font-extrabold leading-tight md:text-2xl">
            Joyeux anniversaire 🎉
            <br />
            <span className="text-[#F2C14E]">{mine.firstName || firstName} !</span>
          </h1>
        ) : (
          <h1 className="text-xl font-extrabold md:text-2xl">Bonjour{firstName ? ` ${firstName}` : ""}.</h1>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/80 md:text-[11px]">{TODAY}</span>
          {now && (
            <>
              {sep}
              <span className="flex items-center gap-1.5">
                <span className="text-lg leading-none">{weatherIcon(now.code).icon}</span>
                <span className="text-base font-extrabold">{now.temp}°C</span>
              </span>
              {sep}
              <span className="text-xs text-white/85">{forecast!.place}, Grand Est</span>
            </>
          )}
        </div>
        {now && (
          <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-white/75">
            <span>Ressenti {now.feels}°C</span>
            {sep}
            <span>Vent {now.wind} km/h</span>
            {now.rain != null && (
              <>
                {sep}
                <span>Risque de pluie {now.rain} %</span>
              </>
            )}
          </div>
        )}

        {mine && <p className="mt-2 text-xs text-white/85">Toute l&rsquo;équipe de la Ligue Grand Est de Football te souhaite une excellente journée !</p>}
        {othersLabel && (
          <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
            🎂 C&rsquo;est l&rsquo;anniversaire de {othersLabel} aujourd&rsquo;hui !
          </p>
        )}

        <div className="mt-3">
          <button
            type="button"
            onClick={onTogglePunch}
            className="flex items-center gap-2 rounded-btn bg-red px-4 py-2 text-sm font-bold shadow-btn-red transition hover:bg-red-700"
          >
            <Clock size={16} />
            {punchedIn ? "Pointer la sortie" : "Pointer l'entrée"}
          </button>
        </div>
      </div>
    </section>
  );
}
