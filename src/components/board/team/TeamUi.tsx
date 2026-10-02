"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, CalendarDays, CheckSquare, MessageSquare } from "lucide-react";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";
import { TEAM_COLORS, dueInfo, type TeamCard, type TeamPerson } from "@/lib/board/team";

// Briques de l'Espace Team partagées par le tableau, « Mes cartes », l'équipe et la fiche carte.

const AVATAR_TONES = ["#12305F", "#E1141B", "#2C7A5B", "#7C879C", "#D98A0B", "#5B3FA8", "#2F52B0"];
const toneOf = (id: string) => AVATAR_TONES[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_TONES.length];

export function Avatar({ person, size = 26, ring = false }: { person: TeamPerson | undefined; size?: number; ring?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.36)) };
  const ringCls = ring ? "ring-2 ring-card" : "";
  if (person?.avatarUrl)
    // eslint-disable-next-line @next/next/no-img-element -- photo de profil hébergée par Supabase
    return <img src={person.avatarUrl} alt={person.name} title={person.name} style={style} className={`shrink-0 rounded-full object-cover ${ringCls}`} />;
  return (
    <span
      title={person?.name ?? "Personne supprimée"}
      style={{ ...style, background: person ? toneOf(person.id) : "#79859A" }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${ringCls}`}
    >
      {person?.initials ?? "?"}
    </span>
  );
}

export function AvatarStack({ people, max = 3, size = 24 }: { people: (TeamPerson | undefined)[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((p, i) => (
        <Avatar key={p?.id ?? i} person={p} size={size} ring />
      ))}
      {people.length > max && (
        <span style={{ width: size, height: size }} className="inline-flex items-center justify-center rounded-full bg-chip-bg text-[9px] font-bold text-ink-3 ring-2 ring-card">
          +{people.length - max}
        </span>
      )}
    </span>
  );
}

/** Petite fenêtre ancrée sous un bouton ; se ferme au clic extérieur ou sur Échap. */
export function Popover({ open, onClose, children, align = "left", width = 280 }: { open: boolean; onClose: () => void; children: ReactNode; align?: "left" | "right"; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      style={{ width }}
      className={`absolute top-full z-30 mt-1.5 rounded-card border border-line bg-card p-3 shadow-card ${align === "right" ? "right-0" : "left-0"}`}
    >
      {children}
    </div>
  );
}

const DUE_CLASSES = {
  late: "bg-bad-bg text-bad",
  today: "bg-bad-bg text-bad",
  soon: "bg-warn-bg text-warn",
  normal: "bg-chip-bg text-ink-3",
  done: "bg-good-bg text-good",
} as const;

export function DueChip({ iso, done }: { iso: string | null; done: boolean }) {
  const info = dueInfo(iso, done);
  if (!info) return null;
  return <span className={`rounded-chip px-1.5 py-0.5 font-mono text-[10px] ${DUE_CLASSES[info.tone]}`}>{info.text}</span>;
}

export function ChecklistChip({ card }: { card: TeamCard }) {
  if (!card.checklist.length) return null;
  const done = card.checklist.filter((i) => i.done).length;
  const all = done === card.checklist.length;
  return (
    <span className={`flex items-center gap-1 text-[10px] font-semibold ${all ? "text-good" : "text-ink-4"}`}>
      <CheckSquare size={11} /> {done}/{card.checklist.length}
    </span>
  );
}

/** Barres de couleur en tête de carte : couleur de la carte puis étiquettes. */
export function ColorBars({ card }: { card: TeamCard }) {
  const colors = [...(card.color ? [card.color] : []), ...card.labels.map((l) => l.color)];
  if (!colors.length) return null;
  return (
    <span className="mb-2 flex gap-1">
      {colors.slice(0, 4).map((c, i) => (
        <span key={i} className="h-1 w-8 rounded-full" style={{ background: TEAM_COLORS[c].base }} />
      ))}
    </span>
  );
}

/** Fiche carte ouverte en popup par-dessus la fiche événement : à fermer avant d'ouvrir l'événement lié. */
export const LeaveBeforeEventContext = createContext<(() => void) | null>(null);

/** Lien vers l'événement d'une carte : ouvre sa fiche par-dessus l'écran. */
export function EventChip({ event, compact = false }: { event: NonNullable<TeamCard["event"]>; compact?: boolean }) {
  const { open, loadingId } = useOpenEvent();
  const leave = useContext(LeaveBeforeEventContext);
  const date = new Date(event.startDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void open(event.id).then(() => leave?.());
      }}
      disabled={loadingId === event.id}
      title={`Ouvrir l'événement « ${event.title} »`}
      className="inline-flex max-w-full items-center gap-1 rounded-chip bg-sel-bg px-1.5 py-0.5 text-[10px] font-semibold text-link hover:underline disabled:opacity-60"
    >
      <CalendarDays size={11} className="shrink-0" />
      <span className="truncate">{compact ? event.title : `${event.title} · ${date}`}</span>
      {!compact && <ArrowUpRight size={10} className="shrink-0" />}
    </button>
  );
}

/** Carte du tableau Kanban. */
export function CardTile({
  card,
  done,
  peopleById,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
  isNew,
}: {
  card: TeamCard;
  done: boolean;
  peopleById: Map<string, TeamPerson>;
  onOpen: () => void;
  draggable: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isNew?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={`group relative cursor-pointer rounded-btn border border-line bg-card p-3 text-left shadow-[0_1px_2px_rgba(11,29,60,0.06)] transition hover:border-line-strong hover:shadow-bar ${
        done ? "opacity-70" : ""
      }`}
    >
      {isNew && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red" title="Nouvelle carte" />}
      <ColorBars card={card} />
      <p className={`text-[13px] font-bold leading-snug text-ink ${done ? "line-through decoration-ink-4" : ""}`}>{card.title}</p>
      {card.event && (
        <div className="mt-1.5">
          <EventChip event={card.event} compact />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <DueChip iso={card.dueAt} done={done} />
        <ChecklistChip card={card} />
        {card.commentCount > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold text-ink-4">
            <MessageSquare size={11} /> {card.commentCount}
          </span>
        )}
        <span className="ml-auto">
          <AvatarStack people={card.members.map((m) => peopleById.get(m.userId))} />
        </span>
      </div>
    </div>
  );
}
