"use client";

import { useEffect, useRef, useState } from "react";
import {
  FolderArchive,
  Folder,
  File as FileIcon,
  Upload,
  FolderPlus,
  Download,
  Trash2,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import {
  listMyFiles,
  createMyFolder,
  uploadMyFile,
  downloadMyFile,
  trashMyFile,
} from "@/app/actions/drive";

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
type DriveFile = Awaited<ReturnType<typeof listMyFiles>>[number];

interface Crumb {
  id: string;
  name: string;
}

const ROOT_CRUMB: Crumb = { id: "root", name: "Mon Drive" };

function base64UrlToBlob(base64: string, mimeType: string) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatSize(size: string | null) {
  if (!size) return "";
  const bytes = Number(size);
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function GedScreen() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([ROOT_CRUMB]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentFolderId = crumbs[crumbs.length - 1].id;

  useEffect(() => {
    getMyConnectedAccounts().then((accs) => {
      setAccounts(accs);
      if (accs.length > 0) setActiveAccountId(accs[0].id);
    });
  }, []);

  const refresh = () => {
    if (!activeAccountId) return;
    setLoading(true);
    listMyFiles(activeAccountId, { folderId: currentFolderId === "root" ? undefined : currentFolderId })
      .then(setFiles)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dep-change needs a loading flag reset before the request resolves
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, currentFolderId]);

  const openFolder = (folder: DriveFile) => {
    setCrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const goToCrumb = (index: number) => {
    setCrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleDownload = async (file: DriveFile) => {
    if (!activeAccountId) return;
    const { data, mimeType, name } = await downloadMyFile(activeAccountId, file.id);
    const blob = base64UrlToBlob(data, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleTrash = async (file: DriveFile) => {
    if (!activeAccountId) return;
    await trashMyFile(activeAccountId, file.id);
    refresh();
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeAccountId) return;
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      await uploadMyFile(activeAccountId, {
        name: file.name,
        parentId: currentFolderId === "root" ? undefined : currentFolderId,
        mimeType: file.type || "application/octet-stream",
        data: base64,
      });
      refresh();
    } finally {
      setUploading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!activeAccountId || !newFolderName.trim()) return;
    await createMyFolder(activeAccountId, {
      name: newFolderName.trim(),
      parentId: currentFolderId === "root" ? undefined : currentFolderId,
    });
    setNewFolderName("");
    setCreatingFolder(false);
    refresh();
  };

  if (accounts === null) {
    return (
      <div className="flex h-full items-center justify-center rounded-panel border border-line bg-card/60 font-mono text-xs uppercase tracking-[0.1em] text-ink-4">
        Chargement…
      </div>
    );
  }

  if (accounts.length === 0) {
    return <ConnectAccountEmptyState />;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => {
                setActiveAccountId(acc.id);
                setCrumbs([ROOT_CRUMB]);
              }}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                activeAccountId === acc.id
                  ? "border-navy bg-navy text-white"
                  : "border-line bg-card text-ink-2 hover:bg-hover"
              }`}
            >
              {acc.label || acc.email}
            </button>
          ))}
          <a
            href="/api/oauth/google/start"
            className="flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover"
          >
            <Plus size={12} /> Ajouter un compte
          </a>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelected}
          />
          <button
            onClick={() => setCreatingFolder(true)}
            className="flex items-center gap-1.5 rounded-btn border border-line px-3.5 py-2 text-sm font-semibold text-ink-2 hover:bg-hover"
          >
            <FolderPlus size={15} /> Nouveau dossier
          </button>
          <button
            onClick={handleUploadClick}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-btn bg-navy px-3.5 py-2 text-sm font-bold text-white hover:bg-navy-600 disabled:opacity-60"
          >
            <Upload size={15} /> {uploading ? "Envoi…" : "Importer un fichier"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 text-sm text-ink-3">
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            <button
              onClick={() => goToCrumb(i)}
              className={`hover:underline ${i === crumbs.length - 1 ? "font-bold text-ink" : ""}`}
            >
              {c.name}
            </button>
            {i < crumbs.length - 1 && <ChevronRight size={13} className="text-ink-4" />}
          </span>
        ))}
      </div>

      {creatingFolder && (
        <div className="flex items-center gap-2 rounded-btn border border-line bg-card px-3 py-2">
          <FolderPlus size={15} className="text-ink-4" />
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
            placeholder="Nom du dossier"
            className="flex-1 text-sm outline-none"
          />
          <button onClick={handleCreateFolder} className="text-xs font-bold text-navy">
            Créer
          </button>
          <button onClick={() => setCreatingFolder(false)} className="text-ink-4 hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded-panel border border-line bg-card">
        {loading && (
          <div className="p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Chargement…</div>
        )}
        {!loading && files.length === 0 && (
          <div className="p-4 text-sm text-ink-3">Dossier vide.</div>
        )}
        {!loading &&
          files.map((f) => (
            <div
              key={f.id}
              className="group flex items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hover"
            >
              <button
                onClick={() => (f.isFolder ? openFolder(f) : handleDownload(f))}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {f.isFolder ? (
                  <Folder size={18} className="shrink-0 text-navy" />
                ) : (
                  <FileIcon size={18} className="shrink-0 text-ink-4" />
                )}
                <span className="truncate text-sm font-medium text-ink-2">{f.name}</span>
                {!f.isFolder && f.size && (
                  <span className="shrink-0 text-xs text-ink-4">{formatSize(f.size)}</span>
                )}
              </button>
              <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                {!f.isFolder && (
                  <button
                    onClick={() => handleDownload(f)}
                    className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3 hover:bg-subtle"
                    aria-label="Télécharger"
                  >
                    <Download size={14} />
                  </button>
                )}
                <button
                  onClick={() => handleTrash(f)}
                  className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3 hover:bg-subtle hover:text-red"
                  aria-label="Mettre à la corbeille"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function ConnectAccountEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-panel border border-dashed border-line bg-card/60 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-btn bg-subtle text-ink-3">
        <FolderArchive size={22} />
      </div>
      <div>
        <h2 className="text-base font-bold text-ink">Aucun compte Drive connecté</h2>
        <p className="mt-1 max-w-md text-sm text-ink-3">
          Connectez un compte Google pour parcourir, importer et télécharger vos fichiers Drive ici.
          C&rsquo;est facultatif : Board LGEF fonctionne normalement sans.
        </p>
      </div>
      <a
        href="/api/oauth/google/start"
        className="rounded-btn bg-navy px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-600"
      >
        Connecter Google Drive
      </a>
    </div>
  );
}
