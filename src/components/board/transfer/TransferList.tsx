"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Copy, Check, ExternalLink, Eye, Download, Loader2, X, Mail, Ban, Archive, CalendarClock, FolderOpen, Send, Users, Pencil, Trash2, Save, Forward, Kanban } from "lucide-react";
import { unwrap } from "@/lib/board/actionResult";
import { durationChoices, durationLabel, fileKind, formatBytes, type TransferPlanLimits } from "@/lib/transfer/shared";
import { KindIcon, RemotePreviewModal } from "@/components/transfer/FilePreview";
import { LinkTransferToCardPopover } from "@/components/board/team/TeamTransfers";
import { TeamCardGlyph, useOpenTeamCard } from "@/components/board/team/TeamCardOpener";
import { clearOpenTransferParam, readOpenTransferParam } from "@/lib/board/deepLink";
import {
  deleteTransfer,
  forwardTransfer,
  listTransferPeople,
  updateTransfer,
  extendTransfer,
  getTransferDetail,
  listTransfers,
  resendTransfer,
  revokeTransfer,
  setTransferArchived,
  type TransferDetail,
  type TransferFilters,
  type TransferRow,
  type TransferStatus,
} from "@/app/actions/transfers";

// Onglet « Transferts » : ses transferts envoyés (tous ceux du board pour les admins) et reçus (à son
// adresse, ou qu'on lui a fait suivre), filtres par période, statut et recherche ; fiche détaillée
// avec aperçu, historique des téléchargements, actions. Un transfert reçu se consulte, se fait
// suivre et se joint à une carte ; seul l'expéditeur (ou un admin) le modifie.

const STATUS_META: Record<TransferStatus, { label: string; tone: string }> = {
  ready: { label: "Actif", tone: "bg-good-bg text-good" },
  uploading: { label: "Envoi en cours", tone: "bg-warn-bg text-warn" },
  expired: { label: "Expiré", tone: "bg-chip-bg text-ink-3" },
  revoked: { label: "Supprimé", tone: "bg-bad-bg text-bad" },
};

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export const PERIODS: { id: string; label: string; range: () => { from?: string; to?: string } }[] = [
  { id: "all", label: "Toutes les dates", range: () => ({}) },
  { id: "7", label: "7 derniers jours", range: () => ({ from: iso(new Date(Date.now() - 6 * 86400_000)) }) },
  { id: "30", label: "30 derniers jours", range: () => ({ from: iso(new Date(Date.now() - 29 * 86400_000)) }) },
  { id: "month", label: "Ce mois-ci", range: () => ({ from: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) }) },
  { id: "year", label: "Cette année", range: () => ({ from: `${new Date().getFullYear()}-01-01` }) },
  { id: "custom", label: "Période…", range: () => ({}) },
];

