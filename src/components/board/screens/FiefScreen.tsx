"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { refreshBadges } from "@/components/board/live/LiveProvider";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Flag,
  LayoutDashboard,
  Megaphone,
  Newspaper,
  Plus,
  Search,
  Settings,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { DocumentsView } from "@/components/fief/documents";
import { FiefAdsAdmin } from "@/components/board/fief/FiefAdsAdmin";
import { Feed, type FeedModeration } from "@/components/fief/feed";
import { FiefEventShare } from "@/components/board/fief/FiefEventShare";
import { unwrap } from "@/lib/board/actionResult";
import { Toggle } from "@/components/board/Toggle";
import { ageOn, DEFAULT_CHARTER, type FiefSettings } from "@/lib/fief/shared";
import {
  approveFiefApplication,
  getFiefDriveFolderUrl,
  getFiefOverview,
  listFiefApplications,
  listFiefEvents,
  listFiefReports,
  moderateFiefComment,
  moderateFiefPost,
  resolveFiefReport,
  listFiefMembers,
  refuseFiefApplication,
  saveFiefFunction,
  saveFiefRequestRecipients,
  getFiefAdmins,
  setFiefAdmin,
  type FiefAdminsState,
  setFiefMemberStatus,
  updateFiefSettings,
  type FiefApplicationRow,
  type FiefEventRow,
  type FiefReportRow,
  type FiefAudience,
  type FiefMemberRow,
  type FiefOverview,
} from "@/app/actions/fief-admin";

// Onglet FIEF du board (module « fief » : Claire et les administrateurs). Lot 1 : tableau de bord,
// demandes d'adhésion, membres, réglages (mineures, charte, fonctions). Fil, documents et
// événements « Visible sur FIEF » arrivent avec les lots suivants. Site des membres : fief.lgef.fr.

type Tab = "home" | "requests" | "members" | "feed" | "documents" | "events" | "ads" | "settings";

const PUBLIC_URL = (process.env.NEXT_PUBLIC_FIEF_URL || "").replace(/\/+$/, "") || "/fief";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 30) return `Il y a ${days} jours`;
  return fmtDate(iso);
}

