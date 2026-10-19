"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Copy, Download, ExternalLink, Eye, Kanban, Loader2, Plus, Search, Send, X } from "lucide-react";
import { listTransfers, type TransferRow } from "@/app/actions/transfers";
import { getTeamWorkspace } from "@/app/actions/team";
import { searchLinkableTeamCards } from "@/app/actions/team-emails";
import { copyTeamCardTransferFiles, linkTransferToTeamCard, listTeamCardTransfers, unlinkTeamCardTransfer, type TeamCardTransfer, type TeamCardTransferFile } from "@/app/actions/team-transfers";
import { unwrap } from "@/lib/board/actionResult";
import type { TeamPerson, TeamWorkspace } from "@/lib/board/team";
import { formatBytes } from "@/lib/transfer/shared";
import { NewCardDialog } from "./NewCardDialog";
import { PreviewModal } from "./TeamAttachments";
import { Popover } from "./TeamUi";

// Transferts LGEF Transfer joints à une carte (voir team-transfers.ts) : on joint depuis la fiche
// carte (ses transferts envoyés ou reçus) ou depuis l'onglet LGEF Transfer (LinkTransferToCardPopover,
// carte existante ou nouvelle carte). Les fichiers sont copiés dans les pièces jointes de la carte.

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

type LinkResult = { alreadyLinked: boolean; copied: number; failed: string[] };

/** Message de fin de liaison, à afficher. */
export const transferLinkNotice = (r: LinkResult, cardTitle: string) =>
  r.alreadyLinked
    ? `Ce transfert est déjà joint à « ${cardTitle} ».`
    : r.failed.length
      ? `Joint à « ${cardTitle} », mais fichiers non copiés : ${r.failed.join(", ")}.`
      : `Joint à « ${cardTitle} »${r.copied ? ` — ${r.copied} fichier${r.copied > 1 ? "s" : ""} copié${r.copied > 1 ? "s" : ""} dans la carte` : ""}.`;

