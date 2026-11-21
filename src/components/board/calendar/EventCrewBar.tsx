"use client";

import { describeSlots, kindsOfRole, type DaySlots, type PresenceKind, type PresenceRequests } from "@/lib/board/presence";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Crown, Loader2, Plus, Video, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTravelToEvent } from "@/components/board/calendar/StaffEventsMap";
import { DirectorDeclineForm } from "@/components/board/calendar/DirectorDeclineForm";
import { COVERAGE_COLORS } from "@/lib/board/tokens";
import type { Travel } from "@/lib/board/geo";
import type { useUserRole } from "@/hooks/board/useUserRole";
import type { useDirectorAttendance, DirectorProfile } from "@/hooks/board/useDirectorAttendance";
import type { useEventCoverage, CoverageRole } from "@/hooks/board/useEventCoverage";
import type { TechnicianOption } from "@/hooks/board/useAvailableTechnicians";
import { useCoverageCrew } from "@/hooks/board/useCoverageCrew";
import { DeliveryDateField, saveDeliveryDate } from "@/components/board/calendar/DeliveryDateField";

/**
 * Barre du bas de la fiche événement (à côté de « Supprimer ») : qui sera là.
 *   CD · Photo · Vidéo — une pastille d'initiales par personne : vert = confirmé, orange = en attente
 *   de sa réponse, rouge = a décliné (à remplacer) ; dessous, ses km et minutes de route.
 * Clic sur une pastille : détail, répondre (si c'est moi), changer le rôle ou retirer (si j'attribue).
 * « + » : ajouter quelqu'un, les plus proches de l'événement d'abord.
 * Le technicien principal reste celui de coverage_requests (circuit de couverture inchangé) ; les
 * suivants sont des renforts (coverage_crew). Une personne « photo + vidéo » apparaît dans les deux.
 */

type Status = "ok" | "wait" | "no";
type Pill = {
  key: string;
  kind: "cd" | "lead" | "crew";
  rowId: string;
  userId: string;
  name: string;
  role?: CoverageRole;
  status: Status;
  note: string | null;
};
type Group = "cd" | "photo" | "video";

const STATUS_LABEL: Record<Status, string> = { ok: "Confirmé", wait: "En attente de réponse", no: "A décliné" };
const STATUS_COLOR: Record<Status, { ink: string; bg: string }> = { ok: COVERAGE_COLORS.photo, wait: COVERAGE_COLORS.wait, no: COVERAGE_COLORS.no };
const ROLE_LABEL: Record<CoverageRole, string> = { photo: "Photographe", video: "Vidéaste", both: "Photo + vidéo" };

const nameOf = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "—";
const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
const shortTime = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
};
const inGroup = (role: CoverageRole | null | undefined, g: "photo" | "video") => role === "both" || role === g || (g === "video" && !role);

