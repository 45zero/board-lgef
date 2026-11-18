"use client";

import { useState } from "react";
import { ChevronRight, Download, Folder, FolderOpen, Loader2, Plus } from "lucide-react";

/**
 * Un dossier déposé dans des pièces jointes (événement, carte de l'Espace Team) : une seule ligne
 * repliée ; on l'ouvre pour voir les fichiers, chacun s'ouvre / se télécharge individuellement.
 */
export function FolderBlock({
  name,
  count,
  summary,
  onAdd,
  onDownloadAll,
  children,
}: {
  name: string;
  count: number;
  /** Détail affiché sous le nom (ex. « 18 photos · 2 vidéos »). */
  summary?: string;
  /** Ajouter des fichiers dans ce dossier. */
  onAdd?: () => void;
  /** Télécharger chaque fichier du dossier, l'un après l'autre. */
  onDownloadAll?: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const Icon = open ? FolderOpen : Folder;

  return (
    <div className="rounded-btn border border-line bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight size={14} className={`shrink-0 text-ink-4 transition-transform ${open ? "rotate-90" : ""}`} />
          <Icon size={18} className="shrink-0 text-warn" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{name}</span>
            <span className="block text-[11px] text-ink-4">
              {count} fichier{count > 1 ? "s" : ""}
              {summary ? ` · ${summary}` : ""}
            </span>
          </span>
        </button>
        {onAdd && (
          <button type="button" onClick={onAdd} title="Ajouter des fichiers dans ce dossier" aria-label={`Ajouter des fichiers dans ${name}`} className="rounded-md p-1.5 text-ink-4 hover:bg-hover hover:text-ink">
            <Plus size={14} />
          </button>
        )}
        {onDownloadAll && (
          <button
            type="button"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await onDownloadAll();
              } finally {
                setDownloading(false);
              }
            }}
            title="Tout télécharger"
            aria-label={`Télécharger tout le dossier ${name}`}
            className="rounded-md p-1.5 text-ink-4 hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          </button>
        )}
      </div>
      {open && <div className="space-y-1.5 border-t border-line px-2 py-2">{children}</div>}
    </div>
  );
}

/** « 18 photos · 2 vidéos · 1 document » à partir des types MIME. */
export function folderSummary(mimes: (string | null | undefined)[]) {
  const photos = mimes.filter((m) => m?.startsWith("image/")).length;
  const videos = mimes.filter((m) => m?.startsWith("video/")).length;
  const docs = mimes.length - photos - videos;
  return [
    photos && `${photos} photo${photos > 1 ? "s" : ""}`,
    videos && `${videos} vidéo${videos > 1 ? "s" : ""}`,
    docs && `${docs} document${docs > 1 ? "s" : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Lance des téléchargements l'un après l'autre (le navigateur peut demander d'autoriser les téléchargements multiples). */
export async function downloadSequentially<T>(items: T[], download: (item: T) => Promise<void> | void) {
  for (const it of items) {
    await download(it);
    await new Promise((r) => setTimeout(r, 600));
  }
}
