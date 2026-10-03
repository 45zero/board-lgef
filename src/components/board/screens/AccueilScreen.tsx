"use client";

import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useEffect, useState } from "react";
import {
  Bell,
  Eye,
  CalendarCheck,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  ImageIcon,
  MapPin,
  MessageSquareWarning,
  Play,
  Receipt,
  Send,
} from "lucide-react";
import { getDashboard, type Dashboard, type DashboardAction, type ProgrammeItem } from "@/app/actions/dashboard";
import { getRecentPosts, type RecentPost } from "@/app/actions/recent-posts";
import { readCache, writeCache } from "@/lib/board/localCache";
import { EVENT_TYPE_TO_ORG } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS } from "@/lib/board/tokens";
import { ActionPopup } from "@/components/board/dashboard/ActionPopup";
import { EventArrow, useOpenEvent } from "@/components/board/calendar/EventOpener";
import { useForecast } from "@/components/board/calendar/DayWeather";
import { UnreadMails } from "@/components/board/dashboard/UnreadMails";
import { FacebookIcon, InstagramIcon, YoutubeIcon } from "@/components/board/publication/BrandIcons";
import { weatherIcon } from "@/lib/board/weather";

type Period = "day" | "week";

const TODAY = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const TONES: Record<DashboardAction["tone"], { count: string; border: string; tile: string }> = {
  red: { count: "bg-red text-white", border: "border-l-red", tile: "bg-bad-bg text-red" },
  orange: { count: "bg-warn text-white", border: "border-l-warn", tile: "bg-warn-bg text-warn" },
  navy: { count: "bg-navy text-white", border: "border-l-navy", tile: "bg-sel-bg text-navy" },
};

/** Pictogramme d'une action, d'après son identifiant (frais-…, captation-…, publier…). */
function ActionIcon({ id, size, strokeWidth }: { id: string; size: number; strokeWidth?: number }) {
  const props = { size, strokeWidth };
  if (id.startsWith("frais")) return <Receipt {...props} />;
  if (id.startsWith("captation")) return <Camera {...props} />;
  if (id === "presence") return <CalendarCheck {...props} />;
  if (id === "publier") return <ImageIcon {...props} />;
  if (id === "commentaires") return <MessageSquareWarning {...props} />;
  if (id === "inscriptions") return <Send {...props} />;
  return <Bell {...props} />;
}

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