export function EventCrewBar({
  eventId,
  role,
  technicians,
  coverage,
  director,
  requests = null,
  onJoined,
}: {
  eventId: string;
  role: ReturnType<typeof useUserRole>;
  technicians: TechnicianOption[];
  coverage: ReturnType<typeof useEventCoverage>;
  director: ReturnType<typeof useDirectorAttendance>;
  /** Événement de plusieurs jours : présences souhaitées par rôle (jours et moment fort). */
  requests?: PresenceRequests | null;
  /** Vient de confirmer sa présence ou de se proposer : on lui demande ses jours (onglet Planning). */
  onJoined?: () => void;
}) {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const crew = useCoverageCrew(eventId);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<Group | null>(null);

  const canManageCd = role.isOrganizer || role.canAssignCoverage || (role.role ?? "").startsWith("comite_directeur");
  const canManageCrew = role.canAssignCoverage;
  const req = coverage.request;
  const leadId = req?.assigned_technician_id ?? null;
  const techName = (id: string) => technicians.find((t) => t.id === id)?.name ?? "—";
  /** Jours / heures demandés pour le rôle de cette personne (« mar. 15 déc. 14h–17h »). */
  const requestedFor = (p: Pill) => {
    if (!requests) return null;
    const kinds: PresenceKind[] = p.kind === "cd" ? ["cd"] : kindsOfRole(p.role);
    const merged: DaySlots = {};
    for (const k of kinds) Object.assign(merged, requests[k]);
    return Object.keys(merged).length ? describeSlots(merged) : null;
  };

  const pills = useMemo(() => {
    const cd: Pill[] = director.attendances.map((a) => {
      const d = director.directors.find((x) => x.id === a.director_id);
      return {
        key: `cd:${a.id}`,
        kind: "cd",
        rowId: a.id,
        userId: a.director_id!,
        name: d ? nameOf(d) : "Membre CD",
        status: a.status === "approved" ? "ok" : a.status === "denied" ? "no" : "wait",
        note: a.comments,
      };
    });
    const lead: Pill | null =
      req && leadId
        ? {
            key: `lead:${req.id}`,
            kind: "lead",
            rowId: req.id,
            userId: leadId,
            name: req.assigned_technician_name || techName(leadId),
            role: req.technician_role ?? undefined,
            status: req.technician_response === "accepted" ? "ok" : req.technician_response === "rejected" ? "no" : "wait",
            note: req.technician_response_notes,
          }
        : null;
    const extra: Pill[] = crew.crew.map((c) => ({
      key: `crew:${c.id}`,
      kind: "crew",
      rowId: c.id,
      userId: c.user_id,
      name: techName(c.user_id),
      role: c.role,
      status: c.status === "accepted" ? "ok" : c.status === "declined" ? "no" : "wait",
      note: c.notes,
    }));
    const media = [...(lead ? [lead] : []), ...extra];
    return {
      cd,
      photo: media.filter((p) => inGroup(p.role, "photo")),
      video: media.filter((p) => inGroup(p.role, "video")),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- techName dérive de technicians
  }, [director.attendances, director.directors, req, leadId, crew.crew, technicians]);

  const everyone = [...new Set([...pills.cd, ...pills.photo, ...pills.video].map((p) => p.userId))];
  const travel = useTravelToEvent(everyone.length ? eventId : null, everyone);
  const takenMedia = new Set([leadId, ...crew.crew.map((c) => c.user_id)].filter(Boolean) as string[]);

  const groups: { id: Group; label: string; icon: React.ReactNode; pills: Pill[]; canAdd: boolean }[] = [
    { id: "cd", label: "CD", icon: <Crown size={12} />, pills: pills.cd, canAdd: canManageCd && director.freeDirectors.length > 0 },
    { id: "photo", label: "Photo", icon: <Camera size={12} />, pills: pills.photo, canAdd: canManageCrew },
    { id: "video", label: "Vidéo", icon: <Video size={12} />, pills: pills.video, canAdd: canManageCrew },
  ];

  const addMedia = async (t: TechnicianOption, g: "photo" | "video") => {
    // Personne en charge : la première désignation passe par la demande de couverture (circuit
    // complet) ; les suivantes sont des renforts.
    if (!leadId && role.isSuperUser) await coverage.assignPending(t, g);
    else await crew.add(t.id, g);
  };

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
      {groups
        .filter((g) => g.pills.length > 0 || g.canAdd)
        .map((g) => (
          <div key={g.id} className="flex items-start gap-1.5">
            <span className="mt-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4" title={g.id === "cd" ? "Comité directeur" : undefined}>
              {g.icon}
              {g.label}
            </span>
            {g.pills.map((p) => (
              <div key={`${g.id}:${p.key}`} className="relative">
                <PillButton pill={p} travel={travel[p.userId]} onClick={() => setOpen(open === `${g.id}:${p.key}` ? null : `${g.id}:${p.key}`)} />
                {open === `${g.id}:${p.key}` && (
                  <UpPopover onClose={() => setOpen(null)}>
                    <PillDetail
                      eventId={eventId}
                      pill={p}
                      travel={travel[p.userId]}
                      isMe={p.userId === me}
                      canManage={p.kind === "cd" ? canManageCd : p.kind === "lead" ? role.isSuperUser : canManageCrew}
                      freeDirectors={director.freeDirectors}
                      onClose={() => setOpen(null)}
                      requested={requestedFor(p)}
                      onRespond={async (ok, note) => {
                        if (p.kind === "cd") await director.respondToAttendance(ok ? "approved" : "denied", note);
                        else if (p.kind === "lead") await coverage.respondToCoverage(ok ? "accepted" : "rejected", note);
                        else await crew.respond(p.rowId, ok ? "accepted" : "declined", note);
                        if (ok && p.userId === me) onJoined?.();
                      }}
                      onForward={(id, note) => director.forwardAttendance(id, note)}
                      onRole={async (r) => {
                        if (p.kind === "lead") await coverage.setTechnicianRole(r);
                        else if (p.kind === "crew") await crew.setRole(p.rowId, r);
                      }}
                      onRemove={async () => {
                        if (p.kind === "cd") await director.removeDirector(p.rowId);
                        else if (p.kind === "lead") await coverage.unassignTechnician();
                        else await crew.remove(p.rowId);
                      }}
                    />
                  </UpPopover>
                )}
              </div>
            ))}
            {g.canAdd && (
              <div className="relative">
                <button
                  onClick={() => setAdding(adding === g.id ? null : g.id)}
                  title={g.id === "cd" ? "Ajouter un membre du comité directeur" : g.id === "photo" ? "Ajouter un photographe" : "Ajouter un vidéaste"}
                  aria-label={g.id === "cd" ? "Ajouter un membre du comité directeur" : g.id === "photo" ? "Ajouter un photographe" : "Ajouter un vidéaste"}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-4 hover:bg-hover hover:text-ink"
                >
                  <Plus size={13} />
                </button>
                {adding === g.id && (
                  <UpPopover onClose={() => setAdding(null)}>
                    <AddPicker
                      eventId={eventId}
                      title={g.id === "cd" ? "Membre du comité directeur" : g.id === "photo" ? "Photographe" : "Vidéaste"}
                      candidates={
                        g.id === "cd"
                          ? director.freeDirectors.map((d: DirectorProfile) => ({ id: d.id, name: nameOf(d) }))
                          : technicians.filter((t) => !takenMedia.has(t.id)).map((t) => ({ id: t.id, name: t.name }))
                      }
                      onPick={async (id) => {
                        if (g.id === "cd") {
                          // Un membre du CD qui se greffe : on lui demande ses jours sur un multijour.
                          if ((await director.addDirector(id)) && id === me) onJoined?.();
                        }
                        else {
                          const t = technicians.find((x) => x.id === id);
                          if (t) await addMedia(t, g.id);
                        }
                        setAdding(null);
                      }}
                    />
                  </UpPopover>
                )}
              </div>
            )}
          </div>
        ))}

      {!req && !canManageCrew && role.isOrganizer && (
        <button onClick={() => void coverage.requestCoverage()} className="rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover">
          Demander une couverture
        </button>
      )}
      {req && !leadId && crew.crew.length === 0 && (
        <span className="mt-1 rounded-full px-2 py-1 text-[11px] font-semibold" style={{ background: COVERAGE_COLORS.assigned.bg, color: COVERAGE_COLORS.assigned.ink }}>
          Couverture demandée — à attribuer
        </span>
      )}
    </div>
  );
}

