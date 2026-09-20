"use client";

import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import {
  FolderArchive,
  Folder,
  File as FileIcon,
  Upload,
  FolderPlus,
  Download,
  Trash2,
  ExternalLink,
  ChevronRight,
  Plus,
  X,
  Search,
  List,
  LayoutGrid,
  HardDrive,
  Users,
} from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import {
  listMyFiles,
  createMyFolder,
  uploadMyFile,
  downloadMyFile,
  trashMyFile,
} from "@/app/actions/drive";
import type { DriveTypeFilter } from "@/lib/google/drive";

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
type DriveFile = Awaited<ReturnType<typeof listMyFiles>>[number];
type DriveView = "mine" | "shared";
type ViewMode = "list" | "grid";
type DateFilter = "any" | "today" | "week" | "month" | "year";

interface Crumb {
  id: string;
  name: string;
}

const ROOT_CRUMB: Record<DriveView, Crumb> = {
  mine: { id: "root", name: "Mon Drive" },
  shared: { id: "root", name: "Partagé avec moi" },
};

const TYPE_OPTIONS: { value: DriveTypeFilter; label: string }[] = [
  { value: "all", label: "Tous les types" },
  { value: "folder", label: "Dossiers" },
  { value: "document", label: "Documents" },
  { value: "spreadsheet", label: "Feuilles de calcul" },
  { value: "presentation", label: "Présentations" },
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Images" },
  { value: "video", label: "Vidéos" },
];

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "any", label: "Date de modification" },
  { value: "today", label: "Aujourd'hui" },
  { value: "week", label: "7 derniers jours" },
  { value: "month", label: "30 derniers jours" },
  { value: "year", label: "Cette année" },
];

function modifiedAfterFor(filter: DateFilter): string | undefined {
  if (filter === "any") return undefined;
  const d = new Date();
  if (filter === "today") d.setHours(0, 0, 0, 0);
  if (filter === "week") d.setDate(d.getDate() - 7);
  if (filter === "month") d.setDate(d.getDate() - 30);
  if (filter === "year") d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

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
  if (!size) return "—";
  const bytes = Number(size);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(iso: string) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "d MMM yyyy", { locale: fr });
  } catch {
    return "—";
  }
}

