"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, ArrowUpRight, MessageCircle, Search, SquarePen, X } from "lucide-react";
import { listMyDiscussions, setDiscussionArchived } from "@/app/actions/event-comments";
import { searchTeamEvents } from "@/app/actions/team";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { Avatar } from "@/components/board/team/TeamUi";
import { EventChat, asTeamPerson } from "@/components/board/discussions/EventChat";
import { DISCUSSIONS_CHANGED, type ChatPerson, type DiscussionThread } from "@/lib/board/discussions";

const ago = (iso: string) => {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h`;
  if (min < 10080) return `${Math.floor(min / 1440)} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};
const eventDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "");

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

type View = { kind: "list"; archived: boolean } | { kind: "new" } | { kind: "chat"; eventId: string; title: string; startDate: string | null; people: ChatPerson[] };

/** Contenu de la bulle : liste des discussions, nouvelle discussion, conversation. */
function DiscussionsPanel({ threads, loading, onChanged, onClose, mobile }: { threads: DiscussionThread[]; loading: boolean; onChanged: () => void; onClose: () => void; mobile: boolean }) {
  const { open: openEvent } = useOpenEvent();
  const [view, setView] = useState<View>({ kind: "list", archived: false });
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<{ id: string; title: string; startDate: string }[] | null>(null);

  useEffect(() => {
    if (view.kind !== "new") return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void searchTeamEvents(query).then((res) => !cancelled && setEvents(res.ok ? res.data : []));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [view.kind, query]);

  const go = (next: View) => {
    setView(next);
    setQuery("");
    if (next.kind === "new") setEvents(null);
  };
  const openChat = (eventId: string, title: string, startDate: string | null) =>
    go({ kind: "chat", eventId, title, startDate, people: threads.find((t) => t.eventId === eventId)?.participants ?? [] });
  const archive = async (eventId: string, archived: boolean) => {
    await setDiscussionArchived(eventId, archived);
    onChanged();
  };

  const archivedCount = threads.filter((t) => t.archived).length;
  const shown = view.kind === "list" ? threads.filter((t) => t.archived === view.archived && (!query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase()))) : [];
  const headerPad = mobile ? { paddingTop: "max(10px, env(safe-area-inset-top))" } : undefined;
  const round = "rounded-full p-2 text-ink-3 hover:bg-hover";

  if (view.kind === "chat") {
    const thread = threads.find((t) => t.eventId === view.eventId);
    const archived = !!thread?.archived;
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2" style={headerPad}>
          <button onClick={() => go({ kind: "list", archived: false })} className={round} aria-label="Retour aux discussions">
            <ArrowLeft size={18} />
          </button>
          <Faces people={thread?.participants ?? view.people} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-extrabold text-ink">{view.title}</div>
            <div className="truncate text-[11px] text-ink-4">{eventDate(view.startDate)}</div>
          </div>
          <button
            onClick={() => {
              onClose();
              void openEvent(view.eventId);
            }}
            title="Ouvrir la fiche de l'événement"
            aria-label="Ouvrir la fiche de l'événement"
            className={round}
          >
            <ArrowUpRight size={17} />
          </button>
          <button
            onClick={() => {
              void archive(view.eventId, !archived);
              if (!archived) go({ kind: "list", archived: false });
            }}
            title={archived ? "Désarchiver" : "Archiver la discussion"}
            aria-label={archived ? "Désarchiver" : "Archiver la discussion"}
            className={round}
          >
            {archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
          </button>
          <button onClick={onClose} className={round} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <EventChat key={view.eventId} eventId={view.eventId} autoFocus={!mobile} />
        </div>
      </div>
    );
  }

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
        <label className="flex items-center gap-2 rounded-full bg-subtle px-3 py-2">
          <Search size={14} className="text-ink-4" />
          <input
            key={view.kind}
            autoFocus={view.kind === "new"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={view.kind === "new" ? "Chercher un événement…" : "Rechercher une discussion"}
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-4"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {view.kind === "new" ? (
          events === null ? (
            <p className="px-4 py-6 text-center text-sm text-ink-4">Recherche…</p>
          ) : events.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-4">Aucun événement trouvé.</p>
          ) : (
            events.map((e) => {
              const existing = threads.find((t) => t.eventId === e.id);
              return (
                <button key={e.id} onClick={() => openChat(e.id, e.title, e.startDate)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover">
                  <Faces people={existing?.participants ?? []} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{e.title}</div>
                    <div className="text-xs text-ink-4">{existing ? "Discussion en cours · " : ""}{eventDate(e.startDate)}</div>
                  </div>
                </button>
              );
            })
          )
        ) : loading && threads.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-4">Chargement…</p>
        ) : shown.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <MessageCircle size={28} className="mx-auto text-ink-4" />
            <p className="mt-2 text-sm font-semibold text-ink-2">{query ? "Aucune discussion trouvée." : view.archived ? "Aucune discussion archivée." : "Aucune discussion pour l'instant."}</p>
            {!query && !view.archived && (
              <>
                <p className="mt-1 text-xs text-ink-4">Les discussions des événements où vous êtes sollicité, mentionné ou avez écrit apparaissent ici.</p>
                <button onClick={() => go({ kind: "new" })} className="mt-4 rounded-full bg-navy px-4 py-2 text-xs font-bold text-white">
                  Démarrer une discussion
                </button>
              </>
            )}
          </div>
        ) : (
          shown.map((t) => (
            <div key={t.eventId} className="group relative">
              <button onClick={() => openChat(t.eventId, t.title, t.startDate)} className="flex w-full items-center gap-3 px-3 py-2 pr-10 text-left hover:bg-hover">
                <Faces people={t.participants} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`min-w-0 flex-1 truncate text-sm ${t.unread ? "font-extrabold text-ink" : "font-semibold text-ink-2"}`}>{t.title}</span>
                    <span className={`shrink-0 text-[11px] ${t.unread ? "font-bold text-navy" : "text-ink-4"}`}>{ago(t.last.at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`min-w-0 flex-1 truncate text-xs ${t.unread ? "font-semibold text-ink" : "text-ink-4"}`}>
                      {t.last.authorName} : {t.last.body}
                    </span>
                    {t.mentioned && <span className="shrink-0 rounded-full bg-sel-bg px-1.5 text-[10px] font-extrabold text-navy">@</span>}
                    {t.unread > 0 && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red px-1.5 text-[10px] font-extrabold text-white">{t.unread > 99 ? "99+" : t.unread}</span>
                    )}
                  </div>
                </div>
              </button>
              <button
                onClick={() => void archive(t.eventId, !t.archived)}
                title={t.archived ? "Désarchiver" : "Archiver"}
                aria-label={t.archived ? "Désarchiver" : "Archiver"}
                className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-card p-1.5 text-ink-3 shadow-sm hover:text-ink ${mobile ? "" : "opacity-0 group-hover:opacity-100"}`}
              >
                {t.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              </button>
            </div>
          ))
        )}
        {view.kind === "list" && !view.archived && archivedCount > 0 && !query && (
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
 * Bulle « Discussions », façon Messenger : messages non lus, discussions des événements (visages
 * des participants), conversation directement dans la bulle, archivage, nouvelle discussion.
 * Ordinateur : en bas à droite ; mobile et appli : bulle flottante déplaçable au doigt, qui se
 * range contre le bord gauche ou droit (position mémorisée), conversation en plein écran.
 */
export function DiscussionsBubble({ mobile = false }: { mobile?: boolean }) {
  const [threads, setThreads] = useState<DiscussionThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await listMyDiscussions();
    if (res.ok) setThreads(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    const onChanged = () => void load();
    const first = window.setTimeout(onChanged, 0);
    window.addEventListener(DISCUSSIONS_CHANGED, onChanged);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener(DISCUSSIONS_CHANGED, onChanged);
    };
  }, [load]);
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
  const panel = <DiscussionsPanel threads={threads} loading={loading} onChanged={() => void load()} onClose={() => setOpen(false)} mobile={mobile} />;

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
                  setOpen(true);
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
      {open && (
        <div className="pointer-events-auto h-[min(620px,calc(100vh-200px))] w-[380px] overflow-hidden rounded-modal border border-line bg-card shadow-modal">{panel}</div>
      )}
      <button type="button" aria-label={label} title="Discussions" onClick={() => setOpen((o) => !o)} className={`pointer-events-auto ${bubbleClass}`}>
        {face}
      </button>
    </div>
  );
}