const dateTime = (s: string) => new Date(s).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const shortDate = (s: string) => new Date(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

type DrawerMode = "edit" | "forward" | "card" | null;
type Person = { id: string; name: string; email: string };
type ForwardDraft = { members: Person[]; query: string; to: string; note: string };
const EMPTY_FORWARD: ForwardDraft = { members: [], query: "", to: "", note: "" };

export function TransferList({
  isAdmin,
  plan,
  refreshKey,
  initial,
}: {
  isAdmin: boolean;
  plan: TransferPlanLimits | null;
  refreshKey: number;
  /** Première liste déjà chargée par l'écran (getTransferHome) : affichée sans nouvel appel. */
  initial?: { scope: TransferFilters["scope"]; rows: TransferRow[] };
}) {
  // Lien d'une notification « transfert partagé » (/?app=transfer&openTransfer=<id>) : fiche ouverte dans « Partagés avec moi ».
  const [linked] = useState(readOpenTransferParam);
  const [scope, setScope] = useState<TransferFilters["scope"]>(initial?.scope ?? (linked ? "received" : isAdmin ? "all" : "mine"));
  const [period, setPeriod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<TransferFilters["status"]>("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TransferRow[] | null>(initial?.rows ?? null);
  const skipFirstLoad = useRef(!!initial);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(linked);
  useEffect(() => clearOpenTransferParam(), []);
  const [openMode, setOpenMode] = useState<DrawerMode>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const range = useMemo(() => (period === "custom" ? { from: from || undefined, to: to || undefined } : PERIODS.find((p) => p.id === period)!.range()), [period, from, to]);

  const load = useCallback(() => {
    listTransfers({ scope, status, ...range })
      .then((r) => {
        setRows(unwrap(r));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, [scope, status, range]);

  useEffect(() => {
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false;
      return;
    }
    load();
  }, [load, refreshKey]);

  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((t) => !needle || [t.title, t.senderEmail, t.senderName, t.code, ...t.recipients, ...t.forwardedTo].some((s) => s.toLowerCase().includes(needle)));
  const totals = shown.reduce((acc, t) => ({ bytes: acc.bytes + t.totalBytes, downloads: acc.downloads + t.downloadCount }), { bytes: 0, downloads: 0 });
  const open = rows?.find((t) => t.id === openId) ?? null;

  const openTransfer = (id: string, mode: DrawerMode = null) => {
    setOpenMode(mode);
    setOpenId(id);
  };

  // Actions rapides depuis la liste (sans ouvrir la fiche).
  const rowAction = async (key: string, fn: () => Promise<unknown>, done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setRowBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-btn bg-card p-0.5">
          {(
            [
              ...(isAdmin ? ([["all", "Tout le board"]] as const) : []),
              ["mine", "Envoyés"],
              ["received", "Partagés avec moi"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setScope(id)} className={`rounded-btn px-3 py-1.5 text-xs font-bold ${scope === id ? "bg-navy text-white" : "text-ink-3 hover:bg-hover"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-btn border border-line bg-card px-2.5 py-1.5">
          <Search size={13} className="text-ink-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, expéditeur, destinataire, suivi à…" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none" aria-label="Période">
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {period === "custom" && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none" aria-label="Du" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none" aria-label="Au" />
          </>
        )}
        <select value={status} onChange={(e) => setStatus(e.target.value as TransferFilters["status"])} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none" aria-label="Statut">
          <option value="">Tous les statuts</option>
          <option value="ready">Actifs</option>
          <option value="downloaded">Téléchargés</option>
          <option value="never">Jamais téléchargés</option>
          <option value="expired">Expirés</option>
          <option value="revoked">Supprimés</option>
          <option value="uploading">Envois en cours</option>
        </select>
      </div>

      {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
      {notice && <p className="rounded-btn bg-good-bg px-3 py-2 text-sm text-good">{notice}</p>}

      <div className="overflow-hidden rounded-card border border-line bg-card">
        <div className="flex items-center justify-between border-b border-line bg-head px-4 py-2 text-xs text-ink-3">
          <span>
            {shown.length} transfert{shown.length > 1 ? "s" : ""} · {formatBytes(totals.bytes)} · {totals.downloads} téléchargement{totals.downloads > 1 ? "s" : ""}
          </span>
          {rows === null && <Loader2 size={14} className="animate-spin" />}
        </div>
        {rows !== null && shown.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-ink-4">
            <Send size={28} className="mx-auto mb-2 opacity-50" />
            {scope === "received" ? "Aucun transfert partagé avec vous pour ces filtres." : "Aucun transfert pour ces filtres."}
          </div>
        )}
        <ul className="divide-y divide-line">
          {shown.map((t) => (
            <li key={t.id} className="flex items-center hover:bg-hover">
              <button onClick={() => openTransfer(t.id)} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-ink">{t.title || `${t.fileCount} fichier${t.fileCount > 1 ? "s" : ""}`}</p>
                    <span className={`shrink-0 rounded-chip px-2 py-0.5 text-[10px] font-bold ${STATUS_META[t.status].tone}`}>{STATUS_META[t.status].label}</span>
                    {t.archived && <Archive size={12} className="shrink-0 text-ink-4" aria-label="Archivé" />}
                    {/* Joint à une carte : logo Espace Team en rouge, ouvre la carte. */}
                    {t.cards.length > 0 && (
                      <span className="shrink-0 text-red">
                        <TeamCardGlyph cards={t.cards} size={14} />
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-3">
                    {scope === "received" ? (
                      <>
                        {t.sharedBy ? (
                          <>
                            Partagé par <b className="font-semibold text-ink-2">{t.sharedBy}</b> · envoyé par {t.senderName || t.senderEmail}
                          </>
                        ) : (
                          <>
                            Reçu de <b className="font-semibold text-ink-2">{t.senderName || t.senderEmail}</b>
                          </>
                        )}
                        {t.recipients.length > 0 && <> → {t.recipients.join(", ")}</>}
                      </>
                    ) : (
                      <>
                        {scope === "all" && <b className="font-semibold text-ink-2">{t.senderName || t.senderEmail} → </b>}
                        {t.recipients.length ? t.recipients.join(", ") : "Lien partagé"}
                      </>
                    )}
                  </p>
                  {t.forwardedTo.length > 0 && (
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-ink-4" title={t.forwardedTo.join(", ")}>
                      <Forward size={11} className="shrink-0" /> <span className="truncate">Suivi à {t.forwardedTo.join(", ")}</span>
                    </p>
                  )}
                </div>
                <div className="hidden shrink-0 text-right text-xs text-ink-3 sm:block">
                  <p>
                    {t.fileCount} fichier{t.fileCount > 1 ? "s" : ""} · {formatBytes(t.totalBytes)}
                  </p>
                  <p className="text-ink-4">
                    Envoyé le {shortDate(t.createdAt)} ·{" "}
                    {!t.expiresAt
                      ? "sans expiration"
                      : `${new Date(t.expiresAt).getTime() < Date.now() ? "expiré" : "expire"} le ${shortDate(t.expiresAt)}`}
                  </p>
                </div>
                <span className="flex w-24 shrink-0 items-center justify-end gap-3 text-xs font-bold text-ink">
                  <span className="flex items-center gap-1" title="Ouvertures du lien">
                    <Eye size={12} /> {t.viewCount}
                  </span>
                  <span className="flex items-center gap-1" title="Téléchargements">
                    <Download size={12} /> {t.downloadCount}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5 pr-3">
                {t.status === "ready" && <RowButton icon={Forward} label="Faire suivre (membres du board ou e-mail)" onClick={() => openTransfer(t.id, "forward")} />}
                {t.status === "ready" && <RowButton icon={Kanban} label="Joindre à une carte" onClick={() => openTransfer(t.id, "card")} />}
                {t.canManage && t.status === "ready" && t.recipients.length > 0 && (
                  <RowButton
                    icon={Mail}
                    label="Renvoyer l'e-mail aux destinataires"
                    busy={rowBusy === `resend-${t.id}`}
                    onClick={() => rowAction(`resend-${t.id}`, async () => unwrap(await resendTransfer(t.id)), `E-mail renvoyé à ${t.recipients.length} destinataire${t.recipients.length > 1 ? "s" : ""}.`)}
                  />
                )}
                {t.canManage && <RowButton icon={Pencil} label="Modifier" onClick={() => openTransfer(t.id, "edit")} />}
                {t.canManage && (
                  <RowButton
                    icon={Trash2}
                    label="Supprimer"
                    danger
                    busy={rowBusy === `delete-${t.id}`}
                    onClick={() =>
                      rowAction(
                        `delete-${t.id}`,
                        async () => unwrap(await deleteTransfer(t.id)),
                        "Transfert supprimé.",
                        `Supprimer « ${t.title || "ce transfert"} » ? Le lien est coupé${t.archived ? "" : " et les fichiers envoyés sont supprimés définitivement du Drive"}.`
                      )
                    }
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Clé : fiche rechargée à neuf quand on change de transfert ou que son statut change. */}
      {open && (
        <TransferDrawer
          key={`${open.id}-${open.status}`}
          t={open}
          isAdmin={isAdmin}
          plan={plan}
          startMode={openMode}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onDeleted={() => {
            setOpenId(null);
            setNotice("Transfert supprimé.");
            load();
          }}
        />
      )}
    </div>
  );
}

type EditDraft = { title: string; message: string; recipients: string; notifyAdded: boolean };

function TransferDrawer({
  t,
  isAdmin,
  plan,
  startMode,
  onClose,
  onChanged,
  onDeleted,
}: {
  t: TransferRow;
  isAdmin: boolean;
  plan: TransferPlanLimits | null;
  startMode: DrawerMode;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<TransferDetail["files"][number] | null>(null);
  const [extendDays, setExtendDays] = useState<string>("7");
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forward, setForward] = useState<ForwardDraft | null>(startMode === "forward" ? EMPTY_FORWARD : null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [linking, setLinking] = useState(startMode === "card");
  const [linkedCard, setLinkedCard] = useState<{ id: string; title: string } | null>(null);
  const { open: openCard } = useOpenTeamCard();
  const body = useRef<HTMLDivElement>(null);

  const reloadDetail = () => getTransferDetail(t.id).then((r) => r.ok && setDetail(r.data));

  const sendForward = async () => {
    if (!forward) return;
    setBusy("forward");
    setError(null);
    setNotice(null);
    try {
      const res = unwrap(await forwardTransfer(t.id, { memberIds: forward.members.map((m) => m.id), emails: forward.to.split(/[\s,;]+/).filter(Boolean), note: forward.note }));
      setForward(null);
      setNotice(
        [
          res.members ? `Partagé avec ${res.members} membre${res.members > 1 ? "s" : ""} du board (notifié${res.members > 1 ? "s" : ""})` : "",
          res.emails ? `lien envoyé à ${res.emails} adresse${res.emails > 1 ? "s" : ""}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
          .replace(/^./, (c) => c.toUpperCase()) + "."
      );
      void reloadDetail();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setBusy(null);
    }
  };

  // Annuaire chargé à la première ouverture de « Faire suivre ».
  useEffect(() => {
    if (!forward || people) return;
    void listTransferPeople().then((r) => setPeople(r.ok ? r.data : []));
  }, [forward, people]);

  const startEdit = (d: TransferDetail) => setDraft({ title: t.title, message: d.message, recipients: t.recipients.join(", "), notifyAdded: true });

  useEffect(() => {
    getTransferDetail(t.id)
      .then((r) => {
        const d = unwrap(r);
        setDetail(d);
        // Ouvert depuis le bouton « Modifier » de la liste : formulaire prêt (message connu).
        if (startMode === "edit" && t.canManage) setDraft({ title: t.title, message: d.message, recipients: t.recipients.join(", "), notifyAdded: true });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargé une fois par transfert (la clé du tiroir change sinon)
  }, [t.id]);

  const saveEdit = async () => {
    if (!draft) return;
    setBusy("edit");
    setError(null);
    setNotice(null);
    try {
      const res = unwrap(
        await updateTransfer(t.id, {
          title: draft.title,
          message: draft.message,
          recipients: draft.recipients.split(/[\s,;]+/).filter(Boolean),
          notifyAdded: draft.notifyAdded,
        })
      );
      setDetail((d) => d && { ...d, message: draft.message.trim() });
      setDraft(null);
      setNotice(res.notified ? `Enregistré — e-mail envoyé à ${res.notified} nouveau${res.notified > 1 ? "x" : ""} destinataire${res.notified > 1 ? "s" : ""}.` : "Modifications enregistrées.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(null);
    }
  };

  const run = async (key: string, fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(null);
    }
  };

  const active = t.status === "ready";
  // Durées proposées : selon sa formule, ou libres pour un admin.
  const choices = durationChoices(isAdmin ? null : (plan?.maxDays ?? 7));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-lg flex-col bg-card shadow-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Détail du transfert">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <div className="min-w-0 flex-1">
            <span className={`rounded-chip px-2 py-0.5 text-[10px] font-bold ${STATUS_META[t.status].tone}`}>{STATUS_META[t.status].label}</span>
            <p className="mt-1.5 text-base font-extrabold text-ink">{t.title || `${t.fileCount} fichier${t.fileCount > 1 ? "s" : ""}`}</p>
            <p className="text-xs text-ink-3">
              Par {t.senderName || t.senderEmail} {t.senderName && `(${t.senderEmail})`} · {dateTime(t.createdAt)} · {t.source === "board" ? "depuis le board" : "page publique"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink-3 hover:bg-hover" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div ref={body} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {notice && <p className="rounded-btn bg-good-bg px-3 py-2 text-xs text-good">{notice}</p>}
          {draft && (
            <section className="space-y-2 rounded-card border border-line-strong p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-4">Modifier le transfert</h3>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                maxLength={200}
                placeholder="Titre"
                aria-label="Titre"
                className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-line-strong"
              />
              <textarea
                value={draft.message}
                onChange={(e) => setDraft({ ...draft, message: e.target.value })}
                maxLength={5000}
                rows={3}
                placeholder="Message"
                aria-label="Message"
                className="w-full resize-none rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-line-strong"
              />
              <textarea
                value={draft.recipients}
                onChange={(e) => setDraft({ ...draft, recipients: e.target.value })}
                rows={2}
                placeholder="Destinataires (séparés par une virgule)"
                aria-label="Destinataires"
                className="w-full resize-none rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-line-strong"
              />
              {t.status === "ready" && (
                <label className="flex items-center gap-1.5 text-xs text-ink-2">
                  <input type="checkbox" checked={draft.notifyAdded} onChange={(e) => setDraft({ ...draft, notifyAdded: e.target.checked })} /> Envoyer l&rsquo;e-mail aux destinataires ajoutés
                </label>
              )}
              <div className="flex gap-2">
                <button onClick={() => void saveEdit()} disabled={busy === "edit"} className="flex items-center gap-1.5 rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
                  {busy === "edit" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Enregistrer
                </button>
                <button onClick={() => setDraft(null)} className="rounded-btn px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover">
                  Annuler
                </button>
              </div>
            </section>
          )}
          {/* Sélecteur de carte : en haut du contenu, déroulé vers le bas (le pied de fiche est en bas d'écran). */}
          <div className="relative h-0">
            <LinkTransferToCardPopover
              open={linking}
              onClose={() => setLinking(false)}
              transfer={{ id: t.id, title: t.title }}
              onDone={(message, card) => {
                setNotice(message);
                setLinkedCard(card);
                if (card) void reloadDetail();
              }}
            />
          </div>
          {linkedCard && (
            <button onClick={() => openCard(linkedCard.id)} className="flex w-full items-center gap-1.5 rounded-btn bg-sel-bg px-3 py-2 text-left text-xs font-bold text-link hover:opacity-90">
              <Kanban size={13} /> Ouvrir la carte « {linkedCard.title} »
            </button>
          )}
          {forward && (
            <section className="space-y-2 rounded-card border border-line-strong p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-4">Faire suivre</h3>
              <div className="rounded-btn border border-line bg-card px-2 py-1.5 focus-within:border-line-strong">
                <div className="flex flex-wrap items-center gap-1">
                  {forward.members.map((m) => (
                    <span key={m.id} className="flex items-center gap-1 rounded-chip bg-sel-bg px-2 py-0.5 text-xs font-semibold text-link">
                      {m.name}
                      <button onClick={() => setForward({ ...forward, members: forward.members.filter((x) => x.id !== m.id) })} aria-label={`Retirer ${m.name}`}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    autoFocus
                    value={forward.query}
                    onChange={(e) => setForward({ ...forward, query: e.target.value })}
                    placeholder={forward.members.length ? "Ajouter un membre…" : "Membres du board (ex. Ianis)…"}
                    aria-label="Membres du board"
                    className="min-w-[140px] flex-1 bg-transparent py-0.5 text-sm outline-none"
                  />
                </div>
                {forward.query.trim() && (
                  <ul className="mt-1 max-h-40 overflow-y-auto border-t border-line pt-1">
                    {people === null && <li className="px-1 py-1 text-xs text-ink-4">Chargement…</li>}
                    {(people ?? [])
                      .filter((p) => !forward.members.some((m) => m.id === p.id) && `${p.name} ${p.email}`.toLowerCase().includes(forward.query.trim().toLowerCase()))
                      .slice(0, 6)
                      .map((p) => (
                        <li key={p.id}>
                          <button
                            onClick={() => setForward({ ...forward, members: [...forward.members, p], query: "" })}
                            className="flex w-full items-center justify-between gap-2 rounded-btn px-1.5 py-1 text-left text-sm hover:bg-hover"
                          >
                            <span className="truncate text-ink-2">{p.name}</span>
                            <span className="truncate text-[11px] text-ink-4">{p.email}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
              <textarea
                value={forward.to}
                onChange={(e) => setForward({ ...forward, to: e.target.value })}
                rows={2}
                placeholder="Et/ou des adresses e-mail extérieures (séparées par une virgule)"
                aria-label="Adresses"
                className="w-full resize-none rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-line-strong"
              />
              <textarea
                value={forward.note}
                onChange={(e) => setForward({ ...forward, note: e.target.value })}
                maxLength={2000}
                rows={3}
                placeholder="Un mot (facultatif) — ex. « Ianis, peux-tu reprendre ces visuels ? »"
                aria-label="Message"
                className="w-full resize-none rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-line-strong"
              />
              <p className="text-[11px] text-ink-4">
                Les membres le retrouvent dans « Partagés avec moi » et reçoivent une notification ; les adresses extérieures reçoivent le lien par e-mail
                {t.mine ? "" : ` (envoyé par ${t.senderName || t.senderEmail})`}. Valable {t.expiresAt ? `jusqu'au ${shortDate(t.expiresAt)}` : "sans limite"}.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => void sendForward()}
                  disabled={busy === "forward" || (!forward.members.length && !forward.to.trim())}
                  className="flex items-center gap-1.5 rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                >
                  {busy === "forward" ? <Loader2 size={13} className="animate-spin" /> : <Forward size={13} />} Faire suivre
                </button>
                <button onClick={() => setForward(null)} className="rounded-btn px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover">
                  Annuler
                </button>
              </div>
            </section>
          )}
          <div className="flex items-center gap-2 rounded-btn border border-line bg-subtle px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.link}</span>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(t.link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-btn p-1.5 text-ink-3 hover:bg-hover"
              aria-label="Copier le lien"
            >
              {copied ? <Check size={15} className="text-good" /> : <Copy size={15} />}
            </button>
            <a href={t.link} target="_blank" rel="noopener" className="rounded-btn p-1.5 text-ink-3 hover:bg-hover" aria-label="Ouvrir la page du transfert">
              <ExternalLink size={15} />
            </a>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Info label="Destinataires" value={t.recipients.length ? t.recipients.join(", ") : "Lien partagé"} icon={Users} wide />
            <Info label="Expiration" wide value={t.expiresAt ? dateTime(t.expiresAt) : "Aucune"} icon={CalendarClock} />
            <Info label="Ouvertures du lien" value={String(t.viewCount)} icon={Eye} />
            <Info label="Téléchargements" value={`${t.downloadCount}${t.lastDownloadAt ? ` · dernier ${shortDate(t.lastDownloadAt)}` : ""}`} icon={Download} />
          </dl>

          {detail?.message && <p className="whitespace-pre-line rounded-btn bg-subtle px-3 py-2 text-sm text-ink-2">{detail.message}</p>}

          <section>
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-4">Fichiers · {formatBytes(t.totalBytes)}</h3>
            {!detail && !error && <Loader2 size={16} className="animate-spin text-ink-4" />}
            <ul className="divide-y divide-line rounded-btn border border-line">
              {detail?.files.map((f) => (
                <li key={f.id} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-sel-bg text-link">
                    <KindIcon kind={fileKind(f.mimeType, f.name)} size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{f.name}</p>
                    <p className="text-[11px] text-ink-4">
                      {formatBytes(f.size)} · {f.downloadCount} téléch.{f.fromBoardDrive && " · Drive du board"}
                    </p>
                  </div>
                  {f.preview.kind !== "none" && (
                    <button onClick={() => setPreview(f)} className="rounded-full p-1.5 text-ink-3 hover:bg-hover" aria-label={`Aperçu de ${f.name}`} title="Aperçu">
                      <Eye size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {detail && detail.downloads.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-4">Historique des téléchargements</h3>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-ink-3">
                {detail.downloads.map((d, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="truncate">{d.fileName ?? "—"}</span>
                    <span className="shrink-0 text-ink-4">{dateTime(d.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail && detail.cards.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-4">Joint aux cartes</h3>
              <div className="flex flex-wrap gap-1.5">
                {detail.cards.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openCard(c.id)}
                    className="flex max-w-full items-center gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:border-link hover:bg-sel-bg hover:text-link"
                  >
                    <Kanban size={12} /> <span className="truncate">{c.title}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {detail && detail.forwards.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-4">Fait suivre</h3>
              <ul className="space-y-1.5 text-xs text-ink-3">
                {detail.forwards.map((f, i) => (
                  <li key={i}>
                    <span className="text-ink-2">
                      {f.by} → {f.recipients.join(", ")}
                    </span>
                    <span className="text-ink-4"> · {dateTime(f.at)}</span>
                    {f.note && <p className="mt-0.5 whitespace-pre-line text-ink-4">« {f.note} »</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-xs text-bad">{error}</p>}
        </div>

        <div className="space-y-2 border-t border-line p-4">
          {active && (
            <div className="flex flex-wrap gap-2">
              {!forward && <Action icon={Forward} label="Faire suivre" onClick={() => setForward(EMPTY_FORWARD)} />}
              <Action
                icon={Kanban}
                label="Joindre à une carte"
                onClick={() => {
                  body.current?.scrollTo({ top: 0, behavior: "smooth" });
                  setLinking(true);
                }}
              />
            </div>
          )}
          {t.canManage && active && (
            <div className="flex flex-wrap items-center gap-2">
              <select value={extendDays} onChange={(e) => setExtendDays(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-xs outline-none" aria-label="Nouvelle durée">
                {choices.map((d) => (
                  <option key={d ?? "none"} value={d === null ? "none" : String(d)}>
                    {durationLabel(d)}
                  </option>
                ))}
              </select>
              <Action
                icon={CalendarClock}
                label="Prolonger"
                busy={busy === "extend"}
                onClick={() => run("extend", async () => unwrap(await extendTransfer(t.id, extendDays === "none" ? null : Number(extendDays))))}
              />
              {t.recipients.length > 0 && <Action icon={Mail} label="Renvoyer l'e-mail" busy={busy === "resend"} onClick={() => run("resend", async () => unwrap(await resendTransfer(t.id)))} />}
            </div>
          )}
          {t.canManage && (
          <div className="flex flex-wrap gap-2">
            {!draft && <Action icon={Pencil} label="Modifier" busy={!detail} onClick={() => detail && startEdit(detail)} />}
            {(active || t.status === "uploading") && (
              <Action
                icon={Archive}
                label={t.archived ? "Ne plus archiver" : "Archiver dans le Drive"}
                busy={busy === "archive"}
                onClick={() => run("archive", async () => unwrap(await setTransferArchived(t.id, !t.archived)))}
              />
            )}
            {isAdmin && detail?.driveFolderUrl && (
              <a href={detail.driveFolderUrl} target="_blank" rel="noopener" className="flex items-center gap-1.5 rounded-btn bg-chip-bg px-3 py-1.5 text-xs font-bold text-ink-2 hover:bg-hover">
                <FolderOpen size={13} /> Ouvrir dans le Drive
              </a>
            )}
            {(active || t.status === "uploading") && (
              <Action
                icon={Ban}
                label="Couper le lien"
                danger
                busy={busy === "revoke"}
                onClick={() =>
                  run(
                    "revoke",
                    async () => unwrap(await revokeTransfer(t.id)),
                    t.archived ? "Couper le lien ? Les fichiers restent archivés dans le Drive." : "Couper le lien ? Les fichiers envoyés seront supprimés définitivement du Drive."
                  )
                }
              />
            )}
            <Action
              icon={Trash2}
              label="Supprimer"
              danger
              busy={busy === "delete"}
              onClick={async () => {
                if (!window.confirm(`Supprimer définitivement ce transfert ? Il disparaît de la liste et des statistiques${t.archived ? "" : " ; les fichiers envoyés sont supprimés définitivement du Drive"}.`)) return;
                setBusy("delete");
                try {
                  unwrap(await deleteTransfer(t.id));
                  onDeleted();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Suppression impossible.");
                  setBusy(null);
                }
              }}
            />
          </div>
          )}
        </div>
      </aside>

      {preview && <RemotePreviewModal file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function Info({ label, value, icon: Icon, wide }: { label: string; value: string; icon: typeof Users; wide?: boolean }) {
  return (
    <div className={`rounded-btn bg-subtle px-3 py-2 ${wide ? "col-span-2" : ""}`}>
      <dt className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ink-4">
        <Icon size={11} /> {label}
      </dt>
      <dd className="mt-0.5 break-words text-ink">{value}</dd>
    </div>
  );
}

function RowButton({ icon: Icon, label, onClick, busy, danger }: { icon: typeof Ban; label: string; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className={`rounded-full p-2 disabled:opacity-60 ${danger ? "text-ink-4 hover:bg-bad-bg hover:text-bad" : "text-ink-4 hover:bg-card hover:text-ink"}`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
    </button>
  );
}

function Action({ icon: Icon, label, onClick, busy, danger }: { icon: typeof Ban; label: string; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-bold disabled:opacity-60 ${danger ? "bg-bad-bg text-bad hover:opacity-90" : "bg-chip-bg text-ink-2 hover:bg-hover"}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {label}
    </button>
  );
}
