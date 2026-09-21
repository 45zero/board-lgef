"use client";

import { useCallback, useEffect, useState } from "react";
import { Folder, File as FileIcon, ChevronRight, ExternalLink, HardDrive } from "lucide-react";
import { getBoardDriveRootFolderId, listBoardFiles } from "@/app/actions/board-drive";
import type { DriveFileItem } from "@/lib/google/drive";

interface Crumb {
  id: string;
  name: string;
}

/** Vue en lecture de l'arborescence automatique du Drive du board (LGEF Drive/Année/Mois/Événement/Médias). */
export function DriveScreen() {
  const [crumbs, setCrumbs] = useState<Crumb[] | null>(null);
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (folderId: string) => {
    setLoading(true);
    setError(null);
    try {
      setFiles(await listBoardFiles({ folderId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec du chargement.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const rootId = await getBoardDriveRootFolderId();
        setCrumbs([{ id: rootId, name: "LGEF Drive" }]);
        await load(rootId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Échec du chargement.");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFolder = (folder: DriveFileItem) => {
    setCrumbs((prev) => [...(prev ?? []), { id: folder.id, name: folder.name }]);
    load(folder.id);
  };

  const goToCrumb = (index: number) => {
    setCrumbs((prev) => {
      if (!prev) return prev;
      const next = prev.slice(0, index + 1);
      load(next[next.length - 1].id);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-2 rounded-panel border border-line bg-card px-4 py-3">
        <HardDrive size={18} className="text-ink-4" />
        {crumbs?.map((c, i) => (
          <span key={c.id} className="flex items-center gap-2">
            {i > 0 && <ChevronRight size={13} className="text-ink-4" />}
            <button
              onClick={() => goToCrumb(i)}
              className={`text-sm font-semibold ${i === crumbs.length - 1 ? "text-ink" : "text-ink-3 hover:text-ink hover:underline"}`}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-panel border border-line bg-card">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-4">{error}</div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-4">Chargement…</div>
        ) : files.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-4">Dossier vide.</div>
        ) : (
          <div className="divide-y divide-line">
            {files.map((f) =>
              f.isFolder ? (
                <button
                  key={f.id}
                  onClick={() => openFolder(f)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
                >
                  <Folder size={16} className="shrink-0 text-ink-4" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{f.name}</span>
                  <ChevronRight size={14} className="shrink-0 text-ink-4" />
                </button>
              ) : (
                <a
                  key={f.id}
                  href={f.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center gap-3 px-4 py-3 hover:bg-hover"
                >
                  <FileIcon size={16} className="shrink-0 text-ink-4" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{f.name}</span>
                  <ExternalLink size={13} className="shrink-0 text-ink-4" />
                </a>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