export function FiefScreen() {
  const [tab, setTab] = useState<Tab>("home");
  const [overview, setOverview] = useState<FiefOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    getFiefOverview()
      .then((r) => setOverview(unwrap(r)))
      .catch((e) => setError(e instanceof Error ? e.message : "FIEF est indisponible."));
  }, []);
  useEffect(reload, [reload]);

  const functionLabels = useMemo(() => Object.fromEntries((overview?.functions ?? []).map((f) => [f.slug, f.label])), [overview]);

  const tabs: { id: Tab; label: string; icon: typeof Users; badge?: number }[] = [
    { id: "home", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "requests", label: "Demandes", icon: UserCheck, badge: overview?.counts.pending },
    { id: "members", label: "Membres", icon: Users },
    { id: "feed", label: "Fil", icon: Newspaper },
    { id: "documents", label: "Documents", icon: FileText },
    { id: "events", label: "Événements", icon: CalendarDays },
    { id: "ads", label: "Publicités", icon: Megaphone },
    { id: "settings", label: "Réglages", icon: Settings },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/fief/crest.png" alt="" width={40} height={43} className="h-auto w-10" />
        <div>
          <h1 className="text-lg font-extrabold text-ink">
            <span className="italic">FIEF</span> — Graines d&apos;éducatrices
          </h1>
          <p className="text-xs text-ink-3">Femmes Investies dans l&apos;Encadrement du Football</p>
        </div>
        <a href={PUBLIC_URL} target="_blank" rel="noopener" className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-link hover:underline">
          Ouvrir fief.lgef.fr <ExternalLink size={12} />
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-btn px-3.5 py-2 text-sm font-semibold ${
              tab === t.id ? "bg-navy text-white" : "bg-card text-ink-2 hover:bg-hover"
            }`}
          >
            <t.icon size={15} /> {t.label}
            {!!t.badge && <span className={`rounded-full px-1.5 text-[11px] ${tab === t.id ? "bg-white/20" : "bg-red text-white"}`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
      {!overview && !error && <p className="text-sm text-ink-3">Chargement…</p>}

      {overview && tab === "home" && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label="Demandes en attente" value={overview.counts.pending} accent />
            <Tile label="Membres validées" value={overview.counts.members} />
            <Tile label="En attente d'un parent" value={overview.counts.awaitingParent} />
            <Tile label="Comptes suspendus" value={overview.counts.suspended} />
          </div>
          <section className="rounded-card border border-line bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-extrabold text-ink">Dernières demandes d&apos;adhésion</h2>
              {overview.pending.length > 0 && (
                <button onClick={() => setTab("requests")} className="text-xs font-semibold text-link hover:underline">
                  Voir tout →
                </button>
              )}
            </div>
            {overview.pending.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">Aucune demande en attente.</p>
            ) : (
              <div className="divide-y divide-line">
                {overview.pending.slice(0, 5).map((a) => (
                  <ApplicationRow key={a.id} app={a} labels={functionLabels} onDone={reload} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {overview && tab === "requests" && <RequestsTab labels={functionLabels} onChanged={reload} />}
      {overview && tab === "members" && <MembersTab labels={functionLabels} onChanged={reload} />}
      {overview && tab === "feed" && <FeedTab />}
      {overview && tab === "documents" && (
        <div className="rounded-card border border-line bg-[#F3F6FB] p-4">
          <DocumentsView
            team
            driveUrl={async () => {
              const r = await getFiefDriveFolderUrl();
              return r.ok ? r.data : null;
            }}
          />
        </div>
      )}
      {overview && tab === "events" && <EventsTab />}
      {overview && tab === "ads" && <FiefAdsAdmin />}
      {overview && tab === "settings" && <SettingsTab overview={overview} onSaved={reload} />}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">{label}</p>
      <p className={`mt-0.5 text-2xl font-extrabold ${accent && value > 0 ? "text-red" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function Initials({ first, last }: { first: string; last: string }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
      {`${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase()}
    </span>
  );
}

/** Une demande : résumé, détail dépliable, Valider / Refuser (avec motif). */
function ApplicationRow({ app, labels, onDone }: { app: FiefApplicationRow; labels: Record<string, string>; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const actionable = app.status === "pending" || app.status === "awaiting_parent";
  const age = ageOn(app.birthDate);

  const approve = async () => {
    setBusy(true);
    setMsg(null);
    const r = await approveFiefApplication(app.id);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({
      ok: true,
      text: r.data.existingAccount
        ? `Acceptée — compte existant, ${r.data.emailed ? "e-mail « connectez-vous » envoyé" : "e-mail non envoyé"}.`
        : `Acceptée — ${r.data.emailed ? "lien pour choisir son mot de passe envoyé" : "e-mail non envoyé (envoi non configuré)"}.`,
    });
    refreshBadges();
    onDone();
  };
  const refuse = async () => {
    setBusy(true);
    setMsg(null);
    const r = await refuseFiefApplication(app.id, reason, notify);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setRefusing(false);
    setMsg({ ok: true, text: `Refusée${notify ? (r.data.emailed ? " — e-mail envoyé" : " — e-mail non envoyé") : ""}.` });
    refreshBadges();
    onDone();
  };

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Initials first={app.firstName} last={app.lastName} />
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <p className="truncate font-bold text-ink">
            {app.firstName} {app.lastName}
            {age < 18 && <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-semibold text-warn">Mineure · {age} ans</span>}
          </p>
          <p className="truncate text-xs text-ink-3">
            {app.clubName ?? "Sans club"}
            {app.clubNotListed && " (saisi à la main)"} · {app.email}
          </p>
        </button>
        <div className="hidden flex-wrap gap-1 md:flex">
          {app.functions.map((f) => (
            <span key={f} className="rounded-full bg-sel-bg px-2 py-0.5 text-[11px] font-semibold text-navy-600">
              {labels[f] ?? f}
            </span>
          ))}
        </div>
        <span className="w-24 text-right text-xs text-ink-4">{ago(app.createdAt)}</span>
        {actionable && !msg?.ok && (
          <div className="flex gap-1.5">
            {app.status === "pending" && (
              <button
                disabled={busy}
                onClick={() => void approve()}
                className="rounded-btn bg-good px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                Valider
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => setRefusing((v) => !v)}
              className="rounded-btn border border-bad px-3 py-1.5 text-xs font-bold text-bad disabled:opacity-50"
            >
              Refuser
            </button>
          </div>
        )}
        <button onClick={() => setOpen((o) => !o)} aria-label="Détails" className="rounded-btn p-1 text-ink-4 hover:bg-hover">
          <ChevronDown size={16} className={open ? "rotate-180" : ""} />
        </button>
      </div>

      {open && (
        <dl className="ml-[52px] mt-3 grid gap-x-6 gap-y-1.5 rounded-btn bg-panel p-3 text-sm sm:grid-cols-2">
          <Field label="Date de naissance" value={`${fmtDate(app.birthDate)} (${age} ans)`} />
          <Field label="Téléphone" value={app.phone ?? "—"} />
          <Field label="Club" value={app.clubName ? `${app.clubName}${app.clubNumber ? ` · n° ${app.clubNumber}` : " · hors liste"}` : "Sans club"} />
          <Field label="Fonctions" value={app.functions.map((f) => labels[f] ?? f).join(", ")} />
          {app.parentEmail && (
            <Field
              label="Parent"
              value={`${app.parentName ?? ""} · ${app.parentEmail} — ${
                app.parentConsentAt ? `accord le ${fmtDate(app.parentConsentAt)}` : "accord en attente"
              }`}
            />
          )}
          {app.message && (
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">Message</dt>
              <dd className="whitespace-pre-line text-ink-2">{app.message}</dd>
            </div>
          )}
          {app.refusalReason && <Field label="Motif du refus" value={app.refusalReason} />}
          {app.reviewedAt && <Field label="Traitée le" value={fmtDate(app.reviewedAt)} />}
        </dl>
      )}

      {refusing && (
        <div className="ml-[52px] mt-3 space-y-2 rounded-btn border border-line p-3">
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motif (facultatif, repris dans l'e-mail)"
            className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Prévenir par e-mail
            </label>
            <button
              disabled={busy}
              onClick={() => void refuse()}
              className="ml-auto rounded-btn bg-bad px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              Confirmer le refus
            </button>
            <button onClick={() => setRefusing(false)} className="rounded-btn px-2 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover">
              Annuler
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`ml-[52px] mt-2 text-xs font-semibold ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">{label}</dt>
      <dd className="text-ink-2">{value}</dd>
    </div>
  );
}

function RequestsTab({ labels, onChanged }: { labels: Record<string, string>; onChanged: () => void }) {
  const [scope, setScope] = useState<"pending" | "awaiting_parent" | "processed">("pending");
  const [result, setResult] = useState<{ key: string; rows: FiefApplicationRow[]; error: string | null } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const key = `${scope}:${refresh}`;

  useEffect(() => {
    let alive = true;
    listFiefApplications(scope).then((r) => {
      if (alive) setResult({ key: `${scope}:${refresh}`, rows: r.ok ? r.data : [], error: r.ok ? null : r.error });
    });
    return () => {
      alive = false;
    };
  }, [scope, refresh]);

  const current = result?.key === key ? result : null;
  const scopes = [
    { id: "pending" as const, label: "À traiter" },
    { id: "awaiting_parent" as const, label: "En attente d'un parent" },
    { id: "processed" as const, label: "Historique" },
  ];
  return (
    <section className="rounded-card border border-line bg-card p-4">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {scopes.map((s) => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${scope === s.id ? "bg-navy text-white" : "bg-subtle text-ink-2 hover:bg-hover"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {current?.error && <p className="text-sm text-bad">{current.error}</p>}
      {!current && <p className="py-6 text-center text-sm text-ink-3">Chargement…</p>}
      {current && !current.error && current.rows.length === 0 && <p className="py-6 text-center text-sm text-ink-3">Aucune demande.</p>}
      <div className="divide-y divide-line">
        {current?.rows.map((a) => (
          <div key={a.id}>
            {scope === "processed" && (
              <span
                className={`mt-3 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  a.status === "approved" ? "bg-good-bg text-good" : "bg-bad-bg text-bad"
                }`}
              >
                {a.status === "approved" ? "Acceptée" : a.status === "refused" ? "Refusée" : "Retirée"}
                {a.reviewedAt ? ` le ${fmtDate(a.reviewedAt)}` : ""}
              </span>
            )}
            <ApplicationRow
              app={a}
              labels={labels}
              onDone={() => {
                onChanged();
                setRefresh((n) => n + 1);
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function MembersTab({ labels, onChanged }: { labels: Record<string, string>; onChanged: () => void }) {
  const [rows, setRows] = useState<FiefMemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fn, setFn] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    listFiefMembers().then((r) => (r.ok ? setRows(r.data) : setError(r.error)));
  }, []);
  useEffect(load, [load]);

  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const shown = (rows ?? []).filter(
    (m) => (!fn || m.functions.includes(fn)) && (!q.trim() || fold(`${m.firstName} ${m.lastName} ${m.clubName ?? ""} ${m.email}`).includes(fold(q.trim())))
  );

  const toggle = async (m: FiefMemberRow) => {
    const next = m.status === "active" ? "suspended" : "active";
    const reason = next === "suspended" ? window.prompt(`Suspendre ${m.firstName} ${m.lastName} ? Motif (facultatif) :`) : "";
    if (reason === null) return;
    setBusyId(m.userId);
    const r = await setFiefMemberStatus(m.userId, next, reason);
    setBusyId(null);
    if (!r.ok) return setError(r.error);
    load();
    onChanged();
  };

  return (
    <section className="rounded-card border border-line bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom, club, e-mail…"
            className="w-full rounded-btn border border-line bg-card py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-line-strong"
          />
        </div>
        <select value={fn} onChange={(e) => setFn(e.target.value)} className="rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink">
          <option value="">Toutes les fonctions</option>
          {Object.entries(labels).map(([slug, label]) => (
            <option key={slug} value={slug}>
              {label}
            </option>
          ))}
        </select>
        {rows && (
          <span className="text-xs text-ink-4">
            {shown.length} membre{shown.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      {!rows && !error && <p className="py-6 text-center text-sm text-ink-3">Chargement…</p>}
      {rows?.length === 0 && <p className="py-6 text-center text-sm text-ink-3">Pas encore de membre : les demandes acceptées apparaîtront ici.</p>}
      <div className="divide-y divide-line">
        {shown.map((m) => (
          <div key={m.userId} className="flex flex-wrap items-center gap-3 py-2.5">
            <Initials first={m.firstName} last={m.lastName} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-ink">
                {m.firstName} {m.lastName}
                {m.status !== "active" && (
                  <span className="ml-2 rounded-full bg-bad-bg px-2 py-0.5 text-[11px] font-semibold text-bad">
                    {m.status === "suspended" ? "Suspendue" : "Partie"}
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-ink-3">
                {m.clubName ?? "Sans club"} · {m.email}
                {m.phone ? ` · ${m.phone}` : ""}
              </p>
            </div>
            <div className="hidden flex-wrap gap-1 md:flex">
              {m.functions.map((f) => (
                <span key={f} className="rounded-full bg-sel-bg px-2 py-0.5 text-[11px] font-semibold text-navy-600">
                  {labels[f] ?? f}
                </span>
              ))}
            </div>
            <span className="w-28 text-right text-xs text-ink-4">depuis {fmtDate(m.joinedAt)}</span>
            {m.status !== "left" && (
              <button
                disabled={busyId === m.userId}
                onClick={() => void toggle(m)}
                className={`rounded-btn px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                  m.status === "active" ? "text-bad hover:bg-bad-bg" : "text-good hover:bg-good-bg"
                }`}
              >
                {m.status === "active" ? "Suspendre" : "Réactiver"}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsTab({ overview, onSaved }: { overview: FiefOverview; onSaved: () => void }) {
  const [s, setS] = useState<FiefSettings>({ ...overview.settings, charterText: overview.settings.charterText ?? DEFAULT_CHARTER });
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: true });
  const [newFn, setNewFn] = useState("");
  const [fnError, setFnError] = useState<string | null>(null);

  const save = async () => {
    setState({ busy: true, msg: null, ok: true });
    const r = await updateFiefSettings(s);
    setState({ busy: false, msg: r.ok ? "Réglages enregistrés." : r.error, ok: r.ok });
    if (r.ok) onSaved();
  };
  const fnSave = async (input: { slug?: string; label: string; active: boolean }) => {
    setFnError(null);
    const r = await saveFiefFunction(input);
    if (!r.ok) return setFnError(r.error);
    if (!input.slug) setNewFn("");
    onSaved();
  };
  const ageSelect = (value: number, min: number, max: number, onChange: (n: number) => void) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm text-ink">
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
        <option key={n} value={n}>
          {n} ans
        </option>
      ))}
    </select>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-4 rounded-card border border-line bg-card p-4">
        <h2 className="font-extrabold text-ink">Inscription des mineures</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">Accepter les mineures</p>
            <p className="text-xs text-ink-3">Désactivé : FIEF est réservé aux personnes majeures.</p>
          </div>
          <Toggle on={s.minorsAllowed} onClick={() => setS((p) => ({ ...p, minorsAllowed: !p.minorsAllowed }))} />
        </div>
        {s.minorsAllowed && (
          <div className="space-y-3 rounded-btn bg-panel p-3 text-sm text-ink-2">
            <div className="flex items-center justify-between gap-3">
              <span>Âge minimum</span>
              {ageSelect(s.minAge, 10, 17, (n) => setS((p) => ({ ...p, minAge: n })))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Accord d&apos;un parent exigé en dessous de</span>
              {ageSelect(s.parentalConsentUnder, 15, 18, (n) => setS((p) => ({ ...p, parentalConsentUnder: n })))}
            </div>
            <p className="text-xs text-ink-4">
              En France, l&apos;accord d&apos;un parent est obligatoire avant 15 ans pour un réseau social. Le parent reçoit un e-mail et confirme d&apos;un
              clic avant que la demande ne vous arrive.
            </p>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink">Charte acceptée à l&apos;inscription</p>
          <textarea
            rows={7}
            value={s.charterText ?? ""}
            onChange={(e) => setS((p) => ({ ...p, charterText: e.target.value }))}
            className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
          />
        </div>
        <div className="flex items-center gap-3">
          <button disabled={state.busy} onClick={() => void save()} className="rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {state.busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          {state.msg && <span className={`text-xs font-semibold ${state.ok ? "text-good" : "text-bad"}`}>{state.msg}</span>}
        </div>
      </section>

      <AdminsSection onSaved={onSaved} />
      <RecipientsSection overview={overview} onSaved={onSaved} />

      <section className="space-y-3 rounded-card border border-line bg-card p-4">
        <h2 className="font-extrabold text-ink">Fonctions proposées</h2>
        <p className="text-xs text-ink-3">
          Les rôles que les membres cochent à l&apos;inscription. Une fonction masquée n&apos;est plus proposée mais reste sur les fiches existantes.
        </p>
        <div className="divide-y divide-line">
          {overview.functions.map((f) => (
            <FunctionRow key={`${f.slug}:${f.label}`} slug={f.slug} label={f.label} active={f.active} onSave={fnSave} />
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newFn}
            onChange={(e) => setNewFn(e.target.value)}
            placeholder="Nouvelle fonction (ex. Préparatrice physique)"
            className="flex-1 rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
          />
          <button
            disabled={newFn.trim().length < 2}
            onClick={() => void fnSave({ label: newFn, active: true })}
            className="flex items-center gap-1 rounded-btn bg-navy px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            <Plus size={14} /> Ajouter
          </button>
        </div>
        {fnError && <p className="text-xs text-bad">{fnError}</p>}
      </section>
    </div>
  );
}

function FunctionRow({
  slug,
  label,
  active,
  onSave,
}: {
  slug: string;
  label: string;
  active: boolean;
  onSave: (i: { slug: string; label: string; active: boolean }) => Promise<void>;
}) {
  const [value, setValue] = useState(label);
  const dirty = value.trim() !== label;
  return (
    <div className="flex items-center gap-2 py-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`flex-1 rounded-btn border border-transparent bg-transparent px-2 py-1 text-sm hover:border-line focus:border-line-strong focus:outline-none ${
          active ? "text-ink" : "text-ink-4 line-through"
        }`}
      />
      {dirty && (
        <>
          <button onClick={() => void onSave({ slug, label: value, active })} aria-label="Enregistrer" className="rounded-btn p-1 text-good hover:bg-good-bg">
            <Check size={15} />
          </button>
          <button onClick={() => setValue(label)} aria-label="Annuler" className="rounded-btn p-1 text-ink-4 hover:bg-hover">
            <X size={15} />
          </button>
        </>
      )}
      <Toggle on={active} onClick={() => void onSave({ slug, label, active: !active })} />
    </div>
  );
}

const AUDIENCE_LABEL: Record<FiefAudience, string> = {
  all: "Toutes les membres",
  clubs: "Club(s)",
  functions: "Fonction(s)",
  members: "Sélection",
};

/** Événements à venir du board : visibles ou non sur FIEF, réglage du partage en dépliant la ligne. */
function EventsTab() {
  const [rows, setRows] = useState<FiefEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [onlyShared, setOnlyShared] = useState(false);

  const load = useCallback(() => {
    listFiefEvents().then((r) => (r.ok ? setRows(r.data) : setError(r.error)));
  }, []);
  useEffect(load, [load]);

  const shown = (rows ?? []).filter((e) => !onlyShared || e.share);
  const when = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return (
    <section className="rounded-card border border-line bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-extrabold text-ink">Calendrier — visible sur FIEF</h2>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={onlyShared} onChange={(e) => setOnlyShared(e.target.checked)} /> Seulement les événements visibles sur FIEF
        </label>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      {!rows && !error && <p className="py-6 text-center text-sm text-ink-3">Chargement…</p>}
      {rows && shown.length === 0 && <p className="py-6 text-center text-sm text-ink-3">Aucun événement dans les quatre prochains mois.</p>}
      <div className="divide-y divide-line">
        {shown.map((e) => (
          <div key={e.id} className="py-2.5">
            <button onClick={() => setOpenId(openId === e.id ? null : e.id)} className="flex w-full items-center gap-3 text-left">
              <span className="w-24 shrink-0 text-xs font-semibold uppercase text-ink-3">{when(e.startDate)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{e.title}</span>
                <span className="block truncate text-xs text-ink-4">
                  {time(e.startDate)}
                  {e.location ? ` · ${e.location}` : ""}
                </span>
              </span>
              {e.share ? (
                <span className="rounded-full bg-good-bg px-2 py-0.5 text-[11px] font-semibold text-good">
                  {e.share.mode === "info" ? "Information" : "Invitation"} · {AUDIENCE_LABEL[e.share.audience]}
                  {e.share.notifiedAt ? " · notifiées" : ""}
                  {e.share.mode === "invitation" && e.share.yes > 0 ? ` · ${e.share.yes} participe${e.share.yes > 1 ? "nt" : ""}` : ""}
                </span>
              ) : (
                <span className="text-[11px] text-ink-4">Non visible</span>
              )}
              <ChevronDown size={16} className={`text-ink-4 ${openId === e.id ? "rotate-180" : ""}`} />
            </button>
            {openId === e.id && (
              <div className="mt-3 rounded-btn bg-panel p-3">
                <FiefEventShare eventId={e.id} onSaved={load} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const ROLE_LABELS: Record<string, string> = {
  super_user: "Super admin",
  admin: "Administrateur",
  organizer: "Organisateur",
  comite_directeur: "Comité directeur",
  technician: "TeamMedias",
  user: "Utilisateur",
};

/** Administratrices FIEF : comptes du board qui voient l'onglet FIEF (règle du module « fief »). */
function AdminsSection({ onSaved }: { onSaved: () => void }) {
  const [state, setState] = useState<FiefAdminsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    getFiefAdmins().then((r) => (r.ok ? setState(r.data) : setError(r.error)));
  }, []);
  useEffect(load, [load]);

  const change = async (userId: string, on: boolean) => {
    setBusy(userId);
    setError(null);
    const r = await setFiefAdmin(userId, on);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setQ("");
    load();
    onSaved();
  };
  const needle = q.trim().toLowerCase();
  const matches = needle ? (state?.people ?? []).filter((p) => `${p.name} ${p.email ?? ""}`.toLowerCase().includes(needle)).slice(0, 8) : [];

  return (
    <section className="space-y-3 rounded-card border border-line bg-card p-4 lg:col-span-2">
      <h2 className="font-extrabold text-ink">Administratrices FIEF</h2>
      <p className="text-xs text-ink-3">
        Les personnes nommées ici voient l&apos;onglet FIEF du board : demandes, membres, fil, documents, événements et réglages. L&apos;accès est enregistré dans
        Paramètres → Modules. Les administrateurs du board y ont toujours accès.
      </p>
      {!state && !error && <p className="text-sm text-ink-3">Chargement…</p>}
      {state && (
        <ul className="divide-y divide-line rounded-card border border-line">
          {state.admins.map((a) => (
            <li key={a.userId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{a.name}</span>
                <span className="block truncate text-xs text-ink-4">
                  {ROLE_LABELS[a.role] ?? a.role}
                  {a.email ? ` · ${a.email}` : ""}
                </span>
              </span>
              {a.locked ? (
                <span className="text-[11px] text-ink-4">Accès permanent</span>
              ) : (
                <button
                  disabled={busy === a.userId}
                  onClick={() => window.confirm(`Retirer l'accès FIEF de ${a.name} ?`) && void change(a.userId, false)}
                  className="rounded-btn px-2.5 py-1 text-xs font-semibold text-bad hover:bg-bad-bg disabled:opacity-50"
                >
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {state && (
        <div className="relative max-w-md">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nommer une administratrice : nom ou e-mail d'un compte du board"
            className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-navy"
          />
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-card border border-line bg-card shadow-card">
              {matches.map((p) => (
                <li key={p.userId}>
                  <button disabled={!!busy} onClick={() => void change(p.userId, true)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover">
                    <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                    <span className="truncate text-xs text-ink-4">{p.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {needle && matches.length === 0 && <p className="mt-1 text-xs text-ink-3">Aucun compte du board ne correspond.</p>}
        </div>
      )}
      {error && <p className="text-xs font-semibold text-bad">{error}</p>}
    </section>
  );
}

/** Qui reçoit les alertes « nouvelle demande d'adhésion » (notification du board, avec push / e-mail selon ses réglages). */
function RecipientsSection({ overview, onSaved }: { overview: FiefOverview; onSaved: () => void }) {
  const [ids, setIds] = useState<string[]>(overview.recipients);
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: true });
  const dirty = [...ids].sort().join() !== [...overview.recipients].sort().join();

  const save = async () => {
    setState({ busy: true, msg: null, ok: true });
    const r = await saveFiefRequestRecipients(ids);
    setState({ busy: false, msg: r.ok ? "Destinataires enregistrés." : r.error, ok: r.ok });
    if (r.ok) onSaved();
  };

  return (
    <section className="space-y-3 rounded-card border border-line bg-card p-4 lg:col-span-2">
      <h2 className="font-extrabold text-ink">Alertes des nouvelles demandes</h2>
      <p className="text-xs text-ink-3">
        Qui est prévenu quand une demande d&apos;adhésion arrive (notification du board, avec push et e-mail selon les réglages de chacun). Seules les personnes
        qui voient l&apos;onglet FIEF peuvent être choisies. Si personne n&apos;est coché, les super admins sont prévenus.
      </p>
      <div className="grid gap-1 sm:grid-cols-2">
        {overview.candidates.map((c) => (
          <label key={c.userId} className="flex cursor-pointer items-center gap-2.5 rounded-btn px-2 py-1.5 text-sm hover:bg-hover">
            <input
              type="checkbox"
              checked={ids.includes(c.userId)}
              onChange={() => setIds((prev) => (prev.includes(c.userId) ? prev.filter((x) => x !== c.userId) : [...prev, c.userId]))}
              className="accent-navy"
            />
            <span className="flex-1 text-ink">{c.name}</span>
            <span className="text-[11px] text-ink-4">{ROLE_LABELS[c.role] ?? c.role}</span>
          </label>
        ))}
        {overview.candidates.length === 0 && <p className="text-xs text-ink-3">Liste indisponible.</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          disabled={state.busy || !dirty}
          onClick={() => void save()}
          className="rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {state.busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        {ids.length === 0 && <span className="text-xs text-ink-3">Personne de coché : les super admins seront prévenus.</span>}
        {state.msg && <span className={`text-xs font-semibold ${state.ok ? "text-good" : "text-bad"}`}>{state.msg}</span>}
      </div>
    </section>
  );
}

const MODERATION: FeedModeration = {
  setPost: async (postId, change) => {
    const r = await moderateFiefPost(postId, change);
    return r.ok ? null : r.error;
  },
  setComment: async (commentId, hidden) => {
    const r = await moderateFiefComment(commentId, hidden);
    return r.ok ? null : r.error;
  },
};

/** Fil FIEF vu par l'équipe : signalements ouverts, puis le fil avec épingler / masquer / supprimer. */
function FeedTab() {
  const [reports, setReports] = useState<FiefReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedKey, setFeedKey] = useState(0);

  const load = useCallback(() => {
    listFiefReports().then((r) => (r.ok ? setReports(r.data) : setError(r.error)));
  }, []);
  useEffect(load, [load]);

  const resolve = async (r: FiefReportRow, hide: boolean) => {
    if (hide && r.kind !== "message") {
      const res = r.kind === "post" ? await moderateFiefPost(r.targetId, { hidden: true }) : await moderateFiefComment(r.targetId, true);
      if (!res.ok) return setError(res.error);
      setFeedKey((k) => k + 1);
    }
    const res = await resolveFiefReport(r.id);
    if (!res.ok) return setError(res.error);
    load();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="order-2 rounded-card border border-line bg-[#F3F6FB] p-4 lg:order-1">
        <Feed key={feedKey} moderation={MODERATION} />
      </div>
      <section className="order-1 h-fit space-y-3 rounded-card border border-line bg-card p-4 lg:order-2">
        <h2 className="flex items-center gap-2 font-extrabold text-ink">
          <Flag size={16} className="text-red" /> Signalements
          {!!reports?.length && <span className="rounded-full bg-red px-1.5 text-[11px] text-white">{reports.length}</span>}
        </h2>
        {error && <p className="text-xs text-bad">{error}</p>}
        {reports === null && !error && <p className="text-sm text-ink-3">Chargement…</p>}
        {reports?.length === 0 && <p className="text-sm text-ink-3">Aucun signalement en attente.</p>}
        {reports?.map((r) => (
          <div key={r.id} className="space-y-2 rounded-btn border border-line p-3 text-sm">
            <p className="text-xs text-ink-3">
              {r.reporter} a signalé {r.kind === "post" ? "une publication" : r.kind === "comment" ? "un commentaire" : "un message privé"} de{" "}
              <strong className="text-ink">{r.author}</strong> · {fmtDate(r.createdAt)}
            </p>
            <p className="whitespace-pre-line rounded-btn bg-panel px-2.5 py-2 text-ink-2">{r.excerpt}</p>
            {r.reason && <p className="text-xs text-ink-3">Motif : {r.reason}</p>}
            <div className="flex flex-wrap gap-2">
              {r.kind !== "message" && !r.hidden && (
                <button onClick={() => void resolve(r, true)} className="rounded-btn bg-bad px-2.5 py-1 text-xs font-bold text-white">
                  Masquer et clore
                </button>
              )}
              <button
                onClick={() => void resolve(r, false)}
                className="rounded-btn border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-hover"
              >
                {r.kind === "message" ? "Traité" : "Laisser et clore"}
              </button>
            </div>
          </div>
        ))}
        <p className="text-[11px] text-ink-4">Les messages privés ne sont jamais visibles de l&apos;équipe, sauf un message signalé, montré ici.</p>
      </section>
    </div>
  );
}
