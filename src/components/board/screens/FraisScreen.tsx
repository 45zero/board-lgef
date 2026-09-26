"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, ShieldCheck, Users, X, Paperclip, Search, ChevronRight } from "lucide-react";
import {
  getMyExpenses,
  getMyValidatorScope,
  getSubmissionsToReview,
  reviewSubmission,
  getValidatorAssignments,
  setExpenseValidator,
  type MyExpenseItem,
  type SubmissionToReview,
  type ValidatorAssignment,
} from "@/app/actions/expenses";
import { useEventExpenses } from "@/hooks/board/useEventExpenses";
import { FraisTab } from "@/components/board/calendar/EventTabs";
import { ExpenseStatusBadge, EXPENSE_STATUS_META, formatEuros } from "@/components/board/expenses/ExpenseStatus";
import { EVENT_TYPE_TO_ORG } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS } from "@/lib/board/tokens";

type Tab = "mine" | "validate" | "admin";
type MineFilter = "a_declarer" | "pending" | "approved" | "rejected" | "all";

const MINE_FILTERS: { id: MineFilter; label: string }[] = [
  { id: "a_declarer", label: "À déclarer" },
  { id: "pending", label: "En attente" },
  { id: "approved", label: "Validés" },
  { id: "rejected", label: "Refusés" },
  { id: "all", label: "Tous" },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function OrgChip({ eventType }: { eventType: MyExpenseItem["eventType"] }) {
  if (!eventType) return null;
  const org = EVENT_TYPE_TO_ORG[eventType];
  const c = ORG_COLORS[org];
  return (
    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: c.bg, color: c.ink }}>
      {ORG_LABELS[org]}
    </span>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------- Mes frais ---------- */

/** Fiche de frais d'un événement : lignes (saisie/suppression) + déclaration au N+1. */
function ExpenseSheetModal({ item, onClose, onChanged }: { item: MyExpenseItem; onClose: () => void; onChanged: () => void }) {
  const hook = useEventExpenses(item.eventId);
  const locked = item.status === "approved";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 bg-navy px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Note de frais</div>
              <h3 className="mt-1 truncate text-base font-extrabold">{item.title}</h3>
              <div className="mt-0.5 text-xs text-white/80">
                {fmtDate(item.start)} · {item.roles.join(", ") || "—"}
              </div>
            </div>
            <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {locked ? (
            <div className="space-y-3">
              <ExpenseStatusBadge status="approved" />
              <p className="text-sm text-ink-2">
                {formatEuros(item.total)} validés{item.reviewerName ? ` par ${item.reviewerName}` : ""}
                {item.reviewedAt ? ` le ${new Date(item.reviewedAt).toLocaleDateString("fr-FR")}` : ""}.
              </p>
            </div>
          ) : (
            <FraisTab hook={hook} eventId={item.eventId} onDeclared={onChanged} />
          )}
        </div>
      </div>
    </div>
  );
}

