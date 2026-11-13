"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Eye,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ago, type FeedAuthor } from "@/components/fief/feed";

// Documents FIEF (sql/2026-11-13_fief_documents.sql) : « Documents partagés » (par dossiers) et « Mes
// documents ». Envoi par morceaux de 4 Mo vers /api/fief/documents/chunk (relais Drive), 50 Mo max.
// Côté membres (fief.lgef.fr) et dans l'onglet FIEF du board (`team` : dépôt au nom de l'équipe,
// dossiers, suppression de tout document).

interface DocFolder {
  id: string;
  name: string;
  sort_order: number;
  shared_count: number;
}

interface Doc {
  id: string;
  name: string;
  description: string | null;
  mime_type: string;
  size_bytes: number;
  visibility: "private" | "shared";
  folder_id: string | null;
  folder_name: string | null;
  author: FeedAuthor;
  mine: boolean;
  created_at: string;
}

const CHUNK = 4 * 1024 * 1024; // multiple de 256 Kio (exigence du Drive), sous la limite de 4,5 Mo des fonctions
const MAX_BYTES = 50 * 1024 * 1024;

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} Ko` : `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);
const viewable = (mime: string) => mime === "application/pdf" || mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("text/");

function TypeIcon({ mime }: { mime: string }) {
  const [Icon, color] = mime.startsWith("image/")
    ? [FileImage, "#7C3AED"]
    : mime.startsWith("video/")
      ? [FileVideo, "#DB2777"]
      : mime === "application/pdf"
        ? [FileText, "#D7262E"]
        : /sheet|excel|csv/.test(mime)
          ? [FileSpreadsheet, "#15803D"]
          : /word|document|text/.test(mime)
            ? [FileText, "#1D4ED8"]
            : [FileIcon, "#5B6B86"];
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `${color}14`, color }}>
      <Icon size={22} />
    </span>
  );
}

async function api(body: unknown) {
  const res = await fetch("/api/fief/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ ok: false, error: "Réponse illisible." }));
  if (!res.ok || !json.ok) throw new Error(json.error ?? "Action impossible.");
  return json as { id?: string };
}

/** Envoie un fichier par morceaux ; reprend où le Drive en est après une coupure. */
async function uploadFile(file: File, opts: { folderId: string | null; shared: boolean; description: string; asTeam: boolean }, onProgress: (p: number) => void) {
  const { id } = await api({ action: "start", name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, ...opts });
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size);
    try {
      const res = await fetch("/api/fief/documents/chunk", {
        method: "PUT",
        headers: { "x-document-id": id!, "Content-Range": `bytes ${offset}-${end - 1}/${file.size}` },
        body: file.slice(offset, end),
      });
      if (res.status === 308) {
        const range = res.headers.get("x-range");
        offset = range ? Number(range.split("-")[1]) + 1 : end;
      } else if (res.ok) {
        offset = file.size;
      } else {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Envoi interrompu.");
      }
      failures = 0;
      onProgress(offset / file.size);
    } catch (e) {
      if (++failures > 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * failures));
      // Où en est le Drive ? (corps vide)
      const probe = await fetch("/api/fief/documents/chunk", { method: "PUT", headers: { "x-document-id": id!, "Content-Range": `bytes */${file.size}` } }).catch(() => null);
      if (probe?.ok) offset = file.size;
      else if (probe?.status === 308) {
        const range = probe.headers.get("x-range");
        offset = range ? Number(range.split("-")[1]) + 1 : 0;
      }
    }
  }
}

