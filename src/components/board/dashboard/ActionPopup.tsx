"use client";

import { useOpenTeamCard } from "@/components/board/team/TeamCardOpener";
import { MapPopup } from "@/components/board/calendar/MapPopup";
import { useEffect, useState } from "react";
import { X, Check, ChevronRight, CalendarDays, MapPin, Map as MapIcon } from "lucide-react";
import { StaffEventsMap, useTravelToEvent } from "@/components/board/calendar/StaffEventsMap";
import { EVENT_TYPE_TO_ORG } from "@/lib/board/calendar";
import { formatTravel } from "@/lib/board/geo";
import type { DashboardAction, DashboardActionItem } from "@/app/actions/dashboard";
import {
  declareExpenses,
  getMyExpenses,
  getSubmissionsToReview,
  reviewSubmission,
  type MyExpenseItem,
  type SubmissionToReview,
} from "@/app/actions/expenses";
import { ExpenseSheetModal, ReviewModal } from "@/components/board/screens/FraisScreen";
import { confirmNoExpense, formatEuros } from "@/components/board/expenses/ExpenseStatus";
import { EventArrow, useOpenEvent } from "@/components/board/calendar/EventOpener";
import { useEventCoverage } from "@/hooks/board/useEventCoverage";
import { useAvailableTechnicians, type TechnicianOption } from "@/hooks/board/useAvailableTechnicians";
import { useDirectorAttendance } from "@/hooks/board/useDirectorAttendance";

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) +
      " · " +
      new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "";

const APP_LABELS: Record<string, string> = {
  frais: "Frais",
  calendrier: "le calendrier",
  audiovisuel: "le centre de publication",
  inscription: "Inscription",
  trello: "l'Espace Team",
};

/** Date et lieu d'un événement, avec un léger bouton « Carte » qui ouvre la carte dans une fenêtre. */
function WhenWhere({ date, location, title }: { date: string | null; location?: string | null; title?: string }) {
  const [mapOpen, setMapOpen] = useState(false);
  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-3">
      {date && (
        <span className="flex items-center gap-1">
          <CalendarDays size={11} className="text-ink-4" /> {fmt(date)}
        </span>
      )}
      {location && (
        <span className="flex min-w-0 items-center gap-1">
          <MapPin size={11} className="shrink-0 text-ink-4" />
          <span className="truncate">{location}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMapOpen(true);
            }}
            className="shrink-0 rounded-full border border-line px-1.5 py-px text-[10px] font-semibold text-link hover:border-link hover:bg-sel-bg"
          >
            Carte
          </button>
        </span>
      )}
      {mapOpen && location && <MapPopup location={location} title={title} onClose={() => setMapOpen(false)} />}
    </div>
  );
}