function PillButton({ pill, travel, onClick }: { pill: Pill; travel?: Travel; onClick: () => void }) {
  const c = STATUS_COLOR[pill.status];
  return (
    <button onClick={onClick} title={`${pill.name} — ${STATUS_LABEL[pill.status]}${pill.role ? ` · ${ROLE_LABEL[pill.role]}` : ""}`} className="flex w-10 flex-col items-center gap-0.5">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-extrabold ring-2 ${pill.status === "no" ? "line-through" : ""}`}
        style={{ background: c.bg, color: c.ink, ["--tw-ring-color" as string]: c.ink }}
      >
        {initials(pill.name)}
      </span>
      {travel ? (
        <span className="text-center font-mono text-[9px] leading-tight text-ink-4">
          {Math.round(travel.km)} km
          <br />
          {shortTime(travel.minutes)}
        </span>
      ) : null}
    </button>
  );
}

/** Petite fenêtre qui s'ouvre au-dessus (on est dans la barre du bas) ; clic extérieur ou Échap ferment. */
function UpPopover({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-panel border border-line bg-card p-3 text-left shadow-modal">
      {children}
    </div>
  );
}

function PillDetail({
  eventId,
  pill,
  travel,
  isMe,
  canManage,
  freeDirectors,
  onClose,
  onRespond,
  onForward,
  onRole,
  onRemove,
  requested,
}: {
  requested?: string | null;
  eventId: string;
  pill: Pill;
  travel?: Travel;
  isMe: boolean;
  canManage: boolean;
  freeDirectors: DirectorProfile[];
  onClose: () => void;
  onRespond: (ok: boolean, note?: string) => Promise<void>;
  onForward: (directorId: string, note: string) => Promise<unknown>;
  onRole: (r: CoverageRole) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  // Photo / vidéo : date de remise des fichiers demandée à l'acceptation (réglage des administrateurs).
  const [day, setDay] = useState("");
  const asksDate = isMe && pill.status === "wait" && pill.kind !== "cd";
  const c = STATUS_COLOR[pill.status];
  const what = pill.kind === "cd" ? "Comité directeur" : pill.role ? ROLE_LABEL[pill.role] : "Captation";
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5 text-xs">
      <div>
        <p className="text-sm font-bold text-ink">{pill.name}</p>
        <p className="text-ink-3">
          {what} ·{" "}
          <span className="rounded-full px-1.5 py-0.5 font-semibold" style={{ background: c.bg, color: c.ink }}>
            {STATUS_LABEL[pill.status]}
          </span>
        </p>
        {travel && <p className="mt-1 font-mono text-[11px] text-ink-3">🚗 {Math.round(travel.km)} km · {shortTime(travel.minutes)} (aller)</p>}
        {pill.note && <p className="mt-1 rounded-btn bg-subtle px-2 py-1.5 italic text-ink-2">« {pill.note} »</p>}
        {requested && (
          <p className="mt-1.5 rounded-btn bg-sel-bg px-2 py-1.5 text-navy">
            <span className="font-bold">Présence demandée :</span> {requested}
          </p>
        )}
      </div>

      {asksDate && !declining && <DeliveryDateField eventId={eventId} role={pill.role ?? null} value={day} onChange={setDay} />}
      {isMe && pill.status === "wait" && !declining && (
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => setDeclining(true)} className="flex-1 rounded-btn border border-line py-2 font-semibold text-red disabled:opacity-60">
            Décliner
          </button>
          <button
            disabled={busy || (asksDate && !day)}
            onClick={() =>
              run(async () => {
                await onRespond(true);
                if (asksDate) await saveDeliveryDate(eventId, day);
              })
            }
            className="flex flex-1 items-center justify-center gap-1 rounded-btn bg-red py-2 font-bold text-white shadow-btn-red disabled:opacity-60"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirmer
          </button>
        </div>
      )}
      {isMe && declining &&
        (pill.kind === "cd" ? (
          <DirectorDeclineForm
            directors={freeDirectors}
            selfId={null}
            onDecline={(comment) => run(() => onRespond(false, comment))}
            onForward={(id, comment) => run(() => onForward(id, comment))}
            onCancel={() => setDeclining(false)}
          />
        ) : (
          <div className="space-y-1.5">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Un mot (facultatif)" className="w-full rounded-btn border border-line px-2 py-1.5 outline-none" />
            <div className="flex gap-2">
              <button onClick={() => setDeclining(false)} className="flex-1 rounded-btn border border-line py-1.5 font-semibold text-ink-3">
                Retour
              </button>
              <button disabled={busy} onClick={() => run(() => onRespond(false, note))} className="flex-1 rounded-btn bg-red py-1.5 font-bold text-white disabled:opacity-60">
                Décliner
              </button>
            </div>
          </div>
        ))}

      {canManage && pill.kind !== "cd" && (
        <div className="flex gap-1">
          {(["photo", "video", "both"] as const).map((r) => (
            <button
              key={r}
              disabled={busy}
              onClick={() => run(() => onRole(r))}
              className={`flex-1 rounded-btn px-1.5 py-1 text-[11px] font-semibold ${pill.role === r ? "bg-navy text-white" : "border border-line text-ink-3 hover:bg-hover"}`}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
      )}
      {canManage && (
        <button
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Retirer ${pill.name} de l'événement ?`)) void run(onRemove);
          }}
          className="flex w-full items-center justify-center gap-1 rounded-btn border border-line py-1.5 font-semibold text-ink-3 hover:border-red hover:text-red disabled:opacity-60"
        >
          <X size={12} /> Retirer
        </button>
      )}
    </div>
  );
}