export function GedScreen() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [view, setView] = useState<DriveView>("mine");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [crumbs, setCrumbs] = useState<Crumb[]>([ROOT_CRUMB.mine]);
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("any");
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
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
    listMyFiles(activeAccountId, {
      folderId: currentFolderId === "root" ? undefined : currentFolderId,
      query: activeQuery.trim() || undefined,
      sharedWithMe: view === "shared",
      type: typeFilter === "all" ? undefined : typeFilter,
      modifiedAfter: modifiedAfterFor(dateFilter),
    })
      .then(setFiles)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dep-change needs a loading flag reset before the request resolves
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, currentFolderId, view, typeFilter, dateFilter, activeQuery]);

  const switchView = (next: DriveView) => {
    setView(next);
    setCrumbs([ROOT_CRUMB[next]]);
  };

  const openFolder = (folder: DriveFile) => {
    setCrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const goToCrumb = (index: number) => {
    setCrumbs((prev) => prev.slice(0, index + 1));
  };

  const runSearch = () => setActiveQuery(searchInput);
  const clearSearch = () => {
    setSearchInput("");
    setActiveQuery("");
  };

  const handleOpen = (file: DriveFile) => {
    if (file.webViewLink) window.open(file.webViewLink, "_blank", "noopener,noreferrer");
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
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => {
                setActiveAccountId(acc.id);
                setCrumbs([ROOT_CRUMB[view]]);
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
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
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

      <div className="flex flex-1 gap-3 overflow-hidden">
        <div className="flex w-[180px] shrink-0 flex-col gap-1 rounded-panel border border-line bg-card p-2">
          <button
            onClick={() => switchView("mine")}
            className={`flex items-center gap-2 rounded-btn px-3 py-2 text-left text-sm font-semibold ${
              view === "mine" ? "bg-navy text-white" : "text-ink-2 hover:bg-hover"
            }`}
          >
            <HardDrive size={14} /> Mon Drive
          </button>
          <button
            onClick={() => switchView("shared")}
            className={`flex items-center gap-2 rounded-btn px-3 py-2 text-left text-sm font-semibold ${
              view === "shared" ? "bg-navy text-white" : "text-ink-2 hover:bg-hover"
            }`}
          >
            <Users size={14} /> Partagé avec moi
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-btn border border-line bg-card px-3 py-2">
              <Search size={14} className="shrink-0 text-ink-4" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Rechercher dans Drive"
                className="w-full text-sm outline-none"
              />
              {activeQuery && (
                <button onClick={clearSearch} className="text-ink-4 hover:text-ink">
                  <X size={13} />
                </button>
              )}
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as DriveTypeFilter)}
              className="rounded-btn border border-line bg-card px-2.5 py-2 text-xs font-semibold text-ink-2 outline-none"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="rounded-btn border border-line bg-card px-2.5 py-2 text-xs font-semibold text-ink-2 outline-none"
            >
              {DATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-0.5 rounded-btn border border-line bg-card p-0.5">
              <button
                onClick={() => setViewMode("list")}
                aria-label="Vue liste"
                className={`flex h-7 w-7 items-center justify-center rounded-[6px] ${
                  viewMode === "list" ? "bg-navy text-white" : "text-ink-3"
                }`}
              >
                <List size={14} />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                aria-label="Vue icônes"
                className={`flex h-7 w-7 items-center justify-center rounded-[6px] ${
                  viewMode === "grid" ? "bg-navy text-white" : "text-ink-3"
                }`}
              >
                <LayoutGrid size={14} />
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
              <div className="p-4 text-sm text-ink-3">
                {activeQuery ? "Aucun résultat." : "Dossier vide."}
              </div>
            )}

            {!loading && files.length > 0 && viewMode === "list" && (
              <div className="flex flex-col">
                <div className="grid grid-cols-[1fr_160px_120px_90px_84px] gap-2 border-b border-line px-4 py-2 text-[10px] font-mono uppercase tracking-[0.08em] text-ink-4">
                  <span>Nom</span>
                  <span>Propriétaire</span>
                  <span>Date de modification</span>
                  <span>Taille</span>
                  <span />
                </div>
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="group grid grid-cols-[1fr_160px_120px_90px_84px] items-center gap-2 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover"
                  >
                    <button
                      onClick={() => (f.isFolder ? openFolder(f) : handleOpen(f))}
                      className="flex min-w-0 items-center gap-2.5 text-left"
                    >
                      {f.isFolder ? (
                        <Folder size={17} className="shrink-0 text-navy" />
                      ) : (
                        <FileIcon size={17} className="shrink-0 text-ink-4" />
                      )}
                      <span className="truncate text-sm font-medium text-ink-2">{f.name}</span>
                    </button>
                    <span className="truncate text-xs text-ink-3">{f.ownerName || "—"}</span>
                    <span className="truncate text-xs text-ink-3">{formatDate(f.modifiedTime)}</span>
                    <span className="truncate text-xs text-ink-3">{f.isFolder ? "—" : formatSize(f.size)}</span>
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={() => handleOpen(f)}
                        className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3 hover:bg-subtle"
                        aria-label="Ouvrir dans Drive"
                      >
                        <ExternalLink size={13} />
                      </button>
                      {!f.isFolder && (
                        <button
                          onClick={() => handleDownload(f)}
                          className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3 hover:bg-subtle"
                          aria-label="Télécharger"
                        >
                          <Download size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => handleTrash(f)}
                        className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3 hover:bg-subtle hover:text-red"
                        aria-label="Mettre à la corbeille"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && files.length > 0 && viewMode === "grid" && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 p-4">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="group relative flex flex-col items-center gap-2 rounded-btn border border-line p-3 hover:bg-hover"
                  >
                    <div className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 group-hover:flex">
                      <button
                        onClick={() => handleOpen(f)}
                        className="flex h-6 w-6 items-center justify-center rounded-btn bg-card text-ink-3 shadow-card hover:bg-subtle"
                        aria-label="Ouvrir dans Drive"
                      >
                        <ExternalLink size={11} />
                      </button>
                      {!f.isFolder && (
                        <button
                          onClick={() => handleDownload(f)}
                          className="flex h-6 w-6 items-center justify-center rounded-btn bg-card text-ink-3 shadow-card hover:bg-subtle"
                          aria-label="Télécharger"
                        >
                          <Download size={11} />
                        </button>
                      )}
                      <button
                        onClick={() => handleTrash(f)}
                        className="flex h-6 w-6 items-center justify-center rounded-btn bg-card text-ink-3 shadow-card hover:bg-subtle hover:text-red"
                        aria-label="Mettre à la corbeille"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <button
                      onClick={() => (f.isFolder ? openFolder(f) : handleOpen(f))}
                      className="flex flex-col items-center gap-2"
                    >
                      {f.isFolder ? (
                        <Folder size={30} className="text-navy" />
                      ) : (
                        <FileIcon size={30} className="text-ink-4" />
                      )}
                      <span className="line-clamp-2 max-w-[120px] text-center text-xs font-medium text-ink-2">
                        {f.name}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
