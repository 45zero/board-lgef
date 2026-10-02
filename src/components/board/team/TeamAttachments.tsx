"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Eye, FolderSearch, Link2, Loader2, Paperclip, Search, Share2, Upload, X } from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import {
  attachTeamFileFromGed,
  deleteTeamAttachment,
  listTeamCardAttachments,
  queueTeamMediaForPublication,
  searchMyGedFiles,
  shareTeamAttachment,
  startTeamAttachmentUpload,
  type TeamAttachment,
} from "@/app/actions/team-attachments";
import { unwrap } from "@/lib/board/actionResult";
import { putFileToDriveViaRelay, uploadEventFiles } from "@/lib/board/eventFiles";
import { Popover } from "./TeamUi";

// Pièces jointes d'une carte. Le type de fichier décide (voir team-attachments.ts) : carte liée à un
// événement → fichiers de l'événement (documents ; photos/vidéos aussi « À publier ») ; sinon
// dossier de la carte, photos/vidéos proposées au centre de publication. Dépôt ou copie depuis la GED.

const CHUNK_RELAY = "/api/publications/drive/chunk";

const kind = (mime: string, name: string) => {
  const ext = name.split(".").pop()?.toUpperCase() ?? "";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "IMG";
  if (mime.startsWith("video/")) return "VID";
  if (ext.length >= 2 && ext.length <= 4) return ext;
  return "FIC";
};
const size = (n: number | null) => (n === null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1048576).toFixed(1).replace(".", ",")} Mo`);

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
type GedFile = { id: string; name: string; mimeType: string; size: number | null; modifiedTime: string };

export function TeamAttachments({
  cardId,
  canEdit,
  pickSignal,
  people,
  hasEvent,
  onError,
}: {
  cardId: string;
  canEdit: boolean;
  /** Carte liée à un événement (texte d'aide). */
  hasEvent: boolean;
  /** Suggestions d'adresses pour le partage (membres du board). */
  people: { name: string; email: string | null }[];
  /** Incrémenté par le bouton « Pièce jointe » de la colonne d'actions : ouvre le sélecteur de fichiers. */
  pickSignal: number;
  onError: (m: string) => void;
}) {
  const [state, setState] = useState<{ driveReady: boolean; files: TeamAttachment[] } | null>(null);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [gedOpen, setGedOpen] = useState(false);
  const [preview, setPreview] = useState<TeamAttachment | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setState(unwrap(await listTeamCardAttachments(cardId)));
    } catch (e) {
      setState({ driveReady: true, files: [] });
      onError(e instanceof Error ? e.message : "Pièces jointes indisponibles.");
    }
  }, [cardId, onError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load();
  }, [load]);

  useEffect(() => {
    if (pickSignal > 0) input.current?.click();
  }, [pickSignal]);

  const upload = async (files: File[]) => {
    for (const file of files) {
      try {
        setProgress({ name: file.name, pct: 0 });
        const pct = (sent: number) => setProgress({ name: file.name, pct: Math.round((sent / (file.size || 1)) * 100) });
        const start = unwrap(await startTeamAttachmentUpload(cardId, file.name, file.type));
        if (start.mode === "event") {
          const [result] = await uploadEventFiles(start.eventId, [file], (sent) => pct(sent), cardId);
          if (!result?.ok) throw new Error(result?.error ?? "envoi impossible.");
        } else {
          const driveFile = await putFileToDriveViaRelay(CHUNK_RELAY, start.uploadUrl, file, pct);
          if (/^(image|video)\//.test(file.type)) unwrap(await queueTeamMediaForPublication(cardId, driveFile.id));
        }
      } catch (e) {
        onError(`${file.name} : ${e instanceof Error ? e.message : "envoi impossible."}`);
      }
    }
    setProgress(null);
    await load();
  };

  const remove = async (f: TeamAttachment) => {
    if (!window.confirm(`Retirer « ${f.name} » de la carte ? (il part dans la corbeille du Drive)`)) return;
    setState((s) => (s ? { ...s, files: s.files.filter((x) => x.id !== f.id) } : s));
    try {
      unwrap(await deleteTeamAttachment(cardId, f.id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Suppression impossible.");
    }
    await load();
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Paperclip size={16} className="text-ink-3" />
        <h3 className="flex-1 text-sm font-extrabold text-ink">Pièces jointes</h3>
        {state === null && <Loader2 size={13} className="animate-spin text-ink-4" />}
      </div>

      {state && !state.driveReady ? (
        <p className="rounded-btn bg-subtle px-4 py-3 text-xs text-ink-4">Aucun Drive de board configuré : les pièces jointes y sont archivées (Paramètres du board → Drive du board).</p>
      ) : (
        <>
          <ul className="space-y-2">
            {state?.files.map((f) => (
              <li key={f.id} className="group flex items-center gap-3 rounded-btn border border-line bg-card px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-subtle font-mono text-[10px] font-bold text-ink-3">{kind(f.mimeType, f.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">{f.name}</p>
                  <p className="truncate text-[11px] text-ink-4">
                    {[kind(f.mimeType, f.name), size(f.size), `ajouté par ${f.uploadedBy}`, f.fromGed ? "depuis la GED" : ""].filter(Boolean).join(" · ")}
                  </p>
                  {(f.place === "event" || f.toCenter) && (
                    <p className="mt-0.5 flex flex-wrap gap-1">
                      {f.place === "event" && <span className="rounded-chip bg-sel-bg px-1.5 py-px text-[9px] font-bold text-link">Fichier de l&rsquo;événement</span>}
                      {f.toCenter && <span className="rounded-chip bg-warn-bg px-1.5 py-px text-[9px] font-bold text-warn">Centre de publication</span>}
                    </p>
                  )}
                </div>
                <button onClick={() => setPreview(f)} title="Aperçu" aria-label={`Aperçu de ${f.name}`} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
                  <Eye size={15} />
                </button>
                <div className="relative">
                  <button onClick={() => setSharing(sharing === f.id ? null : f.id)} title="Partager" aria-label={`Partager ${f.name}`} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
                    <Share2 size={15} />
                  </button>
                  <SharePopover open={sharing === f.id} onClose={() => setSharing(null)} cardId={cardId} file={f} people={people} onError={onError} />
                </div>
                <a href={`/api/team/cards/${cardId}/attachments/${f.id}`} title="Télécharger" aria-label={`Télécharger ${f.name}`} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
                  <Download size={15} />
                </a>
                {canEdit && f.place === "card" && (
                  <button onClick={() => void remove(f)} aria-label={`Retirer ${f.name}`} className="hidden text-ink-4 hover:text-bad group-hover:block">
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
            {state?.files.length === 0 && !canEdit && <li className="text-xs text-ink-4">Aucune pièce jointe.</li>}
          </ul>

          {progress && (
            <div className="mt-2 rounded-btn border border-line px-3 py-2">
              <p className="truncate text-[11px] text-ink-3">Envoi vers le Drive : {progress.name}</p>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-track">
                <span className="block h-full rounded-full bg-navy transition-[width]" style={{ width: `${progress.pct}%` }} />
              </span>
            </div>
          )}

          {canEdit && (
            <div
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                setDragOver(false);
                void upload([...e.dataTransfer.files]);
              }}
              className={`relative mt-2 flex items-center justify-center gap-1.5 rounded-btn border border-dashed px-3 py-3 text-[13px] font-semibold ${
                dragOver ? "border-navy bg-sel-bg text-ink" : "border-line-strong text-ink-3"
              }`}
            >
              <Upload size={14} />
              <button type="button" disabled={!!progress} onClick={() => input.current?.click()} className="hover:text-ink hover:underline disabled:opacity-50">
                Déposer un fichier
              </button>
              <span>ou</span>
              <button type="button" disabled={!!progress} onClick={() => setGedOpen(true)} className="hover:text-ink hover:underline disabled:opacity-50">
                choisir dans la GED
              </button>
              <div className="absolute left-1/2 top-full -translate-x-1/2">
                <GedPicker
                  open={gedOpen}
                  onClose={() => setGedOpen(false)}
                  onPick={async (accountId, file) => {
                    setGedOpen(false);
                    setProgress({ name: file.name, pct: 50 });
                    try {
                      unwrap(await attachTeamFileFromGed(cardId, accountId, file.id));
                    } catch (e) {
                      onError(e instanceof Error ? e.message : "Copie impossible.");
                    }
                    setProgress(null);
                    await load();
                  }}
                />
              </div>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  if (files.length) void upload(files);
                }}
              />
            </div>
          )}
          {canEdit && (
            <p className="mt-1.5 text-[10px] leading-snug text-ink-4">
              {hasEvent
                ? "Carte liée à un événement : les fichiers rejoignent ses pièces jointes ; photos et vidéos partent aussi dans « À publier »."
                : "Archivées dans le Drive du board ; photos et vidéos partent aussi dans « À publier » du centre de publication."}
            </p>
          )}
        </>
      )}
      {preview && <PreviewModal cardId={cardId} file={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function GedPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (accountId: string, file: GedFile) => Promise<void> }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<GedFile[] | null>(null);

  useEffect(() => {
    if (!open || accounts) return;
    void getMyConnectedAccounts().then((list) => {
      const google = list.filter((a) => a.provider === "google");
      setAccounts(google);
      if (google[0]) setAccountId(google[0].id);
    });
  }, [open, accounts]);

  useEffect(() => {
    if (!open || !accountId) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      const res = await searchMyGedFiles(accountId, q);
      if (alive) setFiles(res.ok ? res.data : []);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, accountId, q]);

  return (
    <Popover open={open} onClose={onClose} width={340}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Choisir dans la GED</p>
      {accounts?.length === 0 ? (
        <p className="text-xs text-ink-4">Aucun Drive personnel connecté — connectez un compte Google depuis la GED.</p>
      ) : (
        <>
          {accounts && accounts.length > 1 && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mb-2 w-full rounded-btn border border-line bg-card px-2 py-1.5 text-[13px] outline-none">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label ? `${a.label} — ` : ""}
                  {a.email}
                </option>
              ))}
            </select>
          )}
          <div className="mb-2 flex items-center gap-1.5 rounded-btn border border-line px-2 py-1.5">
            <Search size={13} className="text-ink-4" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un fichier…" className="min-w-0 flex-1 text-[13px] outline-none" />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {(files === null || accounts === null) && <p className="px-1.5 py-2 text-xs text-ink-4">Recherche…</p>}
            {files?.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-4">Aucun fichier trouvé.</p>}
            {files?.map((f) => (
              <button key={f.id} onClick={() => void onPick(accountId, f)} className="flex w-full items-center gap-2 rounded-btn px-1.5 py-1.5 text-left hover:bg-hover">
                <FolderSearch size={14} className="shrink-0 text-ink-4" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{f.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-4">{new Date(f.modifiedTime).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-ink-4">Le fichier est copié dans l&rsquo;archive du board ; l&rsquo;original reste dans votre Drive.</p>
        </>
      )}
    </Popover>
  );
}

/** Aperçu en popup : images, PDF, vidéos, sons et textes s'affichent ; les autres formats se téléchargent. */
function PreviewModal({ cardId, file, onClose }: { cardId: string; file: TeamAttachment; onClose: () => void }) {
  const src = `/api/team/cards/${cardId}/attachments/${file.id}?inline=1`;
  const m = file.mimeType;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);
  let body: React.ReactNode;
  // eslint-disable-next-line @next/next/no-img-element -- fichier relayé depuis le Drive du board
  if (m.startsWith("image/")) body = <img src={src} alt={file.name} className="max-h-full max-w-full object-contain" />;
  else if (m === "application/pdf" || m.startsWith("text/")) body = <iframe src={src} title={file.name} className="h-full w-full rounded-btn bg-white" />;
  else if (m.startsWith("video/")) body = <video src={src} controls autoPlay className="max-h-full max-w-full" />;
  else if (m.startsWith("audio/")) body = <audio src={src} controls autoPlay />;
  else
    body = (
      <div className="rounded-card bg-card p-8 text-center">
        <p className="text-sm font-bold text-ink">Aperçu indisponible pour ce format.</p>
        <a href={`/api/team/cards/${cardId}/attachments/${file.id}`} className="mt-3 inline-flex items-center gap-1.5 rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white">
          <Download size={14} /> Télécharger
        </a>
      </div>
    );
  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-[rgba(6,14,28,0.85)] p-4" onMouseDown={onClose}>
      <div className="mb-3 flex items-center gap-3 text-white" onMouseDown={(e) => e.stopPropagation()}>
        <p className="min-w-0 flex-1 truncate text-sm font-bold">{file.name}</p>
        <a href={`/api/team/cards/${cardId}/attachments/${file.id}`} className="flex items-center gap-1.5 rounded-btn bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25">
          <Download size={13} /> Télécharger
        </a>
        <button onClick={onClose} aria-label="Fermer l'aperçu" className="rounded-full p-1.5 hover:bg-white/15">
          <X size={18} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center" onMouseDown={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}

function SharePopover({
  open,
  onClose,
  cardId,
  file,
  people,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  cardId: string;
  file: TeamAttachment;
  people: { name: string; email: string | null }[];
  onError: (m: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const listId = `share-${file.id}`;

  const share = async (to: { email: string; message?: string } | { publicLink: true }) => {
    setBusy(true);
    setDone(null);
    try {
      const link = unwrap(await shareTeamAttachment(cardId, file.id, to));
      if ("publicLink" in to) {
        await navigator.clipboard.writeText(link).catch(() => {});
        setDone("Lien copié dans le presse-papiers.");
      } else {
        setDone(`Partagé avec ${to.email} — Google lui envoie l'invitation.`);
        setEmail("");
        setMessage("");
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Partage impossible.");
    }
    setBusy(false);
  };

  return (
    <Popover open={open} onClose={onClose} align="right" width={320}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Partager « {file.name} »</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void share({ email, message });
        }}
      >
        <input
          list={listId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Adresse e-mail"
          className="w-full rounded-btn border border-line px-2.5 py-1.5 text-[13px] outline-none"
        />
        <datalist id={listId}>
          {people.filter((p) => p.email).map((p) => (
            <option key={p.email!} value={p.email!}>
              {p.name}
            </option>
          ))}
        </datalist>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder="Message (facultatif)"
          className="mt-1.5 w-full resize-none rounded-btn border border-line px-2.5 py-1.5 text-[13px] outline-none"
        />
        <button disabled={busy || !email.trim()} className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-btn bg-navy py-1.5 text-xs font-bold text-white disabled:opacity-40">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} Envoyer l&rsquo;invitation (lecture seule)
        </button>
      </form>
      <div className="my-2.5 border-t border-line" />
      <button
        disabled={busy}
        onClick={() => {
          if (window.confirm("Rendre ce fichier lisible par toute personne disposant du lien ?")) void share({ publicLink: true });
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-btn border border-line py-1.5 text-xs font-bold text-ink-2 hover:bg-hover disabled:opacity-40"
      >
        <Link2 size={13} /> Copier un lien de partage
      </button>
      <p className="mt-1 text-[10px] leading-snug text-ink-4">Le lien rend le fichier lisible par toute personne qui l&rsquo;a.</p>
      {done && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] font-semibold text-good">
          <Check size={13} className="mt-px shrink-0" /> {done}
        </p>
      )}
    </Popover>
  );
}