function MyExpenses() {
  const [items, setItems] = useState<MyExpenseItem[] | null>(null);
  const [filter, setFilter] = useState<MineFilter>("a_declarer");
  const [open, setOpen] = useState<MyExpenseItem | null>(null);

  const load = useCallback(() => getMyExpenses().then(setItems).catch(() => setItems([])), []);
  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items ?? []) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);
  const visible = (items ?? []).filter((i) => filter === "all" || i.status === filter);

  if (!items) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {MINE_FILTERS.map((f) => (
          <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            {f.id !== "all" && counts[f.id] ? ` (${counts[f.id]})` : f.id === "all" ? ` (${items.length})` : ""}
          </FilterChip>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-4">
          {filter === "a_declarer" ? "Rien à déclarer : tous vos frais sont à jour. 👍" : "Aucune note de frais ici."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-panel border border-line bg-card">
          {visible.map((i) => (
            <button
              key={i.eventId}
              onClick={() => setOpen(i)}
              className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-ink">{i.title}</span>
                  <OrgChip eventType={i.eventType} />
                </div>
                <div className="mt-0.5 text-[11px] text-ink-4">
                  {fmtDate(i.start)} · {i.roles.join(", ") || "Déclaration existante"}
                  {i.lineCount > 0 && ` · ${i.lineCount} ligne${i.lineCount > 1 ? "s" : ""}`}
                </div>
                {i.status === "rejected" && i.reviewerComment && <div className="mt-0.5 truncate text-[11px] text-bad">Motif : {i.reviewerComment}</div>}
              </div>
              <span className="shrink-0 text-sm font-bold text-ink">{i.total > 0 ? formatEuros(i.total) : ""}</span>
              {i.status === "a_declarer" || i.status === "rejected" ? (
                <span className="shrink-0 rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white shadow-btn-red">
                  {i.status === "rejected" ? "Corriger" : "Déclarer"}
                </span>
              ) : (
                <ExpenseStatusBadge status={i.status} />
              )}
            </button>
          ))}
        </div>
      )}

      {open && (
        <ExpenseSheetModal
          item={open}
          onClose={() => {
            setOpen(null);
            void load();
          }}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

/* ---------- À valider (N+1) ---------- */

const LINE_FIELDS: { key: keyof SubmissionToReview["lines"][number]; label: string }[] = [
  { key: "transport_fees", label: "Transport" },
  { key: "fuel_fees", label: "Carburant" },
  { key: "toll_fees", label: "Péage" },
  { key: "parking_fees", label: "Parking" },
  { key: "car_rental_fees", label: "Location" },
  { key: "hotel_fees", label: "Hôtel" },
  { key: "meal_fees", label: "Repas" },
  { key: "other_fees", label: "Autres" },
];

/** Fiche de validation : détail des lignes, justificatifs, puis Valider / Refuser (motif obligatoire). */
function ReviewModal({ sub, onClose, onDone }: { sub: SubmissionToReview; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDecide = sub.status === "pending";

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    const res = await reviewSubmission(sub.submissionId, decision, comment);
    setBusy(false);
    if (res.error) return setError(res.error);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 bg-navy px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Validation des frais</div>
              <h3 className="mt-1 truncate text-base font-extrabold">{sub.person.name}</h3>
              <div className="mt-0.5 truncate text-xs text-white/80">
                {sub.event.title} · {fmtDate(sub.event.start)}
              </div>
            </div>
            <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex items-center justify-between">
            <ExpenseStatusBadge status={sub.status} />
            <span className="text-xl font-extrabold text-ink">{formatEuros(sub.total)}</span>
          </div>

          {sub.lines.map((l, idx) => {
            const parts = LINE_FIELDS.filter((f) => Number(l[f.key] ?? 0) > 0);
            return (
              <div key={l.id} className="rounded-btn border border-line p-3 text-sm">
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-ink-3">
                  <span>Ligne {idx + 1}</span>
                  <span className="text-ink">{formatEuros(Number(l.total_amount ?? 0))}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">
                  {parts.map((f) => (
                    <span key={f.key}>
                      {f.label} : <strong>{formatEuros(Number(l[f.key]))}</strong>
                    </span>
                  ))}
                  {l.distance_km ? <span>Distance : {l.distance_km} km</span> : null}
                </div>
                {(l.other_fees_description || l.description) && (
                  <p className="mt-1 text-xs italic text-ink-3">{l.other_fees_description || l.description}</p>
                )}
              </div>
            );
          })}

          {sub.attachments.length > 0 && (
            <div className="space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Justificatifs</div>
              {sub.attachments.map((a) => (
                <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-semibold text-link hover:underline">
                  <Paperclip size={12} /> {a.name}
                </a>
              ))}
            </div>
          )}

          {sub.reviewerComment && !canDecide && <p className="rounded-btn bg-subtle px-3 py-2 text-xs text-ink-2">Commentaire : {sub.reviewerComment}</p>}

          {canDecide && (
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Commentaire (obligatoire en cas de refus)…"
              className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
            />
          )}
          {error && <p className="text-xs text-bad">{error}</p>}
        </div>

        {canDecide && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">
            <button
              disabled={busy}
              onClick={() => decide("rejected")}
              className="rounded-btn border border-bad px-4 py-2 text-sm font-bold text-bad disabled:opacity-50"
            >
              Refuser
            </button>
            <button
              disabled={busy}
              onClick={() => decide("approved")}
              className="rounded-btn bg-good px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Valider"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToValidate({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => void }) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [subs, setSubs] = useState<SubmissionToReview[] | null>(null);
  const [open, setOpen] = useState<SubmissionToReview | null>(null);

  const load = useCallback(() => getSubmissionsToReview(status, scope).then(setSubs).catch(() => setSubs([])), [status, scope]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
            {EXPENSE_STATUS_META[s].label}
          </FilterChip>
        ))}
        {isAdmin && (
          <label className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-ink-3">
            <input type="checkbox" checked={scope === "all"} onChange={(e) => setScope(e.target.checked ? "all" : "mine")} />
            Toutes les déclarations (admin)
          </label>
        )}
      </div>

      {!subs ? (
        <div className="p-6 text-sm text-ink-4">Chargement…</div>
      ) : subs.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-4">
          {status === "pending" ? "Aucune note de frais en attente de validation." : "Aucune note de frais."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-panel border border-line bg-card">
          {subs.map((s) => (
            <button
              key={s.submissionId}
              onClick={() => setOpen(s)}
              className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-ink">{s.person.name}</div>
                <div className="truncate text-[11px] text-ink-4">
                  {s.event.title} · {fmtDate(s.event.start)}
                  {s.submittedAt && ` · déclaré le ${new Date(s.submittedAt).toLocaleDateString("fr-FR")}`}
                </div>
              </div>
              <span className="shrink-0 text-sm font-bold text-ink">{formatEuros(s.total)}</span>
              <ChevronRight size={16} className="shrink-0 text-ink-4" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <ReviewModal
          sub={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            void load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/* ---------- Administration ---------- */

function ValidatorsAdmin() {
  const [rows, setRows] = useState<ValidatorAssignment[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getValidatorAssignments()
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const change = async (personId: string, validatorId: string) => {
    const value = validatorId || null;
    setRows((prev) => prev?.map((r) => (r.id === personId ? { ...r, validatorId: value } : r)) ?? null);
    const res = await setExpenseValidator(personId, value);
    if (res.error) setError(res.error);
  };

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!rows) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;

  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => !q || `${r.name} ${r.email ?? ""}`.toLowerCase().includes(q));
  const withoutValidator = rows.filter((r) => !r.validatorId).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-btn border border-line bg-card px-2.5 py-1.5">
          <Search size={13} className="text-ink-4" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une personne…" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <span className="text-xs text-ink-4">
          {withoutValidator} personne{withoutValidator > 1 ? "s" : ""} sans responsable N+1
        </span>
      </div>
      <div className="overflow-hidden rounded-panel border border-line bg-card">
        {visible.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{r.name}</div>
              <div className="truncate text-[11px] text-ink-4">{r.email}</div>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-3">
              N+1
              <select
                value={r.validatorId ?? ""}
                onChange={(e) => change(r.id, e.target.value)}
                className={`max-w-[220px] rounded-btn border px-2 py-1.5 text-sm outline-none ${r.validatorId ? "border-line" : "border-warn"}`}
              >
                <option value="">— Aucun —</option>
                {rows
                  .filter((v) => v.id !== r.id)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Écran ---------- */

/**
 * Frais : « Mes frais » (événements où je suis sollicité → déclarer), « À valider » (si je suis N+1
 * de quelqu'un, ou admin) et « Responsables N+1 » (admin : qui valide les frais de qui).
 */
export function FraisScreen() {
  const [tab, setTab] = useState<Tab>("mine");
  const [scope, setScope] = useState<Awaited<ReturnType<typeof getMyValidatorScope>> | null>(null);

  const loadScope = useCallback(() => getMyValidatorScope().then(setScope).catch(() => undefined), []);
  useEffect(() => {
    void loadScope();
  }, [loadScope]);

  const tabs: { id: Tab; label: string; icon: typeof Receipt; badge?: number; show: boolean }[] = [
    { id: "mine", label: "Mes frais", icon: Receipt, show: true },
    { id: "validate", label: "À valider", icon: ShieldCheck, badge: scope?.pending, show: !!scope && (scope.isValidator || scope.isAdmin) },
    { id: "admin", label: "Responsables N+1", icon: Users, show: !!scope?.isAdmin },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs
          .filter((t) => t.show)
          .map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-btn px-3.5 py-2 text-sm font-semibold ${
                  tab === t.id ? "bg-navy text-white" : "bg-card text-ink-2 hover:bg-hover"
                }`}
              >
                <Icon size={15} /> {t.label}
                {!!t.badge && <span className="rounded-full bg-red px-1.5 text-[10px] font-bold text-white">{t.badge}</span>}
              </button>
            );
          })}
      </div>

      {tab === "mine" && <MyExpenses />}
      {tab === "validate" && <ToValidate isAdmin={!!scope?.isAdmin} onChanged={() => void loadScope()} />}
      {tab === "admin" && <ValidatorsAdmin />}
    </div>
  );
}
