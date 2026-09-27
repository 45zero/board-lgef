"use client";

import { useEffect, useState } from "react";
import { X, Check, ChevronRight } from "lucide-react";
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
import { formatEuros } from "@/components/board/expenses/ExpenseStatus";
import { OpenEventButton } from "@/components/board/calendar/OpenEventButton";
import { useEventCoverage } from "@/hooks/board/useEventCoverage";
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
};

function Row({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-ink">{title}</div>
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
          <div className="truncate text-sm font-bold text-ink">
            {sub.person.name} · {formatEuros(sub.total)}
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
      .then((all) => setItems(all.filter((i) => statuses.includes(i.status))))
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
        <Row key={i.eventId} title={i.title} subtitle={`${fmt(i.start)} · ${i.roles.join(", ")}${i.reviewerComment ? ` · Motif : ${i.reviewerComment}` : ""}`}>
          {i.status === "a_declarer" && i.lineCount === 0 && (
            <button
              disabled={busy === i.eventId}
              onClick={async () => {
                setBusy(i.eventId);
                await declareExpenses(i.eventId, true);
                setBusy(null);
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
    <Row title={item.title} subtitle={`${fmt(item.date)}${item.detail ? ` · ${item.detail}` : ""}`}>
      {item.eventId && <OpenEventButton eventId={item.eventId} label="Voir" className={btnGhost} />}
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
    <Row title={item.title} subtitle={fmt(item.date)}>
      {item.eventId && <OpenEventButton eventId={item.eventId} label="Voir" className={btnGhost} />}
      <button disabled={busy || !att.attendance} onClick={() => respond("denied")} className={btnKo}>
        Absent
      </button>
      <button disabled={busy || !att.attendance} onClick={() => respond("approved")} className={btnOk}>
        <Check size={12} /> Présent
      </button>
    </Row>
  );
}

/* ---------- Popup ---------- */

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
  const drop = (id: string) => {
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
      body = items.length ? items.map((i) => <CoverageRow key={i.id} item={i} onDone={() => drop(i.id)} />) : null;
      break;
    case "presence":
      body = items.length ? items.map((i) => <AttendanceRow key={i.id} item={i} onDone={() => drop(i.id)} />) : null;
      break;
    case "captation-attribuer":
    case "publier":
      body = items.length
        ? items.map((i) => (
            <Row key={i.id} title={i.title} subtitle={fmt(i.date)}>
              {i.eventId && <OpenEventButton eventId={i.eventId} label={action.id === "publier" ? "Voir l'événement" : "Traiter"} className={btnGhost} />}
            </Row>
          ))
        : null;
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
