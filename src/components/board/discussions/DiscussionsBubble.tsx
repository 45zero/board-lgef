"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, ArrowUpRight, Check, MessageCircle, Search, SquarePen, X } from "lucide-react";
import { listChats, openDirectChat, searchChatTargets, setChatArchived } from "@/app/actions/chat";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { Avatar } from "@/components/board/team/TeamUi";
import { EventChat, asTeamPerson } from "@/components/board/discussions/EventChat";
import {
  DISCUSSIONS_CHANGED,
  OPEN_DISCUSSION,
  parseSourceKey,
  sourceKey,
  type ChatPerson,
  type ChatSearchResults,
  type ChatSource,
  type DiscussionThread,
} from "@/lib/board/discussions";

const ago = (iso: string) => {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h`;
  if (min < 10080) return `${Math.floor(min / 1440)} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};
const eventDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "");
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Visages de la discussion, façon Messenger : une photo, ou deux qui se chevauchent pour un groupe. */
function Faces({ people, size = 44 }: { people: ChatPerson[]; size?: number }) {
  if (people.length === 0)
    return (
      <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-subtle text-ink-3">
        <MessageCircle size={size * 0.42} />
      </span>
    );
  if (people.length === 1) return <Avatar person={asTeamPerson(people[0])} size={size} />;
  const small = Math.round(size * 0.72);
  return (
    <span style={{ width: size, height: size }} className="relative shrink-0">
      <span className="absolute right-0 top-0">
        <Avatar person={asTeamPerson(people[1])} size={small} />
      </span>
      <span className="absolute bottom-0 left-0">
        <Avatar person={asTeamPerson(people[0])} size={small} ring />
      </span>
      {people.length > 2 && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-chip-bg px-1 text-[9px] font-bold text-ink-3 ring-2 ring-card">
          +{people.length - 2}
        </span>
      )}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wide text-ink-4">{children}</div>;
}

/** Ligne d'une discussion de la liste. */
function ThreadRow({ t, onOpen, onArchive, mobile }: { t: DiscussionThread; onOpen: () => void; onArchive: () => void; mobile: boolean }) {
  return (
    <div className="group relative">
      <button onClick={onOpen} className="flex w-full items-center gap-3 px-3 py-2 pr-10 text-left hover:bg-hover">
        <Faces people={t.participants} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 truncate text-sm ${t.unread ? "font-extrabold text-ink" : "font-semibold text-ink-2"}`}>{t.title}</span>
            {t.last && <span className={`shrink-0 text-[11px] ${t.unread ? "font-bold text-navy" : "text-ink-4"}`}>{ago(t.last.at)}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`min-w-0 flex-1 truncate text-xs ${t.unread ? "font-semibold text-ink" : "text-ink-4"}`}>
              {t.last ? `${t.last.authorName} : ${t.last.body}` : ""}
            </span>
            {t.mentioned && <span className="shrink-0 rounded-full bg-sel-bg px-1.5 text-[10px] font-extrabold text-navy">@</span>}
            {t.unread > 0 && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red px-1.5 text-[10px] font-extrabold text-white">{t.unread > 99 ? "99+" : t.unread}</span>
            )}
          </div>
        </div>
      </button>
      <button
        onClick={onArchive}
        title={t.archived ? "Désarchiver" : "Archiver"}
        aria-label={t.archived ? "Désarchiver" : "Archiver"}
        className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-card p-1.5 text-ink-3 shadow-sm hover:text-ink ${mobile ? "" : "opacity-0 group-hover:opacity-100"}`}
      >
        {t.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
      </button>
    </div>
  );
}

type View = { kind: "list"; archived: boolean } | { kind: "new" } | { kind: "chat"; source: ChatSource; title: string; subtitle: string; people: ChatPerson[] };