export function DocumentsView({ team = false, driveUrl }: { team?: boolean; driveUrl?: () => Promise<string | null> }) {
  const [tab, setTab] = useState<"shared" | "mine">("shared");
  const [folders, setFolders] = useState<DocFolder[] | null>(null);
  const [folderId, setFolderId] = useState<string | "all" | null>(null);
  const [docs, setDocs] = useState<{ key: string; list: Doc[] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .rpc("fief_doc_folders_list")
      .then(({ data }) => setFolders((data ?? []) as DocFolder[]));
  }, [version]);

  const listKey = `${tab}:${folderId}:${version}`;
  useEffect(() => {
    if (tab === "shared" && !folderId) return;
    let alive = true;
    createClient()
      .rpc("fief_documents_list", { p_scope: tab, p_folder: tab === "shared" && folderId !== "all" ? folderId : null })
      .then(({ data }) => {
        if (alive) setDocs({ key: `${tab}:${folderId}:${version}`, list: (data ?? []) as Doc[] });
      });
    return () => {
      alive = false;
    };
  }, [tab, folderId, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const list = docs?.key === listKey ? docs.list : null;
  const currentFolder = folders?.find((f) => f.id === folderId) ?? null;

  const folderAction = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      await api(body);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    }
  };
  const renameFolder = (f: DocFolder) => {
    const name = window.prompt("Nouveau nom du dossier", f.name);
    if (name?.trim() && name !== f.name) void folderAction({ action: "renameFolder", id: f.id, name });
  };
  const deleteFolder = (f: DocFolder) => {
    if (window.confirm(`Supprimer le dossier « ${f.name} » ? Ses documents restent, classés « Divers ».`)) void folderAction({ action: "deleteFolder", id: f.id });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!team && (
          <div className="flex rounded-full bg-f-surface p-1 border border-f-border">
            {(["shared", "mine"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setFolderId(null);
                }}
                className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === t ? "bg-f-accent text-white" : "text-f-text"}`}
              >
                {t === "shared" ? "Documents partagés" : "Mes documents"}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setUploading(true)} className="ml-auto flex items-center gap-2 rounded-xl bg-f-accent px-3.5 py-2 text-sm font-bold text-white">
          <Upload size={16} /> {team ? "Déposer un document" : "Ajouter un document"}
        </button>
      </div>
      {error && <p className="rounded-xl bg-f-danger-bg px-3 py-2 text-sm text-f-danger">{error}</p>}

      {tab === "shared" && !folderId && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {folders === null && <Loader2 className="animate-spin text-f-muted" />}
          <FolderCard name="Tous les documents" count={(folders ?? []).reduce((n, f) => n + f.shared_count, 0)} onOpen={() => setFolderId("all")} />
          {folders?.map((f) => (
            <FolderCard
              key={f.id}
              name={f.name}
              count={f.shared_count}
              onOpen={() => setFolderId(f.id)}
              onRename={team ? () => renameFolder(f) : undefined}
              onDelete={team ? () => deleteFolder(f) : undefined}
            />
          ))}
          {team && (
            <button
              onClick={() => {
                const name = window.prompt("Nom du nouveau dossier");
                if (name?.trim()) void folderAction({ action: "createFolder", name });
              }}
              className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-f-border-strong p-4 text-sm font-bold text-f-link hover:bg-f-surface"
            >
              <FolderPlus size={18} /> Nouveau dossier
            </button>
          )}
          {driveUrl && <DriveLink driveUrl={driveUrl} />}
        </div>
      )}

      {(tab === "mine" || folderId) && (
        <div className="space-y-2">
          {tab === "shared" && (
            <button onClick={() => setFolderId(null)} className="flex items-center gap-1.5 text-sm font-bold text-f-link">
              <ArrowLeft size={16} /> {folderId === "all" ? "Tous les documents" : currentFolder?.name}
            </button>
          )}
          {list === null && <Loader2 className="animate-spin text-f-muted" />}
          {list?.length === 0 && (
            <div className="rounded-2xl bg-f-surface p-8 text-center text-f-muted border border-f-border">
              {tab === "mine" ? "Vous n'avez pas encore ajouté de document." : "Aucun document dans ce dossier pour l'instant."}
            </div>
          )}
          {list?.map((d) => (
            <DocRow key={d.id} doc={d} folders={folders ?? []} canManage={d.mine || team} showVisibility={tab === "mine"} onChanged={refresh} />
          ))}
        </div>
      )}

      {uploading && (
        <UploadDialog
          folders={folders ?? []}
          team={team}
          defaultFolder={folderId && folderId !== "all" ? folderId : null}
          defaultShared={team || tab === "shared"}
          onClose={() => setUploading(false)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function FolderCard({ name, count, onOpen, onRename, onDelete }: { name: string; count: number; onOpen: () => void; onRename?: () => void; onDelete?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-f-surface p-4 border border-f-border hover:ring-2 hover:ring-f-accent/15">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Folder size={34} className="shrink-0 fill-[#F5B83D] text-[#E0A12A]" />
        <span className="min-w-0">
          <span className="block truncate font-extrabold">{name}</span>
          <span className="text-sm text-f-muted">
            {count} document{count > 1 ? "s" : ""}
          </span>
        </span>
      </button>
      {onRename && (
        <button onClick={onRename} aria-label="Renommer" className="rounded-full p-1.5 text-f-faint hover:bg-f-subtle">
          <Pencil size={15} />
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} aria-label="Supprimer le dossier" className="rounded-full p-1.5 text-f-faint hover:bg-f-danger-bg hover:text-f-danger">
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

function DriveLink({ driveUrl }: { driveUrl: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const url = await driveUrl();
        setBusy(false);
        if (url) window.open(url, "_blank", "noopener");
      }}
      className="flex items-center justify-center gap-2 rounded-2xl border border-f-border bg-f-surface p-4 text-sm font-bold text-f-link disabled:opacity-60"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Folder size={16} />} Ouvrir le dossier FIEF dans le Drive
    </button>
  );
}

function DocRow({ doc, folders, canManage, showVisibility, onChanged }: { doc: Doc; folders: DocFolder[]; canManage: boolean; showVisibility: boolean; onChanged: () => void }) {
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: Record<string, unknown>, confirmText?: string) => {
    setMenu(false);
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    try {
      await api(body);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    }
  };
  const url = `/api/fief/documents/${doc.id}`;
  return (
    <div className="rounded-2xl bg-f-surface p-3 border border-f-border">
      <div className="flex items-center gap-3">
        <TypeIcon mime={doc.mime_type} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{doc.name}</p>
          <p className="truncate text-xs text-f-muted">{[size(doc.size_bytes), doc.author.name, ago(doc.created_at), showVisibility ? null : doc.folder_name].filter(Boolean).join(" · ")}</p>
          {doc.description && <p className="mt-0.5 line-clamp-2 text-sm text-f-text">{doc.description}</p>}
        </div>
        {showVisibility && (
          <span className={`hidden rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline ${doc.visibility === "shared" ? "bg-f-success-bg text-f-success" : "bg-f-subtle text-f-muted"}`}>
            {doc.visibility === "shared" ? `Partagé${doc.folder_name ? ` · ${doc.folder_name}` : ""}` : "Pour moi"}
          </span>
        )}
        {viewable(doc.mime_type) && (
          <a href={`${url}?inline=1`} target="_blank" rel="noopener" aria-label="Ouvrir" className="rounded-full p-2 text-f-link hover:bg-f-subtle">
            <Eye size={18} />
          </a>
        )}
        <a href={url} aria-label="Télécharger" className="rounded-full p-2 text-f-link hover:bg-f-subtle">
          <Download size={18} />
        </a>
        {canManage && (
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} aria-label="Options" className="rounded-full p-2 text-f-muted hover:bg-f-subtle">
              <MoreHorizontal size={18} />
            </button>
            {menu && (
              <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-f-border bg-f-surface py-1 text-sm shadow-lg">
                {!doc.author.team && (
                  <button onClick={() => void run({ action: "update", id: doc.id, shared: doc.visibility !== "shared" })} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-f-bg">
                    <Share2 size={15} /> {doc.visibility === "shared" ? "Ne plus partager (garder pour moi)" : "Partager avec les membres"}
                  </button>
                )}
                <div className="px-3 py-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase text-f-faint">Dossier</p>
                  <select
                    value={doc.folder_id ?? ""}
                    onChange={(e) => void run({ action: "update", id: doc.id, folderId: e.target.value || null })}
                    className="w-full rounded-lg border border-f-border px-2 py-1.5 text-sm"
                  >
                    <option value="">Divers</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => {
                    const name = window.prompt("Nom du document", doc.name);
                    if (name?.trim() && name !== doc.name) void run({ action: "update", id: doc.id, name });
                    else setMenu(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-f-bg"
                >
                  <Pencil size={15} /> Renommer
                </button>
                <button onClick={() => void run({ action: "delete", id: doc.id }, `Supprimer « ${doc.name} » ?`)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-f-danger hover:bg-f-bg">
                  <Trash2 size={15} /> Supprimer
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-f-danger">{error}</p>}
    </div>
  );
}

function UploadDialog({
  folders,
  team,
  defaultFolder,
  defaultShared,
  onClose,
  onDone,
}: {
  folders: DocFolder[];
  team: boolean;
  defaultFolder: string | null;
  defaultShared: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [folderId, setFolderId] = useState<string | null>(defaultFolder);
  const [shared, setShared] = useState(defaultShared);
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState<Record<string, number | string>>({});
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const tooBig = files.filter((f) => f.size > MAX_BYTES);
  const send = async () => {
    setBusy(true);
    let failed = false;
    for (const f of files) {
      try {
        await uploadFile(f, { folderId, shared: team || shared, description: files.length === 1 ? description : "", asTeam: team }, (p) => setProgress((prev) => ({ ...prev, [f.name]: p })));
        setProgress((prev) => ({ ...prev, [f.name]: 1 }));
      } catch (e) {
        failed = true;
        setProgress((prev) => ({ ...prev, [f.name]: e instanceof Error ? e.message : "Échec" }));
      }
    }
    setBusy(false);
    onDone();
    if (!failed) onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-f-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-f-text sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">{team ? "Déposer un document" : "Ajouter un document"}</h2>
          <button onClick={onClose} disabled={busy} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-f-subtle">
            <X size={20} />
          </button>
        </div>
        <input ref={input} type="file" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <button
          onClick={() => input.current?.click()}
          disabled={busy}
          className="mt-4 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-f-border-strong px-4 py-6 text-sm font-semibold text-f-link hover:bg-f-bg"
        >
          <Upload size={24} />
          {files.length ? `${files.length} fichier${files.length > 1 ? "s" : ""} choisi${files.length > 1 ? "s" : ""}` : "Choisir des fichiers (50 Mo max chacun)"}
        </button>
        {files.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-sm">
            {files.map((f) => {
              const p = progress[f.name];
              return (
                <li key={f.name} className="rounded-lg bg-f-bg px-3 py-2">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-f-muted">{size(f.size)}</span>
                  </div>
                  {typeof p === "number" && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-f-border">
                      <div className="h-full bg-f-accent transition-all" style={{ width: `${Math.round(p * 100)}%` }} />
                    </div>
                  )}
                  {typeof p === "string" && <p className="mt-1 text-xs text-f-danger">{p}</p>}
                  {f.size > MAX_BYTES && <p className="mt-1 text-xs text-f-danger">Trop lourd (50 Mo maximum).</p>}
                </li>
              );
            })}
          </ul>
        )}
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-semibold">Dossier</span>
          <select value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value || null)} className="w-full rounded-xl border border-f-border px-3 py-2.5 text-[15px]">
            <option value="">Divers</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {files.length === 1 && (
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[13px] font-semibold">Description (facultatif)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} className="w-full rounded-xl border border-f-border px-3 py-2 text-[15px]" />
          </label>
        )}
        {!team && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              { v: false, label: "Garder pour moi", hint: "Dans « Mes documents »" },
              { v: true, label: "Partager", hint: "Visible de toutes les membres" },
            ].map((o) => (
              <button key={o.label} onClick={() => setShared(o.v)} className={`rounded-xl border-2 px-3 py-2.5 text-left ${shared === o.v ? "border-f-accent bg-f-subtle" : "border-f-border"}`}>
                <span className="block text-sm font-bold">{o.label}</span>
                <span className="text-xs text-f-muted">{o.hint}</span>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => void send()}
          disabled={busy || !files.length || tooBig.length > 0}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-f-accent px-4 py-3 text-[15px] font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />} {busy ? "Envoi en cours…" : "Envoyer"}
        </button>
      </div>
    </div>
  );
}