export function TeamTransfers({
  cardId,
  canEdit,
  me,
  people,
  onLinked,
  onError,
}: {
  cardId: string;
  canEdit: boolean;
  me: string;
  people: TeamPerson[];
  /** Transfert joint : pièces jointes et discussion à recharger. */
  onLinked: () => void;
  onError: (m: string) => void;
}) {
  const [rows, setRows] = useState<TeamCardTransfer[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [preview, setPreview] = useState<TeamCardTransferFile | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(unwrap(await listTeamCardTransfers(cardId)));
    } catch {
      // Table pas encore créée (migration non appliquée) : la section reste discrète.
      setRows([]);
    }
  }, [cardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load();
  }, [load]);

  const copyNow = async (r: TeamCardTransfer) => {
    setBusy(true);
    try {
      const res = unwrap(await copyTeamCardTransferFiles(r.id));
      if (res.failed.length) onError(`Fichiers non copiés : ${res.failed.join(", ")}.`);
      if (res.copied) onLinked();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Copie impossible.");
    }
    setBusy(false);
    await load();
  };

  const unlink = async (r: TeamCardTransfer) => {
    if (!window.confirm(`Délier « ${r.title || "ce transfert"} » de la carte ? (les fichiers copiés restent dans la carte)`)) return;
    setRows((list) => list?.filter((x) => x.id !== r.id) ?? null);
    try {
      unwrap(await unlinkTeamCardTransfer(r.id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Impossible de délier.");
    }
    await load();
  };

  if (!canEdit && !rows?.length) return null;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Send size={16} className="text-ink-3" />
        <h3 className="flex-1 text-sm font-extrabold text-ink">LGEF Transfer</h3>
        {(rows === null || busy) && <Loader2 size={13} className="animate-spin text-ink-4" />}
      </div>
      <ul className="space-y-2">
        {rows?.map((r) => {
          const expanded = openRow === r.id;
          return (
            <li key={r.id} className="group rounded-btn border border-line bg-card">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <button onClick={() => setOpenRow(expanded ? null : r.id)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-sel-bg text-link">
                    <Send size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink">{r.title || `${r.fileCount} fichier${r.fileCount > 1 ? "s" : ""}`}</p>
                    <p className="truncate text-[11px] text-ink-4">
                      {[
                        `de ${r.sender}`,
                        `${r.fileCount} fichier${r.fileCount > 1 ? "s" : ""} · ${formatBytes(r.totalBytes)}`,
                        r.files.length ? "copiés dans la carte" : "",
                        !r.live ? "lien supprimé" : r.live.active ? (r.live.expiresAt ? `lien jusqu'au ${shortDate(r.live.expiresAt)}` : "lien sans expiration") : "lien expiré",
                        `joint par ${people.find((p) => p.id === r.linkedBy)?.name ?? "—"}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <ChevronDown size={15} className={`shrink-0 text-ink-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
                {r.live?.active && (
                  <a href={r.link} target="_blank" rel="noopener" className="rounded-full p-1.5 text-ink-3 hover:bg-hover" aria-label="Ouvrir la page du transfert" title="Ouvrir la page du transfert">
                    <ExternalLink size={14} />
                  </a>
                )}
                {(canEdit || r.linkedBy === me) && (
                  <button onClick={() => void unlink(r)} aria-label={`Délier ${r.title}`} className="hidden text-ink-4 hover:text-bad group-hover:block">
                    <X size={14} />
                  </button>
                )}
              </div>
              {expanded && (
                <div className="border-t border-line px-3 py-2">
                  {r.files.length > 0 ? (
                    <>
                      <ul className="divide-y divide-line">
                        {r.files.map((f) => (
                          <li key={f.id} className="flex items-center gap-2 py-1.5">
                            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{f.name}</span>
                            <span className="shrink-0 text-[11px] text-ink-4">{formatBytes(f.size)}</span>
                            <button onClick={() => setPreview(f)} title="Aperçu" aria-label={`Aperçu de ${f.name}`} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
                              <Eye size={14} />
                            </button>
                            <a href={fileHref(cardId, f)} title="Télécharger" aria-label={`Télécharger ${f.name}`} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
                              <Download size={14} />
                            </a>
                          </li>
                        ))}
                      </ul>
                      {r.files.length > 1 && <DownloadAll cardId={cardId} files={r.files} />}
                    </>
                  ) : r.live?.active ? (
                    <div className="flex flex-wrap items-center gap-2 py-1">
                      <p className="flex-1 text-[12px] text-ink-4">Fichiers non copiés dans la carte : ils disparaissent à l&rsquo;expiration du lien.</p>
                      {canEdit && (
                        <button
                          disabled={busy}
                          onClick={() => void copyNow(r)}
                          className="flex items-center gap-1.5 rounded-btn bg-chip-bg px-2.5 py-1.5 text-[12px] font-bold text-ink-2 hover:bg-hover disabled:opacity-50"
                        >
                          <Copy size={12} /> Copier dans la carte
                        </button>
                      )}
                      <a href={r.link} target="_blank" rel="noopener" className="flex items-center gap-1.5 rounded-btn bg-chip-bg px-2.5 py-1.5 text-[12px] font-bold text-ink-2 hover:bg-hover">
                        <ExternalLink size={12} /> Voir et télécharger
                      </a>
                    </div>
                  ) : (
                    <p className="py-1 text-[12px] text-ink-4">Fichiers non copiés dans la carte et lien expiré : plus disponibles.</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="relative mt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setPicking(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-btn border border-dashed border-line-strong px-3 py-2.5 text-[13px] font-semibold text-ink-3 hover:text-ink disabled:opacity-50"
          >
            <Send size={14} /> Joindre un transfert
          </button>
          <div className="absolute left-1/2 top-full -translate-x-1/2">
            <TransferPicker
              open={picking}
              onClose={() => setPicking(false)}
              onPick={async (t, copyFiles) => {
                setPicking(false);
                setBusy(true);
                try {
                  const r = unwrap(await linkTransferToTeamCard(cardId, t.id, { copyFiles }));
                  if (r.alreadyLinked || r.failed.length) onError(transferLinkNotice(r, "cette carte"));
                  if (!r.alreadyLinked) onLinked();
                } catch (e) {
                  onError(e instanceof Error ? e.message : "Liaison impossible.");
                }
                setBusy(false);
                await load();
              }}
            />
          </div>
        </div>
      )}
      {preview && <PreviewModal cardId={cardId} file={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

const fileHref = (cardId: string, f: TeamCardTransferFile) => `/api/team/cards/${cardId}/attachments/${encodeURIComponent(f.id)}`;

/** « Tout télécharger » : un téléchargement après l'autre (le navigateur peut demander l'autorisation une fois), comme la page publique. */
function DownloadAll({ cardId, files }: { cardId: string; files: TeamCardTransferFile[] }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const run = async () => {
    setState("busy");
    for (const f of files) {
      const a = document.createElement("a");
      a.href = fileHref(cardId, f);
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 1200));
    }
    setState("done");
  };
  const total = files.reduce((n, f) => n + f.size, 0);
  return (
    <button
      onClick={() => void run()}
      disabled={state === "busy"}
      className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-btn bg-navy px-3 py-2 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-60"
    >
      {state === "busy" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
      {state === "done" ? "Téléchargements lancés" : `Tout télécharger (${files.length} fichiers · ${formatBytes(total)})`}
    </button>
  );
}

/** Mes transferts actifs, reçus puis envoyés, pour les joindre à la carte. */
function TransferPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: TransferRow, copyFiles: boolean) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<(TransferRow & { received: boolean })[] | null>(null);
  const [copyFiles, setCopyFiles] = useState(true);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all([listTransfers({ scope: "received", status: "ready" }), listTransfers({ scope: "mine", status: "ready" })]).then(([received, mine]) => {
      if (!alive) return;
      setRows([...(received.ok ? received.data.map((t) => ({ ...t, received: true })) : []), ...(mine.ok ? mine.data.map((t) => ({ ...t, received: false })) : [])]);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((t) => !needle || [t.title, t.senderName, t.senderEmail, ...t.recipients].some((s) => s.toLowerCase().includes(needle))).slice(0, 40);

  return (
    <Popover open={open} onClose={onClose} width={360}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Joindre un transfert actif</p>
      <div className="mb-2 flex items-center gap-1.5 rounded-btn border border-line px-2 py-1.5">
        <Search size={13} className="text-ink-4" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, expéditeur…" className="min-w-0 flex-1 text-[13px] outline-none" />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {rows === null && <p className="px-1.5 py-2 text-xs text-ink-4">Chargement…</p>}
        {rows !== null && shown.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-4">Aucun transfert actif reçu ou envoyé.</p>}
        {shown.map((t) => (
          <button key={t.id} onClick={() => void onPick(t, copyFiles)} className="flex w-full items-center gap-2 rounded-btn px-1.5 py-1.5 text-left hover:bg-hover">
            <Send size={14} className="shrink-0 text-ink-4" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink-2">{t.title || `${t.fileCount} fichier${t.fileCount > 1 ? "s" : ""}`}</span>
              <span className="block truncate text-[10px] text-ink-4">
                {t.received ? (t.sharedBy ? `Partagé par ${t.sharedBy}` : `Reçu de ${t.senderName || t.senderEmail}`) : `Envoyé à ${t.recipients.join(", ") || "lien partagé"}`} · {shortDate(t.createdAt)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <input type="checkbox" checked={copyFiles} onChange={(e) => setCopyFiles(e.target.checked)} />
        Copier les fichiers dans la carte (ils restent après l&rsquo;expiration du lien)
      </label>
    </Popover>
  );
}

/**
 * Depuis l'onglet LGEF Transfer : joindre le transfert à une carte existante (mes tableaux, mes
 * cartes assignées) ou à une nouvelle carte (titre du transfert, assignés au choix).
 */
export function LinkTransferToCardPopover({
  open,
  onClose,
  transfer,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  transfer: { id: string; title: string };
  /** Message à afficher, avec la carte pour l'ouvrir (null en cas d'échec). */
  onDone: (message: string, card: { id: string; title: string } | null) => void;
}) {
  const [q, setQ] = useState("");
  const [cards, setCards] = useState<{ id: string; title: string; boardTitle: string }[] | null>(null);
  const [copyFiles, setCopyFiles] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [ws, setWs] = useState<TeamWorkspace | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      const res = await searchLinkableTeamCards(q);
      if (alive) setCards(res.ok ? res.data : []);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, q]);

  const link = async (card: { id: string; title: string }) => {
    setBusy(card.id);
    try {
      const r = unwrap(await linkTransferToTeamCard(card.id, transfer.id, { copyFiles }));
      onDone(transferLinkNotice(r, card.title), card);
    } catch (e) {
      onDone(e instanceof Error ? e.message : "Liaison impossible.", null);
    }
    setBusy(null);
    onClose();
  };

  const startCreate = async () => {
    setBusy("new");
    try {
      setWs(unwrap(await getTeamWorkspace()));
      setCreating(true);
    } catch (e) {
      onDone(e instanceof Error ? e.message : "Espace Team indisponible.", null);
    }
    setBusy(null);
  };

  return (
    <>
      <Popover open={open && !creating} onClose={onClose} align="right" width={340}>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Joindre à une carte de l&rsquo;Espace Team</p>
        <button
          disabled={!!busy}
          onClick={() => void startCreate()}
          className="mb-2 flex w-full items-center gap-2 rounded-btn bg-sel-bg px-2 py-2 text-left text-[13px] font-semibold text-link hover:opacity-90 disabled:opacity-50"
        >
          {busy === "new" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Nouvelle carte (choisir qui s&rsquo;en occupe)
        </button>
        <div className="mb-2 flex items-center gap-1.5 rounded-btn border border-line px-2 py-1.5">
          <Search size={13} className="text-ink-4" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une carte…" className="min-w-0 flex-1 text-[13px] outline-none" />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {cards === null && <p className="px-1.5 py-2 text-xs text-ink-4">Recherche…</p>}
          {cards?.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-4">Aucune carte trouvée.</p>}
          {cards?.map((c) => (
            <button key={c.id} disabled={!!busy} onClick={() => void link(c)} className="flex w-full items-center gap-2 rounded-btn px-1.5 py-1.5 text-left hover:bg-hover disabled:opacity-50">
              {busy === c.id ? <Loader2 size={14} className="shrink-0 animate-spin text-ink-4" /> : <Kanban size={14} className="shrink-0 text-ink-4" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink-2">{c.title}</span>
                {c.boardTitle && <span className="block truncate text-[10px] text-ink-4">{c.boardTitle}</span>}
              </span>
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
          <input type="checkbox" checked={copyFiles} onChange={(e) => setCopyFiles(e.target.checked)} />
          Copier les fichiers dans la carte (ils restent après l&rsquo;expiration du lien)
        </label>
        <p className="mt-1 text-[10px] leading-snug text-ink-4">Un message dans la discussion de la carte prévient les personnes qui y sont assignées.</p>
      </Popover>
      {creating && ws && (
        <NewCardDialog
          ws={ws}
          myBoards={ws.boards.filter((b) => b.ownerId === ws.meId)}
          initial={{ title: transfer.title }}
          zClass="z-[90]"
          onClose={() => {
            setCreating(false);
            onClose();
          }}
          onCreated={async (id) => {
            setCreating(false);
            await link({ id, title: transfer.title || "Nouvelle carte" });
          }}
          onError={(m) => onDone(m, null)}
        />
      )}
    </>
  );
}