/** Contenu de la bulle : liste et recherche, nouvelle discussion, conversation. */
function DiscussionsPanel({
  threads,
  loading,
  initial,
  onChanged,
  onClose,
  mobile,
}: {
  threads: DiscussionThread[];
  loading: boolean;
  initial: ChatSource | null;
  onChanged: () => void;
  onClose: () => void;
  mobile: boolean;
}) {
  const { open: openEvent } = useOpenEvent();
  const [view, setView] = useState<View>(() => (initial ? { kind: "chat", source: initial, title: "", subtitle: "", people: [] } : { kind: "list", archived: false }));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSearchResults | null>(null);
  const [selected, setSelected] = useState<ChatPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recherche de personnes et d'événements (liste avec texte saisi, ou nouvelle discussion).
  const searching = view.kind === "new" || (view.kind === "list" && !view.archived && query.trim().length > 0);
  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void searchChatTargets(query).then((res) => !cancelled && setResults(res.ok ? res.data : { people: [], events: [] }));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [searching, query]);

  const go = (next: View) => {
    setView(next);
    setQuery("");
    setResults(null);
    setSelected([]);
    setError(null);
  };

  const describe = (source: ChatSource): { title: string; subtitle: string; people: ChatPerson[] } => {
    const t = threads.find((x) => sourceKey(x.source) === sourceKey(source));
    if (!t) return { title: "", subtitle: "", people: [] };
    return {
      title: t.title,
      subtitle: source.kind === "event" ? `Événement · ${eventDate(t.startDate)}` : t.participants.length > 1 ? `Groupe · ${t.participants.length + 1} personnes` : "Discussion privée",
      people: t.participants,
    };
  };
  const openChat = (source: ChatSource, fallback?: { title: string; subtitle: string; people: ChatPerson[] }) => {
    const d = describe(source);
    go({ kind: "chat", source, ...(d.title ? d : (fallback ?? d)) });
  };
  const openPeople = async (people: ChatPerson[]) => {
    if (!people.length) return;
    setBusy(true);
    setError(null);
    const res = await openDirectChat(people.map((p) => p.id));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const title = people.length === 1 ? people[0].name : people.map((p) => p.name.split(" ")[0]).join(", ");
    openChat({ kind: "direct", id: res.data }, { title, subtitle: people.length > 1 ? `Groupe · ${people.length + 1} personnes` : "Discussion privée", people });
  };
  const archive = async (source: ChatSource, archived: boolean) => {
    await setChatArchived(source, archived);
    onChanged();
  };

  const archivedCount = threads.filter((t) => t.archived).length;
  const q = fold(query.trim());
  const matchThread = (t: DiscussionThread) => !q || fold(t.title).includes(q) || t.participants.some((p) => fold(p.name).includes(q));
  const headerPad = mobile ? { paddingTop: "max(10px, env(safe-area-inset-top))" } : undefined;
  const round = "rounded-full p-2 text-ink-3 hover:bg-hover";

  /* ---------- Conversation ---------- */
  if (view.kind === "chat") {
    const thread = threads.find((t) => sourceKey(t.source) === sourceKey(view.source));
    const d = thread ? describe(view.source) : view;
    const archived = !!thread?.archived;
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2" style={headerPad}>
          <button onClick={() => go({ kind: "list", archived: false })} className={round} aria-label="Retour aux discussions">
            <ArrowLeft size={18} />
          </button>
          <Faces people={d.people} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-extrabold text-ink">{d.title || "Discussion"}</div>
            <div className="truncate text-[11px] text-ink-4">{d.subtitle}</div>
          </div>
          {view.source.kind === "event" && (
            <button
              onClick={() => {
                onClose();
                void openEvent(view.source.id);
              }}
              title="Ouvrir la fiche de l'événement"
              aria-label="Ouvrir la fiche de l'événement"
              className={round}
            >
              <ArrowUpRight size={17} />
            </button>
          )}
          {thread && (
            <button
              onClick={() => {
                void archive(view.source, !archived);
                if (!archived) go({ kind: "list", archived: false });
              }}
              title={archived ? "Désarchiver" : "Archiver la discussion"}
              aria-label={archived ? "Désarchiver" : "Archiver la discussion"}
              className={round}
            >
              {archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
            </button>
          )}
          <button onClick={onClose} className={round} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <EventChat key={sourceKey(view.source)} source={view.source} autoFocus={!mobile} />
        </div>
      </div>
    );
  }

  const peopleResults = (results?.people ?? []).filter((p) => !selected.some((s) => s.id === p.id));

  /* ---------- Liste, recherche, nouvelle discussion ---------- */
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5" style={headerPad}>
        {(view.kind === "new" || view.archived) && (
          <button onClick={() => go({ kind: "list", archived: false })} className={round} aria-label="Retour">
            <ArrowLeft size={18} />
          </button>
        )}
        <h2 className="flex-1 pl-1 text-lg font-extrabold text-ink">{view.kind === "new" ? "Nouvelle discussion" : view.archived ? "Archivées" : "Discussions"}</h2>
        {view.kind === "list" && !view.archived && (
          <button onClick={() => go({ kind: "new" })} title="Nouvelle discussion" aria-label="Nouvelle discussion" className="rounded-full bg-subtle p-2 text-ink-2 hover:bg-hover">
            <SquarePen size={16} />
          </button>
        )}
        <button onClick={onClose} className={round} aria-label="Fermer">
          <X size={18} />
        </button>
      </div>

      <div className="shrink-0 px-3 py-2">
        {view.kind === "new" && selected.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {selected.map((p) => (
              <span key={p.id} className="flex items-center gap-1 rounded-full bg-sel-bg py-0.5 pl-0.5 pr-2 text-xs font-semibold text-navy">
                <Avatar person={asTeamPerson(p)} size={20} />
                {p.name}
                <button onClick={() => setSelected((s) => s.filter((x) => x.id !== p.id))} aria-label={`Retirer ${p.name}`} className="ml-0.5 text-navy/60 hover:text-navy">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 rounded-full bg-subtle px-3 py-2">
          <Search size={14} className="text-ink-4" />
          <input
            key={view.kind}
            autoFocus={view.kind === "new"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={view.kind === "new" ? "À : nom d'une personne, ou un événement…" : "Rechercher une personne, un événement…"}
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-4"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Effacer" className="text-ink-4 hover:text-ink-2">
              <X size={14} />
            </button>
          )}
        </label>
        {view.kind === "new" && selected.length > 0 && (
          <button
            onClick={() => void openPeople(selected)}
            disabled={busy}
            className="mt-2 w-full rounded-full bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {selected.length === 1 ? `Écrire à ${selected[0].name.split(" ")[0]}` : `Créer le groupe (${selected.length + 1} personnes)`}
          </button>
        )}
        {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {searching ? (
          <>
            {view.kind === "list" && threads.some((t) => !t.archived && matchThread(t)) && (
              <>
                <SectionTitle>Discussions</SectionTitle>
                {threads
                  .filter((t) => !t.archived && matchThread(t))
                  .slice(0, 5)
                  .map((t) => (
                    <ThreadRow key={sourceKey(t.source)} t={t} mobile={mobile} onOpen={() => openChat(t.source)} onArchive={() => void archive(t.source, true)} />
                  ))}
              </>
            )}
            {results === null ? (
              <p className="px-4 py-6 text-center text-sm text-ink-4">Recherche…</p>
            ) : (
              <>
                {peopleResults.length > 0 && (
                  <>
                    <SectionTitle>{view.kind === "new" ? "Ajouter des personnes" : "Écrire à une personne"}</SectionTitle>
                    {peopleResults.map((p) => (
                      <button
                        key={p.id}
                        disabled={busy}
                        onClick={() => (view.kind === "new" ? (setSelected((s) => [...s, p]), setQuery("")) : void openPeople([p]))}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover disabled:opacity-60"
                      >
                        <Avatar person={asTeamPerson(p)} size={40} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{p.name}</span>
                        {view.kind === "new" && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line text-transparent">
                            <Check size={12} />
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                )}
                {selected.length === 0 && results.events.length > 0 && (
                  <>
                    <SectionTitle>Discussion d&apos;un événement</SectionTitle>
                    {results.events.map((e) => {
                      const existing = threads.find((t) => t.source.kind === "event" && t.source.id === e.id);
                      return (
                        <button
                          key={e.id}
                          onClick={() => openChat({ kind: "event", id: e.id }, { title: e.title, subtitle: `Événement · ${eventDate(e.startDate)}`, people: existing?.participants ?? [] })}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover"
                        >
                          <Faces people={existing?.participants ?? []} size={40} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-ink">{e.title}</div>
                            <div className="text-xs text-ink-4">
                              {existing ? "Discussion en cours · " : ""}
                              {eventDate(e.startDate)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </>
                )}
                {peopleResults.length === 0 && results.events.length === 0 && <p className="px-4 py-6 text-center text-sm text-ink-4">Aucun résultat.</p>}
              </>
            )}
          </>
        ) : loading && threads.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-4">Chargement…</p>
        ) : (
          (() => {
            const shown = threads.filter((t) => t.archived === (view.kind === "list" && view.archived) && matchThread(t));
            if (shown.length === 0)
              return (
                <div className="px-6 py-10 text-center">
                  <MessageCircle size={28} className="mx-auto text-ink-4" />
                  <p className="mt-2 text-sm font-semibold text-ink-2">{view.kind === "list" && view.archived ? "Aucune discussion archivée." : "Aucune discussion pour l'instant."}</p>
                  {view.kind === "list" && !view.archived && (
                    <>
                      <p className="mt-1 text-xs text-ink-4">Les discussions où vous êtes mentionné ou avez écrit apparaissent ici. Cherchez une personne ou un événement pour en démarrer une.</p>
                      <button onClick={() => go({ kind: "new" })} className="mt-4 rounded-full bg-navy px-4 py-2 text-xs font-bold text-white">
                        Nouvelle discussion
                      </button>
                    </>
                  )}
                </div>
              );
            return shown.map((t) => <ThreadRow key={sourceKey(t.source)} t={t} mobile={mobile} onOpen={() => openChat(t.source)} onArchive={() => void archive(t.source, !t.archived)} />);
          })()
        )}
        {view.kind === "list" && !view.archived && !searching && archivedCount > 0 && (
          <button onClick={() => go({ kind: "list", archived: true })} className="mx-auto mt-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover">
            <Archive size={13} /> Discussions archivées ({archivedCount})
          </button>
        )}
      </div>
    </div>
  );
}

const MOBILE_POS_KEY = "board:discussions-bubble";
const BUBBLE = 56;
type Side = "left" | "right";

function readSavedPos(): { side: Side; y: number } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(MOBILE_POS_KEY) ?? "null");
    if (saved && (saved.side === "left" || saved.side === "right") && typeof saved.y === "number") return saved;
  } catch {}
  return null;
}

/**
 * Bulle « Discussions », façon Messenger : discussions d'événements où l'on est mentionné ou a
 * écrit, et discussions directes avec d'autres utilisateurs (à deux ou en groupe) ; recherche de
 * personnes et d'événements, conversation dans la bulle, archivage (la discussion revient à la
 * notification suivante). Ordinateur : en bas à droite ; mobile et appli : bulle déplaçable au
 * doigt, rangée contre un bord (position mémorisée), conversation en plein écran.
 * Ouverte directement sur une discussion par le lien `?openChat=<event|direct>:<id>` (push).
 */
export function DiscussionsBubble({ mobile = false }: { mobile?: boolean }) {
  const [threads, setThreads] = useState<DiscussionThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<ChatSource | null>(null);
  const [panelKey, setPanelKey] = useState(0);

  const load = useCallback(async () => {
    const res = await listChats();
    if (res.ok) setThreads(res.data);
    setLoading(false);
  }, []);

  const openOn = useCallback((source: ChatSource | null) => {
    setInitial(source);
    setPanelKey((k) => k + 1);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onChanged = () => void load();
    const onOpen = (e: Event) => openOn((e as CustomEvent<ChatSource>).detail ?? null);
    const first = window.setTimeout(() => {
      onChanged();
      // Lien profond (push d'un message) : ouvre la conversation, puis nettoie l'adresse.
      const url = new URL(window.location.href);
      const source = parseSourceKey(url.searchParams.get("openChat"));
      if (url.searchParams.has("openChat")) {
        url.searchParams.delete("openChat");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
      if (source) openOn(source);
    }, 0);
    window.addEventListener(DISCUSSIONS_CHANGED, onChanged);
    window.addEventListener(OPEN_DISCUSSION, onOpen);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener(DISCUSSIONS_CHANGED, onChanged);
      window.removeEventListener(OPEN_DISCUSSION, onOpen);
    };
  }, [load, openOn]);
  useLiveRefresh(["notifications"], () => void load(), 800);
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [open, load]);

  const unread = threads.reduce((n, t) => n + (t.archived ? 0 : t.unread), 0);

  /* ---------- Mobile : bulle déplaçable ---------- */
  const [pos, setPos] = useState<{ side: Side; y: number } | null>(() =>
    mobile && typeof window !== "undefined" ? (readSavedPos() ?? { side: "right", y: window.innerHeight - 180 }) : null
  );
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);

  const clampY = (y: number) => Math.min(Math.max(y, 80), window.innerHeight - 150);
  const bubbleX = (side: Side) => (side === "left" ? 10 : window.innerWidth - BUBBLE - 10);

  const label = unread ? `Discussions, ${unread} message${unread > 1 ? "s" : ""} non lu${unread > 1 ? "s" : ""}` : "Discussions";
  const face = (
    <>
      <MessageCircle size={26} fill="currentColor" strokeWidth={1.5} />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-red px-1.5 text-[11px] font-extrabold text-white ring-2 ring-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </>
  );
  const bubbleClass =
    "relative flex h-14 w-14 select-none items-center justify-center rounded-full bg-gradient-to-br from-[#2b5bb5] to-navy text-white shadow-modal ring-4 ring-white/70 transition-transform active:scale-95";
  const panel = <DiscussionsPanel key={panelKey} threads={threads} loading={loading} initial={initial} onChanged={() => void load()} onClose={() => setOpen(false)} mobile={mobile} />;

  if (mobile) {
    if (!pos) return null;
    const x = drag?.x ?? bubbleX(pos.side);
    const y = drag?.y ?? pos.y;
    return (
      <>
        {!open && (
          <div className={`fixed z-[50] ${drag ? "" : "transition-[left,top] duration-200 ease-out"}`} style={{ left: x, top: y }}>
            <button
              type="button"
              aria-label={label}
              className={`${bubbleClass} touch-none`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                start.current = { px: e.clientX, py: e.clientY, x: bubbleX(pos.side), y: pos.y, moved: false };
              }}
              onPointerMove={(e) => {
                const s = start.current;
                if (!s) return;
                const dx = e.clientX - s.px;
                const dy = e.clientY - s.py;
                if (!s.moved && Math.hypot(dx, dy) < 6) return;
                s.moved = true;
                setDrag({ x: s.x + dx, y: clampY(s.y + dy) });
              }}
              onPointerUp={(e) => {
                const s = start.current;
                start.current = null;
                if (!s) return;
                if (!s.moved) {
                  openOn(null);
                  return;
                }
                // Lâchée : rangée contre le bord le plus proche.
                const next = { side: (e.clientX < window.innerWidth / 2 ? "left" : "right") as Side, y: clampY(s.y + (e.clientY - s.py)) };
                setDrag(null);
                setPos(next);
                try {
                  localStorage.setItem(MOBILE_POS_KEY, JSON.stringify(next));
                } catch {}
              }}
              onPointerCancel={() => {
                start.current = null;
                setDrag(null);
              }}
            >
              {face}
            </button>
          </div>
        )}
        {open && <div className="fixed inset-0 z-[56] flex flex-col bg-card">{panel}</div>}
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-[40] flex flex-col items-end gap-3">
      {open && <div className="pointer-events-auto h-[min(620px,calc(100vh-200px))] w-[380px] overflow-hidden rounded-modal border border-line bg-card shadow-modal">{panel}</div>}
      <button type="button" aria-label={label} title="Discussions" onClick={() => (open ? setOpen(false) : openOn(null))} className={`pointer-events-auto ${bubbleClass}`}>
        {face}
      </button>
    </div>
  );
}