function AddPicker({
  eventId,
  title,
  candidates,
  onPick,
}: {
  eventId: string;
  title: string;
  candidates: { id: string; name: string }[];
  onPick: (id: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const travel = useTravelToEvent(candidates.length ? eventId : null, candidates.map((c) => c.id));
  const needle = q.trim().toLowerCase();
  // Les plus proches d'abord ; sans trajet calculable (adresse manquante) à la fin.
  const list = candidates
    .filter((c) => !needle || c.name.toLowerCase().includes(needle))
    .sort((a, b) => (travel[a.id]?.minutes ?? Infinity) - (travel[b.id]?.minutes ?? Infinity) || a.name.localeCompare(b.name, "fr"));
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Ajouter · {title}</p>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="mb-1.5 w-full rounded-btn border border-line px-2 py-1.5 text-[13px] outline-none" />
      <div className="max-h-60 overflow-y-auto">
        {list.length === 0 && <p className="px-1 py-2 text-xs text-ink-4">Personne à proposer.</p>}
        {list.map((c) => (
          <button
            key={c.id}
            disabled={!!busy}
            onClick={async () => {
              setBusy(c.id);
              try {
                await onPick(c.id);
              } finally {
                setBusy(null);
              }
            }}
            className="flex w-full items-center gap-2 rounded-btn px-1.5 py-1.5 text-left hover:bg-hover disabled:opacity-60"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-subtle text-[10px] font-bold text-ink-3">{initials(c.name)}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{c.name}</span>
            {busy === c.id ? (
              <Loader2 size={12} className="animate-spin text-ink-4" />
            ) : (
              travel[c.id] && <span className="shrink-0 font-mono text-[10px] text-ink-4">{Math.round(travel[c.id].km)} km · {shortTime(travel[c.id].minutes)}</span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-ink-4">La personne est prévenue et confirme elle-même (pastille orange jusqu&rsquo;à sa réponse).</p>
    </div>
  );
}
