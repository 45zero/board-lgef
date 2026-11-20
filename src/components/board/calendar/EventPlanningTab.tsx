"use client";

import { useMemo } from "react";
import { Camera, Check, Minus, Users, Video } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEventPresence } from "@/hooks/board/useEventPresence";
import { useCoverageCrew } from "@/hooks/board/useCoverageCrew";
import type { TeamMember } from "@/hooks/board/useEventTeam";
import type { DirectorAttendance, DirectorProfile } from "@/hooks/board/useDirectorAttendance";
import { EventPresenceDays } from "@/components/board/calendar/EventPresenceDays";
import { PRESENCE_KINDS, PRESENCE_KIND_LABEL, dayLabel, eventDays, kindsOfRole, slotLabel, type PresenceKind, type Slot } from "@/lib/board/presence";

const KIND_ICON: Record<PresenceKind, typeof Video> = { video: Video, photo: Camera, cd: Users };
const ROLE_LABEL: Record<string, string> = { video: "Vidéo", photo: "Photo", both: "Photo + vidéo" };

type Person = { id: string; name: string; roles: string[]; kinds: PresenceKind[]; pending: boolean };

const nameOf = (p: { first_name: string | null; last_name: string | null; email?: string | null } | null | undefined) =>
  `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || p?.email || "";

/**
 * Onglet « Planning » d'un événement de plusieurs jours : mes jours de présence (à préciser), puis
 * qui est là quel jour — comité directeur, captation, équipe et personnes venues d'elles-mêmes — avec
 * en tête les présences souhaitées par le responsable. Sans précision, une personne sollicitée est
 * comptée présente tous les jours ; une demande non encore acceptée apparaît « demandé ».
 */
export function EventPlanningTab({
  eventId,
  startISO,
  endISO,
  solicited,
  team,
  attendances,
  directors,
  technicians,
  lead,
  askMine,
}: {
  eventId: string;
  startISO: string;
  endISO: string;
  solicited: boolean;
  team: TeamMember[];
  attendances: DirectorAttendance[];
  directors: DirectorProfile[];
  technicians: { id: string; name: string }[];
  lead: { id: string; role: string | null; accepted: boolean } | null;
  /** Vient d'accepter ou de se proposer : on lui demande ses jours. */
  askMine?: boolean;
}) {
  const { user } = useAuth();
  const { rows, requests } = useEventPresence(eventId);
  const { crew } = useCoverageCrew(eventId);
  const days = useMemo(() => eventDays(startISO, endISO), [startISO, endISO]);

  const people = useMemo<Person[]>(() => {
    const map = new Map<string, Person>();
    const techName = (id: string) => technicians.find((t) => t.id === id)?.name ?? "";
    const add = (id: string | null | undefined, name: string, role: string, kinds: PresenceKind[], pending = false) => {
      if (!id) return;
      const prev = map.get(id);
      map.set(id, {
        id,
        name: prev?.name ?? (name || "—"),
        roles: prev?.roles.includes(role) ? prev.roles : [...(prev?.roles ?? []), role],
        kinds: [...new Set([...(prev?.kinds ?? []), ...kinds])],
        pending: prev ? prev.pending && pending : pending,
      });
    };
    for (const a of attendances) {
      if (a.status === "denied" || !a.director_id) continue;
      add(a.director_id, nameOf(directors.find((d) => d.id === a.director_id)), "CD", ["cd"], a.status !== "approved");
    }
    if (lead) add(lead.id, techName(lead.id), ROLE_LABEL[lead.role ?? ""] ?? "Captation", kindsOfRole(lead.role), !lead.accepted);
    for (const c of crew) {
      if (c.status === "declined") continue;
      add(c.user_id, techName(c.user_id), ROLE_LABEL[c.role] ?? "Captation", kindsOfRole(c.role), c.status !== "accepted");
    }
    for (const t of team) add(t.user_id, nameOf(t.profiles), t.role === "responsable" ? "Responsable" : "Participant", []);
    for (const r of rows ?? []) add(r.user_id, nameOf(r.profiles), "Présent", []);
    return [...map.values()];
  }, [attendances, directors, technicians, lead, crew, team, rows]);

  const rowsBy = useMemo(() => {
    const m = new Map<string, Map<string, Slot>>();
    for (const r of rows ?? []) {
      const own = m.get(r.user_id) ?? new Map<string, Slot>();
      own.set(r.day, { start: r.start_time?.slice(0, 5) ?? "", end: r.end_time?.slice(0, 5) ?? "" });
      m.set(r.user_id, own);
    }
    return m;
  }, [rows]);

  /** Contenu d'une case : présent (heures), présent par défaut, absent, ou demandé (pas encore accepté). */
  const cell = (p: Person, day: string): { kind: "yes" | "all" | "no" | "asked"; label: string } => {
    const own = rowsBy.get(p.id);
    if (own) {
      const s = own.get(day);
      return s ? { kind: "yes", label: slotLabel(s) } : { kind: "no", label: "" };
    }
    const wanted = requests ? p.kinds.filter((k) => Object.keys(requests[k]).length) : [];
    if (wanted.length && requests) {
      const slot = wanted.map((k) => requests[k][day]).find(Boolean);
      if (!slot) return { kind: "no", label: "" };
      return { kind: p.pending ? "asked" : "yes", label: slotLabel(slot) };
    }
    return { kind: "all", label: "" };
  };

  const anyRequest = !!requests && PRESENCE_KINDS.some((k) => Object.keys(requests[k]).length);

  return (
    <div className="space-y-4">
      <div className={askMine ? "rounded-btn ring-2 ring-red ring-offset-2" : ""}>
        {askMine && <p className="mb-1.5 px-1 text-xs font-bold text-red">Quels jours serez-vous là, et à quelle heure ?</p>}
        <EventPresenceDays eventId={eventId} startISO={startISO} endISO={endISO} solicited={solicited} />
      </div>

      <div className="overflow-x-auto rounded-btn border border-line">
        <table className="w-full min-w-[520px] border-collapse text-xs">
          <thead>
            <tr className="bg-subtle/60">
              <th className="sticky left-0 z-[1] bg-subtle px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-4">Qui</th>
              {days.map((d) => (
                <th key={d} className="px-2 py-2 text-center font-semibold capitalize text-ink-2">
                  {dayLabel(d, "EEE d")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {anyRequest && requests && (
              <tr className="border-t border-line bg-sel-bg/40">
                <td className="sticky left-0 z-[1] bg-sel-bg px-3 py-1.5 text-[11px] font-bold text-navy">Souhaité</td>
                {days.map((d) => (
                  <td key={d} className="px-1 py-1.5 text-center align-top">
                    <div className="flex flex-col items-center gap-0.5">
                      {PRESENCE_KINDS.filter((k) => requests[k][d]).map((k) => {
                        const Icon = KIND_ICON[k];
                        const label = slotLabel(requests[k][d]);
                        return (
                          <span key={k} title={`${PRESENCE_KIND_LABEL[k]}${label ? ` ${label}` : ""}`} className="flex items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold text-navy">
                            {k === "cd" ? <span className="font-extrabold">CD</span> : <Icon size={11} />}
                            {label && <span className="font-mono">{label}</span>}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                ))}
              </tr>
            )}
            {people.length === 0 && (
              <tr>
                <td colSpan={days.length + 1} className="px-3 py-4 text-center text-ink-4">
                  Personne n&rsquo;est encore inscrit sur cet événement.
                </td>
              </tr>
            )}
            {people.map((p) => (
              <tr key={p.id} className={`border-t border-line ${p.id === user?.id ? "bg-sel-bg/30" : ""}`}>
                <td className="sticky left-0 z-[1] bg-card px-3 py-1.5">
                  <div className="truncate font-semibold text-ink">
                    {p.name}
                    {p.id === user?.id && <span className="ml-1 text-[10px] font-normal text-link">(vous)</span>}
                  </div>
                  <div className="truncate text-[10px] text-ink-4">
                    {p.roles.join(" · ")}
                    {p.pending && " · à confirmer"}
                  </div>
                </td>
                {days.map((d) => {
                  const c = cell(p, d);
                  return (
                    <td key={d} className="px-1 py-1.5 text-center">
                      {c.kind === "yes" && (
                        <span className="inline-flex flex-col items-center rounded-md bg-good-bg px-1.5 py-0.5 font-semibold text-good">
                          <Check size={12} />
                          {c.label && <span className="font-mono text-[10px]">{c.label}</span>}
                        </span>
                      )}
                      {c.kind === "all" && (
                        <span title="Présent sur tout l'événement (rien de précisé)" className="inline-flex text-good opacity-50">
                          <Check size={12} />
                        </span>
                      )}
                      {c.kind === "asked" && (
                        <span title="Demandé, pas encore confirmé" className="inline-flex flex-col items-center rounded-md bg-warn-bg px-1.5 py-0.5 text-[10px] font-semibold text-warn">
                          demandé
                          {c.label && <span className="font-mono">{c.label}</span>}
                        </span>
                      )}
                      {c.kind === "no" && <Minus size={12} className="inline text-ink-4 opacity-40" />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] leading-relaxed text-ink-4">
        Vert : présent · vert pâle : présent sur tout l&rsquo;événement (rien de précisé) · <span className="font-semibold text-warn">demandé</span> : pas encore confirmé. Chacun précise ses jours dans « Ma présence ».
      </p>
    </div>
  );
}

/**
 * Onglet Détails d'un événement de plusieurs jours : une barre bien visible qui dit quand je suis
 * là (« Vous êtes présent lun. 14 déc. 14h–17h »), avec un lien vers l'onglet Planning pour préciser.
 */
export function MyPresenceBar({
  eventId,
  solicited,
  onOpenPlanning,
}: {
  eventId: string;
  solicited: boolean;
  onOpenPlanning: () => void;
}) {
  const { user } = useAuth();
  const { rows } = useEventPresence(eventId);
  if (!rows || !user) return null;
  const mine = rows.filter((r) => r.user_id === user.id);
  const text = mine.length
    ? `Vous êtes présent ${mine
        .map((r) => [dayLabel(r.day), slotLabel({ start: r.start_time?.slice(0, 5) ?? "", end: r.end_time?.slice(0, 5) ?? "" })].filter(Boolean).join(" "))
        .join(", ")}`
    : solicited
      ? "Vous êtes présent sur tout l'événement"
      : "Vous venez sur certains jours ?";
  const action = mine.length || solicited ? "Préciser mes jours" : "Choisir mes jours";
  return (
    <button
      type="button"
      onClick={onOpenPlanning}
      className={`flex w-full items-center gap-2 rounded-btn border-l-4 px-3 py-2 text-left text-xs ${
        mine.length ? "border-l-navy bg-sel-bg text-navy" : "border-l-line-strong bg-subtle text-ink-2"
      } hover:brightness-95`}
    >
      <Check size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 font-semibold">{text}</span>
      <span className="shrink-0 font-semibold text-link underline-offset-2 hover:underline">{action} →</span>
    </button>
  );
}