function SectionTitle({ children, action }: { children: React.ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-extrabold text-ink md:text-base">{children}</h2>
      {action && (
        <button onClick={action.onClick} className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-link hover:underline md:text-xs">
          {action.label} <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}

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
  const [posts, setPosts] = useState<RecentPost[] | null>(null);
  // Clic sur une action : popup de traitement rapide (valider, accepter…) plutôt que le module complet.
  const [openAction, setOpenAction] = useState<DashboardAction | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { open: openEvent } = useOpenEvent();
  // En direct : toute action (frais, captation, inscription, notification…) met le tableau de bord à jour.
  useLiveRefresh(null, () => setReloadKey((k) => k + 1), 1000);

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

  // Derniers médias publiés : pas de cache navigateur (miniatures signées, temporaires).
  useEffect(() => {
    let cancelled = false;
    getRecentPosts()
      .then((p) => !cancelled && setPosts(p))
      .catch(() => !cancelled && setPosts([]));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const actions = data?.actions ?? [];
  const programme = data?.programme ?? [];
  const periodLabel = period === "day" ? "aujourd'hui" : "cette semaine";

  // Programme groupé par jour (utile en vue semaine).
  const byDay = new Map<string, typeof programme>();
  for (const p of programme) {
    const k = new Date(p.start).toDateString();
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }

  return (
    <div className="relative h-full overflow-hidden rounded-panel">
      {/* Filigrane : logo LGEF en fond, opacité réduite, fixe pendant le défilement. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- simple décor, pas d'optimisation utile */}
        <img src="/lgef-logo.png" alt="" className="w-[min(42%,380px)] opacity-[0.06]" />
      </div>
      {/* Un seul défilement (aussi sur mobile) ; en blocs, pour qu'aucune section ne soit écrasée. Marge basse : barre d'onglets mobile. */}
      <div className="relative h-full space-y-5 overflow-y-auto p-1 pb-28 md:pb-2">
        <HomeBanner firstName={data?.firstName ?? null} birthdays={data?.birthdays ?? []} punchedIn={punchedIn} onTogglePunch={onTogglePunch} />

        <section className="flex justify-end">
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

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <section className="order-1 min-w-0">
            <SectionTitle>Mes actions</SectionTitle>
            {/* Mobile : carrousel de cartes (comme les médias), le nombre entre parenthèses. */}
            {data !== null && actions.length > 0 && (
              <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 lg:hidden">
                {actions.map((a) => (
                  <ActionCard key={a.id} action={a} onClick={() => setOpenAction(a)} />
                ))}
              </div>
            )}
            <div className={data !== null && actions.length > 0 ? "hidden lg:block" : ""}>
            {data === null ? (
              <div className="rounded-panel border border-line bg-card p-6 text-sm text-ink-4">Chargement…</div>
            ) : actions.length === 0 ? (
              <div className="flex flex-col items-start gap-2 rounded-panel border border-line bg-card p-4 text-sm text-ink-2 sm:flex-row sm:items-center">
                <CheckCircle2 size={20} className="shrink-0 text-good" /> Rien à faire, tout est à jour.
              </div>
            ) : (
              <div className="space-y-2">
                {actions.map((a) => {
                  const tone = TONES[a.tone];
                  return (
                    <button
                      key={a.id}
                      onClick={() => setOpenAction(a)}
                      className={`flex w-full flex-col gap-2 rounded-card border border-l-4 border-line bg-card p-3 text-left shadow-card transition hover:-translate-y-px hover:border-line-strong sm:flex-row sm:items-center sm:gap-3 sm:p-3.5 ${tone.border}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-extrabold sm:h-9 sm:min-w-9 sm:text-sm ${tone.count}`}>
                          {a.count}
                        </span>
                        {a.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- miniature signée du premier média
                          <img src={a.thumbUrl} alt="" className="h-7 w-7 rounded-btn object-cover sm:h-10 sm:w-10" />
                        ) : (
                          <span className={`flex h-7 w-7 items-center justify-center rounded-btn sm:h-10 sm:w-10 ${tone.tile}`}>
                            <ActionIcon id={a.id} size={16} />
                          </span>
                        )}
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

          {/* Mobile : actions (carrousel), aujourd'hui, mails ; ordinateur : trois colonnes. */}
          <section className="order-3 min-w-0 lg:order-2">
            <UnreadMails onOpenMails={onNavigate ? () => onNavigate("mails") : undefined} />
          </section>

          <section className="order-2 min-w-0 lg:order-3">
            <SectionTitle action={onNavigate ? { label: "Calendrier", onClick: () => onNavigate("calendrier") } : undefined}>
              {period === "day" ? "Aujourd'hui" : "Cette semaine"}
            </SectionTitle>
            {data === null ? (
              <div className="rounded-panel border border-line bg-card p-6 text-sm text-ink-4">Chargement…</div>
            ) : programme.length === 0 ? (
              <div className="flex flex-col items-start gap-2 rounded-panel border border-line bg-card p-4 text-sm text-ink-3 sm:flex-row sm:items-center">
                <CalendarDays size={18} className="shrink-0 text-ink-4" /> Aucun événement où vous êtes sollicité {periodLabel}.
              </div>
            ) : (
              <div className="space-y-3">
                {[...byDay.entries()].map(([k, items]) => (
                  <div key={k} className="space-y-2">
                    {period === "week" && <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">{dayLabel(items[0].start)}</div>}
                    {items.map((p) => {
                      const org = p.eventType ? EVENT_TYPE_TO_ORG[p.eventType] : null;
                      const color = org ? ORG_COLORS[org] : null;
                      const state = eventState(p);
                      return (
                        <button
                          key={p.eventId}
                          onClick={() => void openEvent(p.eventId)}
                          className="flex w-full flex-col gap-1.5 rounded-card border border-line bg-card p-3 text-left shadow-card transition hover:-translate-y-px hover:border-line-strong sm:flex-row sm:items-start sm:gap-3 sm:p-3.5"
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

        <RecentPosts posts={posts} onSeeAll={onNavigate ? () => onNavigate("audiovisuel") : undefined} />

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
function ActionCard({ action: a, onClick }: { action: DashboardAction; onClick: () => void }) {
  const tone = TONES[a.tone];
  return (
    <button onClick={onClick} className="group w-36 shrink-0 snap-start text-left">
      <div className={`relative aspect-[4/3] overflow-hidden rounded-card shadow-card ${a.thumbUrl ? "bg-navy" : tone.tile}`}>
        {a.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniature signée du premier média
          <img src={a.thumbUrl} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ActionIcon id={a.id} size={34} strokeWidth={1.6} />
          </div>
        )}
        <span className={`absolute right-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold shadow-card ${tone.count}`}>
          {a.count}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-2 text-[12px] font-bold leading-tight text-ink">
        {a.title} ({a.count})
      </div>
      <div className="line-clamp-1 text-[10px] text-ink-4">{a.detail}</div>
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
  if (posts !== null && posts.length === 0) return null;
  return (
    <section className="min-w-0">
      <SectionTitle action={onSeeAll ? { label: "Voir tout", onClick: onSeeAll } : undefined}>Derniers médias publiés</SectionTitle>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {posts === null
          ? Array.from({ length: 5 }, (_, i) => <div key={i} className="aspect-square w-32 shrink-0 animate-pulse rounded-card bg-subtle sm:w-40" />)
          : posts.map((p) => {
              const link = p.networks.find((n) => n.url)?.url ?? null;
              const content = (
                <>
                  <div className="relative aspect-square overflow-hidden rounded-card bg-gradient-to-br from-navy to-navy-500 shadow-card">
                    <div className="absolute inset-0 flex items-center justify-center text-white/50">
                      <ImageIcon size={26} />
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
                      <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
                        <Play size={11} fill="currentColor" />
                      </span>
                    )}
                    <div className="absolute bottom-1.5 left-1.5 flex gap-1">
                      {p.networks.map((n) => {
                        const { Icon, label, color } = NETWORK_ICON[n.network];
                        return (
                          <span key={n.network} title={label} className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-card" style={{ color }}>
                            <Icon size={13} />
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-tight text-ink">{p.title}</div>
                  <div className="flex items-center gap-2 text-[10px] text-ink-4">
                    <span>{ago(p.publishedAt)}</span>
                    {p.views != null && (
                      <span className="flex items-center gap-0.5 font-semibold text-ink-3" title="Vues cumulées sur les réseaux">
                        <Eye size={11} /> {p.views.toLocaleString("fr-FR")}
                      </span>
                    )}
                  </div>
                </>
              );
              return link ? (
                <a key={p.id} href={link} target="_blank" rel="noreferrer" className="group w-32 shrink-0 snap-start sm:w-40">
                  {content}
                </a>
              ) : (
                <div key={p.id} className="group w-32 shrink-0 snap-start sm:w-40">
                  {content}
                </div>
              );
            })}
      </div>
    </section>
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

      <div className="relative flex min-h-[220px] max-w-full flex-col justify-center px-5 py-6 md:min-h-[260px] md:max-w-[52%] md:px-8">
        {mine ? (
          <h1 className="text-2xl font-extrabold leading-tight md:text-[34px]">
            Joyeux anniversaire 🎉
            <br />
            <span className="text-[#F2C14E]">{mine.firstName || firstName} !</span>
          </h1>
        ) : (
          <h1 className="text-2xl font-extrabold md:text-[34px]">Bonjour{firstName ? ` ${firstName}` : ""}.</h1>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
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

        {mine && <p className="mt-3 text-sm text-white/85">Toute l&rsquo;équipe de la Ligue Grand Est de Football te souhaite une excellente journée !</p>}
        {othersLabel && (
          <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
            🎂 C&rsquo;est l&rsquo;anniversaire de {othersLabel} aujourd&rsquo;hui !
          </p>
        )}

        <div className="mt-5">
          <button
            type="button"
            onClick={onTogglePunch}
            className="flex items-center gap-2 rounded-btn bg-red px-5 py-3 text-sm font-bold shadow-btn-red transition hover:bg-red-700"
          >
            <Clock size={16} />
            {punchedIn ? "Pointer la sortie" : "Pointer l'entrée"}
          </button>
        </div>
      </div>
    </section>
  );
}
