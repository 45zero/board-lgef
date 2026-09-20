"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  UserPlus,
  Navigation,
  Video,
  MessageSquare,
  Crown,
  X,
  Bell,
  ChevronDown,
  Check,
  Paperclip,
  Image as ImageIcon,
  Download,
  Trash2,
  Upload,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { COVERAGE_COLORS } from "@/lib/board/tokens";
import { useEventTeam } from "@/hooks/board/useEventTeam";
import { useEventComments } from "@/hooks/board/useEventComments";
import { useEventExpenses } from "@/hooks/board/useEventExpenses";
import { useEventFiles } from "@/hooks/board/useEventFiles";
import { createEventFileUrl, type EventFile } from "@/lib/board/eventFiles";
import { REMINDER_PRESETS } from "@/hooks/board/useEventModalState";
import type { useUserRole } from "@/hooks/board/useUserRole";
import type { useAvailableTechnicians } from "@/hooks/board/useAvailableTechnicians";
import { type useEventCoverage, type CoverageRequest } from "@/hooks/board/useEventCoverage";
import type { useDirectorAttendance } from "@/hooks/board/useDirectorAttendance";

export function personName(
  p: { first_name: string | null; last_name: string | null; email: string | null } | null
) {
  if (!p) return "—";
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name || p.email || "—";
}

export function personInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_PALETTE = [
  { bg: "#0B1D3C", ink: "#FFFFFF" },
  { bg: "#0F766E", ink: "#FFFFFF" },
  { bg: "#B91C1C", ink: "#FFFFFF" },
  { bg: "#7A3FD9", ink: "#FFFFFF" },
  { bg: "#B45309", ink: "#FFFFFF" },
  { bg: "#334155", ink: "#FFFFFF" },
];

function avatarColorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export interface ParticipantChip {
  id: string;
  name: string;
  role: "responsable" | "membre";
}

/** Un participant : avatar coloré + initiales, couronne si responsable. */
function ParticipantAvatar({ p }: { p: ParticipantChip }) {
  const color = avatarColorFor(p.id);
  return (
    <span
      className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
      style={{ background: color.bg, color: color.ink }}
      title={p.name}
    >
      {personInitials(p.name)}
      {p.role === "responsable" && (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-card ring-1 ring-line">
          <Crown size={9} className="text-amber" />
        </span>
      )}
    </span>
  );
}

/**
 * Bloc "Participants" façon capture (avatars + recherche), branché soit sur
 * useEventTeam (édition, event_team_members réel), soit sur une liste locale
 * (création, event pas encore créé — cf. pendingParticipants de useEventModalState).
 */
export function ParticipantsField({
  members,
  canManage,
  onAdd,
  onRemove,
  onSetResponsable,
}: {
  members: ParticipantChip[];
  canManage: boolean;
  onAdd: (profile: ProfileOption) => void;
  onRemove: (member: ParticipantChip) => void;
  onSetResponsable: (member: ParticipantChip) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProfileOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id, first_name, last_name, email")
      .order("first_name")
      .limit(200)
      .then(({ data }) => setOptions((data as ProfileOption[] | null) ?? []));
  }, [canManage]);

  const memberIds = new Set(members.map((m) => m.id));
  const filtered = query.trim()
    ? options.filter((o) => !memberIds.has(o.id) && personName(o).toLowerCase().includes(query.toLowerCase()))
    : [];

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line px-3 py-2">
        {members.map((m) => (
          <span key={m.id} className="group relative flex items-center gap-1.5 rounded-full bg-subtle py-1 pl-1 pr-2">
            <button
              type="button"
              onClick={() => canManage && onSetResponsable(m)}
              disabled={!canManage}
              title={m.role === "responsable" ? "Responsable" : "Définir comme responsable"}
              className="disabled:cursor-default"
            >
              <ParticipantAvatar p={m} />
            </button>
            <span className="text-xs text-ink-2">{m.name}</span>
            {canManage && (
              <button
                type="button"
                onClick={() => onRemove(m)}
                className="text-ink-4 hover:text-red"
                aria-label={`Retirer ${m.name}`}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}

        {canManage && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Ajouter des participants…"
            className="min-w-[140px] flex-1 text-sm outline-none"
          />
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 top-full z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-btn border border-line bg-card p-1 shadow-card">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onAdd(p);
                setQuery("");
                setOpen(false);
              }}
              className="block w-full rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover"
            >
              {personName(p)}
            </button>
          ))}
          {filtered.length === 0 && <div className="px-2 py-1.5 text-xs text-ink-4">Aucun résultat.</div>}
        </div>
      )}
    </div>
  );
}