function Row({
  title,
  subtitle,
  eventId,
  date,
  location,
  children,
}: {
  title: string;
  subtitle?: string;
  eventId?: string | null;
  /** Date + lieu (avec bouton Carte) sur une ligne dédiée. */
  date?: string | null;
  location?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold text-ink">{title}</span>
          {eventId && <EventArrow eventId={eventId} className="h-6 w-6" />}
        </div>
        {(date !== undefined || location) && <WhenWhere date={date ?? null} location={location} title={title} />}
        {subtitle && <div className="truncate text-[11px] text-ink-4">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const btnOk = "flex items-center gap-1 rounded-btn bg-good px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50";
const btnKo = "rounded-btn border border-bad px-3 py-1.5 text-xs font-bold text-bad disabled:opacity-50";
const btnGhost = "flex items-center gap-1 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover disabled:opacity-50";

/* ---------- Frais à valider (N+1) ---------- */

function ValidateRow({ sub, onDone, onDetails }: { sub: SubmissionToReview; onDone: () => void; onDetails: () => void }) {
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    const res = await reviewSubmission(sub.submissionId, decision, reason);
    setBusy(false);
    if (res.error) return setError(res.error);
    onDone();
  };
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onDetails} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-ink">
              {sub.person.name} · {formatEuros(sub.total)}
            </span>
            {sub.event.id && <EventArrow eventId={sub.event.id} className="h-6 w-6" />}
          </div>
          <div className="truncate text-[11px] text-ink-4">
            {sub.event.title} · {fmt(sub.event.start)} — voir le détail
          </div>
        </button>
        {!refusing && (
          <>
            <button disabled={busy} onClick={() => setRefusing(true)} className={btnKo}>
              Refuser
            </button>
            <button disabled={busy} onClick={() => decide("approved")} className={btnOk}>
              <Check size={12} /> Valider
            </button>
          </>
        )}
      </div>
      {refusing && (
        <div className="mt-2 flex gap-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motif du refus…"
            className="min-w-0 flex-1 rounded-btn border border-line px-2.5 py-1.5 text-sm outline-none"
          />
          <button onClick={() => setRefusing(false)} className={btnGhost}>
            Annuler
          </button>
          <button disabled={busy || !reason.trim()} onClick={() => decide("rejected")} className={btnKo}>
            Confirmer le refus
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

function ValidateList({ onChanged }: { onChanged: () => void }) {
  const [subs, setSubs] = useState<SubmissionToReview[] | null>(null);
  const [details, setDetails] = useState<SubmissionToReview | null>(null);
  useEffect(() => {
    getSubmissionsToReview("pending", "mine")
      .then(setSubs)
      .catch(() => setSubs([]));
  }, []);
  if (!subs) return <p className="p-4 text-sm text-ink-4">Chargement…</p>;
  if (subs.length === 0) return <p className="p-4 text-sm text-ink-3">Tout est validé. 👍</p>;
  const remove = (id: string) => {
    setSubs((prev) => prev?.filter((x) => x.submissionId !== id) ?? null);
    onChanged();
  };
  return (
    <>
      {subs.map((s) => (
        <ValidateRow key={s.submissionId} sub={s} onDetails={() => setDetails(s)} onDone={() => remove(s.submissionId)} />
      ))}
      {details && (
        <ReviewModal
          sub={details}
          onClose={() => setDetails(null)}
          onDone={() => {
            remove(details.submissionId);
            setDetails(null);
          }}
        />
      )}
    </>
  );
}

/* ---------- Mes frais à déclarer / refusés ---------- */

function DeclareList({ statuses, onChanged }: { statuses: MyExpenseItem["status"][]; onChanged: () => void }) {
  const [items, setItems] = useState<MyExpenseItem[] | null>(null);
  const [open, setOpen] = useState<MyExpenseItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    getMyExpenses()
      .then((all) => setItems(all.filter((i) => statuses.includes(i.status) && !i.upcoming)))
      .catch(() => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  if (!items) return <p className="p-4 text-sm text-ink-4">Chargement…</p>;
  if (items.length === 0) return <p className="p-4 text-sm text-ink-3">Rien à déclarer. 👍</p>;
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  return (
    <>
      {items.map((i) => (
        <Row
          key={i.key}
          title={i.title}
          eventId={i.eventId}
          subtitle={`${i.eventId ? `${fmt(i.start)} · ${i.roles.join(", ")}` : "Hors événement"}${i.lineCount ? ` · ${formatEuros(i.total)}` : ""}${
            i.reviewerComment ? ` · Motif : ${i.reviewerComment}` : ""
          }`}
        >
          {i.eventId && (i.status === "rejected" || i.lineCount === 0) && (
            <button
              disabled={busy === i.key}
              onClick={async () => {
                if (!confirmNoExpense(i.lineCount)) return;
                setBusy(i.key);
                const res = await declareExpenses({ eventId: i.eventId! }, true);
                setBusy(null);
                if (res.error) return alert(res.error);
                refresh();
              }}
              className={btnGhost}
            >
              Pas de frais
            </button>
          )}
          <button onClick={() => setOpen(i)} className="rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white shadow-btn-red">
            {i.status === "rejected" ? "Corriger" : "Déclarer"}
          </button>
        </Row>
      ))}
      {open && (
        <ExpenseSheetModal
          item={open}
          onClose={() => {
            setOpen(null);
            refresh();
          }}
          onChanged={refresh}
        />
      )}
    </>
  );
}

/* ---------- Captations et présences ---------- */

function CoverageRow({ item, onDone }: { item: DashboardActionItem; onDone: () => void }) {
  const cov = useEventCoverage(item.eventId ?? undefined);
  const [busy, setBusy] = useState(false);
  const respond = async (r: "accepted" | "rejected") => {
    setBusy(true);
    const ok = await cov.respondToCoverage(r);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <Row title={item.title} eventId={item.eventId} date={item.date} location={item.location} subtitle={item.detail}>
      <button disabled={busy || !cov.request} onClick={() => respond("rejected")} className={btnKo}>
        Refuser
      </button>
      <button disabled={busy || !cov.request} onClick={() => respond("accepted")} className={btnOk}>
        <Check size={12} /> Accepter
      </button>
    </Row>
  );
}

function AttendanceRow({ item, onDone }: { item: DashboardActionItem; onDone: () => void }) {
  const att = useDirectorAttendance(item.eventId ?? undefined);
  const [busy, setBusy] = useState(false);
  const respond = async (r: "approved" | "denied") => {
    setBusy(true);
    const ok = await att.respondToAttendance(r);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <Row title={item.title} eventId={item.eventId} date={item.date} location={item.location}>
      <button disabled={busy || !att.attendance} onClick={() => respond("denied")} className={btnKo}>
        Absent
      </button>
      <button disabled={busy || !att.attendance} onClick={() => respond("approved")} className={btnOk}>
        <Check size={12} /> Présent
      </button>
    </Row>
  );
}

/* ---------- Demandes de captation à attribuer (admin) ---------- */

function AssignRow({ item, technicians, onDone }: { item: DashboardActionItem; technicians: TechnicianOption[]; onDone: () => void }) {
  const cov = useEventCoverage(item.eventId ?? undefined);
  const [techId, setTechId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tech = technicians.find((t) => t.id === techId);
  const travel = useTravelToEvent(item.eventId, technicians.length ? technicians.map((t) => t.id) : undefined);
  // Les plus proches d'abord ; ceux sans trajet calculable (adresse manquante) à la fin.
  const sorted = [...technicians].sort((a, b) => (travel[a.id]?.minutes ?? Infinity) - (travel[b.id]?.minutes ?? Infinity));
  const assign = async (direct: boolean) => {
    if (!tech) return;
    setBusy(true);
    setError(null);
    const ok = direct
      ? await cov.assignTechnician(tech)
      : await cov.assignPending(tech, { title: item.title, start: new Date(item.date ?? Date.now()) });
    setBusy(false);
    if (ok) onDone();
    else setError("L'assignation a échoué.");
  };
  const details = cov.request?.details ?? item.detail;
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-sm font-bold text-ink">{item.title}</span>
        {item.eventId && <EventArrow eventId={item.eventId} className="h-6 w-6" />}
      </div>
      <WhenWhere date={item.date} location={item.location} title={item.title} />
      {/* Couverture refusée : qui a refusé (et pourquoi), en rouge au-dessus de la demande d'origine. */}
      {item.detail?.startsWith("Refusée") && <div className="text-[11px] font-semibold text-bad">{item.detail}</div>}
      {details && details !== item.detail && <div className="truncate text-[11px] text-ink-4">{details}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={techId}
          onChange={(e) => setTechId(e.target.value)}
          className="min-w-0 flex-1 rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none"
        >
          <option value="">Choisir un technicien…</option>
          {sorted.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {travel[t.id] ? ` — ${formatTravel(travel[t.id])}` : ""}
            </option>
          ))}
        </select>
        <button disabled={busy || !tech} onClick={() => assign(false)} title="Le technicien reçoit la mission et doit l'accepter" className={btnGhost}>
          Proposer
        </button>
        <button disabled={busy || !tech} onClick={() => assign(true)} title="Mission validée immédiatement" className={btnOk}>
          <Check size={12} /> Désigner
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

function AssignList({ items, onDone }: { items: DashboardActionItem[]; onDone: (id: string) => void }) {
  const { technicians } = useAvailableTechnicians();
  const { open } = useOpenEvent();
  const [mapOpen, setMapOpen] = useState(false);
  const mapEvents = items
    .filter((i) => i.eventId && i.location)
    .map((i) => ({ id: i.eventId!, title: i.title, org: i.eventType ? EVENT_TYPE_TO_ORG[i.eventType] : ("red" as const), start: i.date, location: i.location }));
  return (
    <>
      {mapEvents.length > 0 && (
        <div className="border-b border-line px-4 py-2.5">
          <button
            onClick={() => setMapOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-xs font-semibold text-link hover:bg-hover"
          >
            <MapIcon size={13} /> {mapOpen ? "Masquer la carte" : "Carte des demandes et des techniciens"}
          </button>
          {mapOpen && <StaffEventsMap events={mapEvents} onOpenEvent={(id) => void open(id)} className="mt-2 h-[340px]" />}
        </div>
      )}
      {items.map((i) => (
        <AssignRow key={i.id} item={i} technicians={technicians} onDone={() => onDone(i.id)} />
      ))}
    </>
  );
}

/* ---------- Popup ---------- */

/** Carte de l'Espace Team : ouverte en popup (fiche complète), comme depuis le calendrier. */
function CardRow({ item, onOpen }: { item: DashboardActionItem; onOpen: () => void }) {
  const { open } = useOpenTeamCard();
  const late = item.detail?.includes("en retard");
  return (
    <button
      onClick={() => {
        onOpen();
        open(item.id);
      }}
      className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink">{item.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
          {item.detail && <span className={late ? "font-semibold text-bad" : ""}>{item.detail}</span>}
          {item.date && <span>Échéance {new Date(item.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>}
        </span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-ink-4" />
    </button>
  );
}

/**
 * Popup d'une action du tableau de bord : on traite directement (valider/refuser des frais,
 * accepter une captation, confirmer une présence…) sans quitter l'accueil ; le module complet
 * reste accessible en bas.
 */
export function ActionPopup({
  action,
  onClose,
  onNavigate,
  onChanged,
}: {
  action: DashboardAction;
  onClose: () => void;
  onNavigate?: (app: string) => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<DashboardActionItem[]>(action.items ?? []);
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    onChanged();
  };

  let body: React.ReactNode;
  switch (action.id) {
    case "frais-valider":
      body = <ValidateList onChanged={onChanged} />;
      break;
    case "frais-declarer":
      body = <DeclareList statuses={["a_declarer"]} onChanged={onChanged} />;
      break;
    case "frais-refuses":
      body = <DeclareList statuses={["rejected"]} onChanged={onChanged} />;
      break;
    case "captation-repondre":
      body = items.length ? items.map((i) => <CoverageRow key={i.id} item={i} onDone={() => removeItem(i.id)} />) : null;
      break;
    case "presence":
      body = items.length ? items.map((i) => <AttendanceRow key={i.id} item={i} onDone={() => removeItem(i.id)} />) : null;
      break;
    case "captation-attribuer":
    case "couverture-refusee":
      body = items.length ? <AssignList items={items} onDone={removeItem} /> : null;
      break;
    case "cartes":
      body = items.length ? items.map((i) => <CardRow key={i.id} item={i} onOpen={onClose} />) : null;
      break;
    case "publier":
      body = items.length ? items.map((i) => <Row key={i.id} title={i.title} eventId={i.eventId} date={i.date} />) : null;
      break;
    default:
      body = <p className="p-4 text-sm text-ink-3">{action.detail}</p>;
  }
  if (body === null) body = <p className="p-4 text-sm text-ink-3">Tout est traité. 👍</p>;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Action rapide</div>
            <h3 className="mt-1 text-base font-extrabold">{action.title}</h3>
            <div className="text-xs text-white/80">{action.detail}</div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{body}</div>
        {onNavigate && (
          <div className="flex shrink-0 justify-end border-t border-line px-5 py-3">
            <button
              onClick={() => {
                onClose();
                onNavigate(action.app);
              }}
              className="flex items-center gap-1 text-xs font-semibold text-link hover:underline"
            >
              Ouvrir {APP_LABELS[action.app] ?? action.app} <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
