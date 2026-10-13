"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Copy, Check, ExternalLink, Eye, Download, Loader2, X, Mail, Ban, Archive, CalendarClock, FolderOpen, Send, Users } from "lucide-react";
import { unwrap } from "@/lib/board/actionResult";
import { durationChoices, durationLabel, fileKind, formatBytes, type TransferPlanLimits } from "@/lib/transfer/shared";
import { KindIcon, RemotePreviewModal } from "@/components/transfer/FilePreview";
import {
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

// Onglet « Transferts » : tous ses transferts (tous ceux du board pour les admins), filtres par
// période, statut et recherche ; fiche détaillée avec aperçu, historique des téléchargements, actions.

const STATUS_META: Record<TransferStatus, { label: string; tone: string }> = {
  ready: { label: "Actif", tone: "bg-good-bg text-good" },
  uploading: { label: "Envoi en cours", tone: "bg-warn-bg text-warn" },
  expired: { label: "Expiré", tone: "bg-chip-bg text-ink-3" },
  revoked: { label: "Supprimé", tone: "bg-bad-bg text-bad" },
};

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const PERIODS: { id: string; label: string; range: () => { from?: string; to?: string } }[] = [
  { id: "all", label: "Toutes les dates", range: () => ({}) },
  { id: "7", label: "7 derniers jours", range: () => ({ from: iso(new Date(Date.now() - 6 * 86400_000)) }) },
  { id: "30", label: "30 derniers jours", range: () => ({ from: iso(new Date(Date.now() - 29 * 86400_000)) }) },
  { id: "month", label: "Ce mois-ci", range: () => ({ from: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) }) },
  { id: "year", label: "Cette année", range: () => ({ from: `${new Date().getFullYear()}-01-01` }) },
  { id: "custom", label: "Période…", range: () => ({}) },
];

const dateTime = (s: string) => new Date(s).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const shortDate = (s: string) => new Date(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export function TransferList({ isAdmin, plan, refreshKey }: { isAdmin: boolean; plan: TransferPlanLimits | null; refreshKey: number }) {
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [period, setPeriod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<TransferFilters["status"]>("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TransferRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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
    load();
  }, [load, refreshKey]);

  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((t) => !needle || [t.title, t.senderEmail, t.senderName, t.code, ...t.recipients].some((s) => s.toLowerCase().includes(needle)));
  const totals = shown.reduce((acc, t) => ({ bytes: acc.bytes + t.totalBytes, downloads: acc.downloads + t.downloadCount }), { bytes: 0, downloads: 0 });
  const open = rows?.find((t) => t.id === openId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && (
          <div className="flex rounded-btn bg-card p-0.5">
            {(
              [
                ["all", "Tout le board"],
                ["mine", "Les miens"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} onClick={() => setScope(id)} className={`rounded-btn px-3 py-1.5 text-xs font-bold ${scope === id ? "bg-navy text-white" : "text-ink-3 hover:bg-hover"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-btn border border-line bg-card px-2.5 py-1.5">
          <Search size={13} className="text-ink-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, expéditeur, destinataire…" className="w-full bg-transparent text-sm outline-none" />
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
            Aucun transfert pour ces filtres.
          </div>
        )}
        <ul className="divide-y divide-line">
          {shown.map((t) => (
            <li key={t.id}>
              <button onClick={() => setOpenId(t.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-ink">{t.title || `${t.fileCount} fichier${t.fileCount > 1 ? "s" : ""}`}</p>
                    <span className={`shrink-0 rounded-chip px-2 py-0.5 text-[10px] font-bold ${STATUS_META[t.status].tone}`}>{STATUS_META[t.status].label}</span>
                    {t.archived && <Archive size={12} className="shrink-0 text-ink-4" aria-label="Archivé" />}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-3">
                    {scope === "all" && <b className="font-semibold text-ink-2">{t.senderName || t.senderEmail} → </b>}
                    {t.recipients.length ? t.recipients.join(", ") : "Lien partagé"}
                  </p>
                </div>
                <div className="hidden shrink-0 text-right text-xs text-ink-3 sm:block">
                  <p>
                    {t.fileCount} fichier{t.fileCount > 1 ? "s" : ""} · {formatBytes(t.totalBytes)}
                  </p>
                  <p className="text-ink-4">{shortDate(t.createdAt)}</p>
                </div>
                <span className="flex w-14 shrink-0 items-center justify-end gap-1 text-xs font-bold text-ink" title="Téléchargements">
                  <Download size={12} /> {t.downloadCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Clé : fiche rechargée à neuf quand on change de transfert ou que son statut change. */}
      {open && <TransferDrawer key={`${open.id}-${open.status}`} t={open} isAdmin={isAdmin} plan={plan} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function TransferDrawer({ t, isAdmin, plan, onClose, onChanged }: { t: TransferRow; isAdmin: boolean; plan: TransferPlanLimits | null; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<TransferDetail["files"][number] | null>(null);
  const [extendDays, setExtendDays] = useState<string>("7");

  useEffect(() => {
    getTransferDetail(t.id)
      .then((r) => setDetail(unwrap(r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, [t.id]);

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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
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
            <Info label="Expiration" value={t.expiresAt ? dateTime(t.expiresAt) : "Aucune"} icon={CalendarClock} />
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

          {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-xs text-bad">{error}</p>}
        </div>

        <div className="space-y-2 border-t border-line p-4">
          {active && (
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
          <div className="flex flex-wrap gap-2">
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
                    t.archived ? "Couper le lien ? Les fichiers restent archivés dans le Drive." : "Couper le lien ? Les fichiers envoyés iront à la corbeille du Drive."
                  )
                }
              />
            )}
          </div>
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