/** Sélecteur de rappels compact (pill + menu multi-select) — même liste de préréglages pour la création et l'édition. */
export function RemindersField({
  offsets,
  onAdd,
  onRemove,
}: {
  offsets: string[];
  onAdd: (offset: string) => void;
  onRemove: (offset: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    offsets.length === 0
      ? "Rappel"
      : offsets.length === 1
        ? `Rappel · ${REMINDER_PRESETS.find((p) => p.value === offsets[0])?.label ?? offsets[0]}`
        : `Rappels (${offsets.length})`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2 outline-none hover:bg-hover"
      >
        <span className="flex items-center gap-1.5 truncate">
          <Bell size={13} className="shrink-0 text-ink-4" />
          {label}
        </span>
        <ChevronDown size={12} className="shrink-0 text-ink-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-btn border border-line bg-card p-1 shadow-card">
          {REMINDER_PRESETS.map((p) => {
            const active = offsets.includes(p.value);
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => (active ? onRemove(p.value) : onAdd(p.value))}
                className={`flex w-full items-center justify-between rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover ${
                  active ? "font-semibold text-ink" : "text-ink-2"
                }`}
              >
                {p.label}
                {active && <Check size={13} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DiscussionTab({ hook }: { hook: ReturnType<typeof useEventComments> }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {hook.comments.length === 0 && <p className="text-sm text-ink-4">Aucun message pour l&rsquo;instant.</p>}
        {hook.comments.map((c) => (
          <div key={c.id} className="rounded-btn bg-subtle px-3 py-2">
            <div className="text-xs font-semibold text-ink-2">{personName(c.author)}</div>
            <div className="text-sm text-ink">{c.body}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && value.trim()) {
              await hook.postComment(value);
              setValue("");
            }
          }}
          placeholder="Écrire un message…"
          className="flex-1 rounded-btn border border-line px-3 py-2 text-sm outline-none"
        />
        <button
          onClick={async () => {
            if (value.trim()) {
              await hook.postComment(value);
              setValue("");
            }
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-navy text-white"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

interface ProfileOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export function EquipeTab({ hook }: { hook: ReturnType<typeof useEventTeam> }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProfileOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!pickerOpen) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id, first_name, last_name, email")
      .order("first_name")
      .limit(200)
      .then(({ data }) => setOptions((data as ProfileOption[] | null) ?? []));
  }, [pickerOpen]);

  const filtered = options.filter((o) => personName(o).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-3">
      {hook.team.map((m) => (
        <div key={m.id} className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
          <div className="text-sm text-ink-2">
            {personName(m.profiles)}
            {m.role === "responsable" && <span className="ml-1 text-xs text-ink-4">(responsable)</span>}
          </div>
          {hook.canManageMembers && (
            <button onClick={() => hook.removeMember(m)} className="text-xs font-semibold text-red hover:underline">
              Retirer
            </button>
          )}
        </div>
      ))}

      {hook.canManageMembers && (
        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-btn border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-hover"
          >
            <UserPlus size={13} /> Ajouter
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded-btn border border-line bg-card p-2 shadow-card">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher…"
                className="mb-2 w-full rounded-btn border border-line px-2 py-1.5 text-sm outline-none"
              />
              <div className="max-h-56 overflow-y-auto">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={async () => {
                      await hook.addMember(p.id, "membre");
                      setPickerOpen(false);
                      setQuery("");
                    }}
                    className="block w-full rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover"
                  >
                    {personName(p)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FraisTab({ hook }: { hook: ReturnType<typeof useEventExpenses> }) {
  const [toll, setToll] = useState(0);
  const [meal, setMeal] = useState(0);
  const [other, setOther] = useState(0);
  const [otherDesc, setOtherDesc] = useState("");

  const total = hook.expenses.reduce((sum, e) => sum + (e.total_amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="text-lg font-extrabold text-ink">{total.toFixed(2)} €</div>

      {hook.expenses.map((e) => (
        <div key={e.id} className="flex items-center justify-between rounded-btn border border-line px-3 py-2 text-sm">
          <span>
            Péage {e.toll_fees ?? 0} € · Repas {e.meal_fees ?? 0} € · Autres {e.other_fees ?? 0} €
            {e.other_fees_description ? ` (${e.other_fees_description})` : ""}
          </span>
          <button onClick={() => hook.deleteExpense(e.id)} className="text-xs font-semibold text-red hover:underline">
            Supprimer
          </button>
        </div>
      ))}

      <div className="space-y-2 rounded-panel border border-line p-3">
        <div className="grid grid-cols-3 gap-2">
          <input type="number" min={0} step={0.01} value={toll || ""} onChange={(e) => setToll(parseFloat(e.target.value) || 0)} placeholder="Péage €" className="rounded-btn border border-line px-2 py-1.5 text-sm" />
          <input type="number" min={0} step={0.01} value={meal || ""} onChange={(e) => setMeal(parseFloat(e.target.value) || 0)} placeholder="Repas €" className="rounded-btn border border-line px-2 py-1.5 text-sm" />
          <input type="number" min={0} step={0.01} value={other || ""} onChange={(e) => setOther(parseFloat(e.target.value) || 0)} placeholder="Autres €" className="rounded-btn border border-line px-2 py-1.5 text-sm" />
        </div>
        {other > 0 && (
          <input value={otherDesc} onChange={(e) => setOtherDesc(e.target.value)} placeholder="Description des autres frais" className="w-full rounded-btn border border-line px-2 py-1.5 text-sm" />
        )}
        <button
          onClick={async () => {
            const ok = await hook.createExpense({ toll_fees: toll, meal_fees: meal, other_fees: other, other_fees_description: otherDesc || null });
            if (ok) {
              setToll(0);
              setMeal(0);
              setOther(0);
              setOtherDesc("");
            }
          }}
          disabled={toll === 0 && meal === 0 && other === 0}
          className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          Ajouter la ligne de frais
        </button>
      </div>
    </div>
  );
}

export function GestionFraisPlaceholder() {
  return (
    <div className="rounded-panel border border-dashed border-line bg-card/60 p-6 text-sm text-ink-3">
      La validation des notes de frais par un administrateur n&rsquo;est pas encore construite dans Board
      LGEF — elle nécessite de porter <code>useAdminExpenseReports</code> et{" "}
      <code>useExpenseSubmissions</code> de calendrier-lgef. À venir dans une prochaine passe.
    </div>
  );
}

export function CarteTab({ location }: { location: string }) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
  return (
    <div className="space-y-3">
      <div className="flex h-[240px] items-center justify-center rounded-panel border border-dashed border-line bg-subtle text-sm text-ink-4">
        Emplacement réservé pour la vue cartographique (à fournir par le client — voir handoff §3)
      </div>
      <div className="text-sm text-ink-2">{location || "Aucune adresse renseignée."}</div>
      {location && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-hover"
        >
          <Navigation size={13} /> Itinéraire
        </a>
      )}
    </div>
  );
}

/** "Demander une couverture" / "Assigner" / "Désigner directement" — pied du modal (§5.5 du handoff). */
export function CoverageActions({
  role,
  technicians,
  coverage,
  eventInfo,
}: {
  role: ReturnType<typeof useUserRole>;
  technicians: ReturnType<typeof useAvailableTechnicians>["technicians"];
  coverage: ReturnType<typeof useEventCoverage>;
  eventInfo: { title: string; start: Date };
}) {
  const { user } = useAuth();
  const [mode, setMode] = useState<"assign" | "direct" | null>(null);
  const [responseOpen, setResponseOpen] = useState(false);
  const req = coverage.request;
  const isAssignedTech = !!user && !!req && req.assigned_technician_id === user.id;

  const statusColor =
    req?.technician_response === "accepted"
      ? COVERAGE_COLORS.photo
      : req?.technician_response === "rejected"
        ? COVERAGE_COLORS.no
        : COVERAGE_COLORS.wait;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {req?.assigned_technician_name && (
        <button
          onClick={() => setResponseOpen(true)}
          className="flex items-center gap-1 rounded-full px-2 py-1 font-semibold"
          style={{ background: statusColor.bg, color: statusColor.ink }}
          title={
            req.technician_response === "accepted"
              ? "Accepté"
              : req.technician_response === "rejected"
                ? "Refusé"
                : "En attente de réponse"
          }
        >
          <Video size={12} /> {req.assigned_technician_name}
          {req.technician_response_notes && <MessageSquare size={11} />}
        </button>
      )}

      {!req && role.isOrganizer && (
        <button
          onClick={() => coverage.requestCoverage()}
          className="rounded-btn border border-line px-3 py-2 font-semibold text-ink-2 hover:bg-hover"
        >
          Demander une couverture
        </button>
      )}

      {role.isSuperUser && (
        <>
          <button
            onClick={() => setMode("assign")}
            className="rounded-btn border border-line px-3 py-2 font-semibold text-ink-2 hover:bg-hover"
          >
            Assigner
          </button>
          <button
            onClick={() => setMode("direct")}
            className="rounded-btn border border-line px-3 py-2 font-semibold text-ink-2 hover:bg-hover"
          >
            Désigner directement
          </button>
        </>
      )}

      {mode && (
        <TechnicianPickerModal
          mode={mode}
          technicians={technicians}
          onClose={() => setMode(null)}
          onSelect={async (t) => {
            if (mode === "direct") await coverage.assignTechnician(t);
            else await coverage.assignPending(t, eventInfo);
            setMode(null);
          }}
        />
      )}

      {responseOpen && req && (
        <TechnicianResponseModal
          request={req}
          canRespond={isAssignedTech && req.technician_response === "pending"}
          onClose={() => setResponseOpen(false)}
          onRespond={async (response, notes) => {
            await coverage.respondToCoverage(response, notes);
            setResponseOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Réponse du technicien assigné (accepter/refuser + commentaire) — même logique
 * que le flux d'acceptation de calendrier-lgef — ou, pour tout autre spectateur,
 * simple consultation du statut et du message laissé. */
function TechnicianResponseModal({
  request,
  canRespond,
  onClose,
  onRespond,
}: {
  request: CoverageRequest;
  canRespond: boolean;
  onClose: () => void;
  onRespond: (response: "accepted" | "rejected", notes?: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (response: "accepted" | "rejected") => {
    setSubmitting(true);
    try {
      await onRespond(response, notes);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-modal border border-line bg-card p-4 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">
            {canRespond ? "Mission de couverture média" : "Réponse du technicien"}
          </h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            ✕
          </button>
        </div>

        {canRespond ? (
          <>
            <p className="mb-3 text-xs text-ink-3">
              On vous a désigné(e) pour couvrir cet événement. Acceptez-vous la mission ?
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Commentaire (optionnel)"
              rows={3}
              className="mb-3 w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => submit("rejected")}
                disabled={submitting}
                className="rounded-btn border border-line px-3 py-2 text-sm font-semibold text-red disabled:opacity-60"
              >
                Refuser
              </button>
              <button
                onClick={() => submit("accepted")}
                disabled={submitting}
                className="rounded-btn bg-red px-3 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
              >
                Accepter
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-2 text-sm text-ink-2">
            <p>
              Statut :{" "}
              <strong>
                {request.technician_response === "accepted"
                  ? "Accepté"
                  : request.technician_response === "rejected"
                    ? "Refusé"
                    : "En attente de réponse"}
              </strong>
            </p>
            {request.technician_response_notes ? (
              <div className="rounded-btn bg-subtle px-3 py-2 text-ink-2">{request.technician_response_notes}</div>
            ) : (
              <p className="text-xs italic text-ink-4">Aucun message laissé.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Modal de recherche pour assigner un technicien — même logique que DirectAssignModal.tsx / TechnicianAssignmentModal.tsx de calendrier-lgef, sans le volet WhatsApp/contacts externes (pas d'infrastructure équivalente ici). */
function TechnicianPickerModal({
  mode,
  technicians,
  onClose,
  onSelect,
}: {
  mode: "assign" | "direct";
  technicians: ReturnType<typeof useAvailableTechnicians>["technicians"];
  onClose: () => void;
  onSelect: (t: ReturnType<typeof useAvailableTechnicians>["technicians"][number]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = technicians.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-modal border border-line bg-card p-4 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">{mode === "direct" ? "Désigner directement" : "Assigner un technicien"}</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-3">
          {mode === "direct"
            ? "La mission est validée immédiatement, sans attendre de réponse du technicien."
            : "Le technicien reçoit une notification et doit accepter ou refuser la mission."}
        </p>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
          className="mb-2 w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
        />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {filtered.length === 0 && <div className="px-2 py-2 text-xs text-ink-4">Aucun résultat.</div>}
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className="block w-full rounded-btn px-2 py-2 text-left text-sm hover:bg-hover"
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Sélection + statut du comité directeur — remplace le <select> dupliqué entre EventModal et MobileEventModal. */
export function DirectorAttendanceSection({
  director,
  eventId,
}: {
  director: ReturnType<typeof useDirectorAttendance>;
  eventId: string;
}) {
  const { user } = useAuth();
  const [responseOpen, setResponseOpen] = useState(false);
  const att = director.attendance;
  const isAssignedDirector = !!user && !!att && att.director_id === user.id;

  const statusColor =
    att?.status === "approved" ? COVERAGE_COLORS.photo : att?.status === "denied" ? COVERAGE_COLORS.no : COVERAGE_COLORS.wait;
  const statusLabel = att?.status === "approved" ? "Confirmé" : att?.status === "denied" ? "Décliné" : "En attente";
  const assignedProfile = director.directors.find((d) => d.id === att?.director_id) ?? null;

  return (
    <div className="space-y-2">
      <select
        value={att?.director_id ?? ""}
        onChange={async (e) => {
          const id = e.target.value || null;
          if (!id) await director.deleteAttendance();
          else await director.saveAttendance(eventId, { director_id: id, status: "pending" });
        }}
        className="w-full rounded-btn border border-line px-2 py-1.5 text-xs"
      >
        <option value="">Aucun membre désigné</option>
        {director.directors.map((d) => (
          <option key={d.id} value={d.id}>
            {personName(d)}
          </option>
        ))}
      </select>

      {att?.director_id && (
        <button
          onClick={() => setResponseOpen(true)}
          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold"
          style={{ background: statusColor.bg, color: statusColor.ink }}
        >
          {personName(assignedProfile)} — {statusLabel}
        </button>
      )}

      {responseOpen && att && (
        <DirectorResponseModal
          canRespond={isAssignedDirector && att.status === "pending"}
          status={att.status}
          onClose={() => setResponseOpen(false)}
          onRespond={async (r) => {
            await director.respondToAttendance(r);
            setResponseOpen(false);
          }}
        />
      )}
    </div>
  );
}

function DirectorResponseModal({
  canRespond,
  status,
  onClose,
  onRespond,
}: {
  canRespond: boolean;
  status: string | null;
  onClose: () => void;
  onRespond: (response: "approved" | "denied") => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const submit = async (r: "approved" | "denied") => {
    setSubmitting(true);
    try {
      await onRespond(r);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-modal border border-line bg-card p-4 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">Comité directeur</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            ✕
          </button>
        </div>
        {canRespond ? (
          <>
            <p className="mb-3 text-xs text-ink-3">Confirmez-vous votre présence à cet événement ?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => submit("denied")}
                disabled={submitting}
                className="rounded-btn border border-line px-3 py-2 text-sm font-semibold text-red disabled:opacity-60"
              >
                Décliner
              </button>
              <button
                onClick={() => submit("approved")}
                disabled={submitting}
                className="rounded-btn bg-red px-3 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
              >
                Confirmer
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-2">
            Statut :{" "}
            <strong>{status === "approved" ? "Confirmé" : status === "denied" ? "Décliné" : "En attente de réponse"}</strong>
          </p>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const FACEBOOK_REGIONS: { key: "lorraine" | "champagne_ardenne" | "alsace"; label: string }[] = [
  { key: "lorraine", label: "Lorraine" },
  { key: "champagne_ardenne", label: "Champagne-Ardenne" },
  { key: "alsace", label: "Alsace" },
];

/** lucide-react n'expose plus les logos de marque — badges texte colorés à la place. */
function YoutubeBadge({ size = 14 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[3px] bg-red font-black text-white"
      style={{ width: size, height: size * 0.7, fontSize: size * 0.5 }}
    >
      YT
    </span>
  );
}

function FacebookBadge({ size = 14 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-link font-black text-white"
      style={{ width: size, height: size, fontSize: size * 0.7 }}
    >
      f
    </span>
  );
}

function PublishPanel({
  file,
  eventTitle,
  publishing,
  onClose,
  onPublishYoutube,
  onPublishFacebook,
}: {
  file: EventFile;
  eventTitle: string;
  publishing: boolean;
  onClose: () => void;
  onPublishYoutube: (data: { title: string; description?: string }) => Promise<unknown>;
  onPublishFacebook: (
    selection: Partial<Record<"lorraine" | "champagne_ardenne" | "alsace", { enabled: boolean; message: string }>>
  ) => Promise<unknown>;
}) {
  const [ytTitle, setYtTitle] = useState(eventTitle);
  const [ytDescription, setYtDescription] = useState("");
  const [fbSelection, setFbSelection] = useState<
    Record<"lorraine" | "champagne_ardenne" | "alsace", { enabled: boolean; message: string }>
  >({
    lorraine: { enabled: false, message: eventTitle },
    champagne_ardenne: { enabled: false, message: eventTitle },
    alsace: { enabled: false, message: eventTitle },
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-4 rounded-modal border border-line bg-card p-4 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">Publier « {file.filename} »</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-ink-3">
          Cette action publie réellement la vidéo sur le réseau choisi — visible publiquement, action non réversible.
        </p>

        <div className="space-y-2 rounded-btn border border-line p-3">
          <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <YoutubeBadge size={16} /> YouTube
          </div>
          <input
            value={ytTitle}
            onChange={(e) => setYtTitle(e.target.value)}
            placeholder="Titre de la vidéo"
            className="w-full rounded-btn border border-line px-2.5 py-1.5 text-sm outline-none"
          />
          <textarea
            value={ytDescription}
            onChange={(e) => setYtDescription(e.target.value)}
            rows={2}
            placeholder="Description (optionnel)"
            className="w-full rounded-btn border border-line px-2.5 py-1.5 text-sm outline-none"
          />
          <button
            type="button"
            disabled={publishing || !ytTitle.trim()}
            onClick={() => {
              if (!confirm(`Publier « ${ytTitle} » sur YouTube ? Cette vidéo deviendra publique.`)) return;
              onPublishYoutube({ title: ytTitle.trim(), description: ytDescription.trim() || undefined });
            }}
            className="w-full rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {publishing ? "Publication…" : "Publier sur YouTube"}
          </button>
        </div>

        <div className="space-y-2 rounded-btn border border-line p-3">
          <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <FacebookBadge size={14} /> Facebook
          </div>
          {FACEBOOK_REGIONS.map((r) => (
            <div key={r.key} className="space-y-1">
              <label className="flex items-center gap-2 text-xs font-semibold text-ink-2">
                <input
                  type="checkbox"
                  checked={fbSelection[r.key].enabled}
                  onChange={(e) =>
                    setFbSelection((prev) => ({ ...prev, [r.key]: { ...prev[r.key], enabled: e.target.checked } }))
                  }
                />
                {r.label}
              </label>
              {fbSelection[r.key].enabled && (
                <textarea
                  value={fbSelection[r.key].message}
                  onChange={(e) =>
                    setFbSelection((prev) => ({ ...prev, [r.key]: { ...prev[r.key], message: e.target.value } }))
                  }
                  rows={2}
                  placeholder={`Message pour la page ${r.label}`}
                  className="w-full rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none"
                />
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={publishing || !Object.values(fbSelection).some((s) => s.enabled && s.message.trim())}
            onClick={() => {
              const pages = Object.values(fbSelection).filter((s) => s.enabled).length;
              if (!confirm(`Publier sur ${pages} page(s) Facebook ? Ce post sera public.`)) return;
              onPublishFacebook(fbSelection);
            }}
            className="w-full rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {publishing ? "Publication…" : "Publier sur Facebook"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PublishBadges({ file }: { file: EventFile }) {
  const yt = file.publish_info?.youtube;
  const fb = file.publish_info?.facebook;
  const fbEntries = FACEBOOK_REGIONS.map((r) => ({ ...r, info: fb?.[r.key] })).filter((e) => e.info?.published);
  if (!yt?.published && fbEntries.length === 0) return null;

  const byName = (by?: { first_name: string | null; last_name: string | null } | null) =>
    [by?.first_name, by?.last_name].filter(Boolean).join(" ") || "—";

  return (
    <div className="mt-1 space-y-0.5">
      {yt?.published && (
        <a
          href={yt.videoId ? `https://www.youtube.com/watch?v=${yt.videoId}` : undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-[11px] font-semibold text-red hover:underline"
        >
          <YoutubeBadge size={13} /> YouTube · {byName(yt.by)} · {new Date(yt.at ?? "").toLocaleDateString("fr-FR")}
        </a>
      )}
      {fbEntries.map((e) => (
        <div key={e.key} className="flex items-center gap-1.5 text-[11px] font-semibold text-link">
          <FacebookBadge size={11} /> Facebook · {e.label} · {byName(e.info!.by)} ·{" "}
          {new Date(e.info!.at ?? "").toLocaleDateString("fr-FR")}
        </div>
      ))}
    </div>
  );
}

function AttachmentRow({
  file,
  canManage,
  canPublish,
  onRemove,
  onPublishClick,
}: {
  file: EventFile;
  canManage: boolean;
  canPublish: boolean;
  onRemove: () => void;
  onPublishClick: () => void;
}) {
  const isVideo = (file.content_type ?? "").startsWith("video");
  const isImage = (file.content_type ?? "").startsWith("image");
  const uploader = personName(file.uploaded_by_profile);

  const open = async (download: boolean) => {
    const url = await createEventFileUrl(file.path, download ? file.filename : undefined);
    if (url) window.open(url, "_blank", "noreferrer");
  };

  return (
    <div className="rounded-btn border border-line px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => open(false)} className="flex min-w-0 items-start gap-2 text-left">
          {isVideo ? (
            <Video size={15} className="mt-0.5 shrink-0 text-ink-4" />
          ) : isImage ? (
            <ImageIcon size={15} className="mt-0.5 shrink-0 text-ink-4" />
          ) : (
            <Paperclip size={15} className="mt-0.5 shrink-0 text-ink-4" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{file.filename}</span>
            <span className="block text-[11px] text-ink-4">
              {formatFileSize(file.size_bytes)} · {uploader} ·{" "}
              {new Date(file.created_at).toLocaleDateString("fr-FR")}
            </span>
            <PublishBadges file={file} />
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {isVideo && canPublish && (
            <button type="button" onClick={onPublishClick} className="text-ink-4 hover:text-navy" title="Publier">
              <Upload size={13} />
            </button>
          )}
          <button type="button" onClick={() => open(true)} className="text-ink-4 hover:text-ink" title="Télécharger">
            <Download size={13} />
          </button>
          {canManage && (
            <button type="button" onClick={onRemove} className="text-ink-4 hover:text-red" title="Supprimer">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pièces jointes (photo/vidéo) + publication YouTube/Facebook — disponible après création de l'événement. */
export function AttachmentsField({
  eventId,
  eventTitle,
  canManage,
  canPublish,
}: {
  eventId: string;
  eventTitle: string;
  canManage: boolean;
  canPublish: boolean;
}) {
  const hook = useEventFiles(eventId, canManage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [publishingFileId, setPublishingFileId] = useState<string | null>(null);
  const publishingFile = hook.files.find((f) => f.id === publishingFileId) ?? null;

  return (
    <div className="space-y-2">
      {hook.files.length === 0 && !hook.loading && (
        <p className="text-xs italic text-ink-4">Aucune pièce jointe pour l&rsquo;instant.</p>
      )}
      {hook.files.map((f) => (
        <AttachmentRow
          key={f.id}
          file={f}
          canManage={canManage}
          canPublish={canPublish}
          onRemove={() => hook.removeFile(f)}
          onPublishClick={() => setPublishingFileId(f.id)}
        />
      ))}

      {canManage && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={async (e) => {
              if (e.target.files?.length) {
                const res = await hook.addFiles(e.target.files);
                if (res.failed.length) alert(`Échec pour : ${res.failed.join(", ")}`);
              }
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={hook.uploading}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-btn border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-hover disabled:opacity-50"
          >
            <Paperclip size={13} /> {hook.uploading ? "Envoi…" : "Ajouter une pièce jointe (photo, vidéo)"}
          </button>
        </>
      )}

      {publishingFile && (
        <PublishPanel
          file={publishingFile}
          eventTitle={eventTitle}
          publishing={hook.publishing === publishingFile.id}
          onClose={() => setPublishingFileId(null)}
          onPublishYoutube={(data) => hook.publishYoutube(publishingFile, data)}
          onPublishFacebook={(sel) => hook.publishFacebook(publishingFile, sel)}
        />
      )}
    </div>
  );
}
