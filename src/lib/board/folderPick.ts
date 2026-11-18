"use client";

/**
 * Dossiers déposés ou choisis (« Ajouter un dossier », glisser-déposer d'un dossier) : chaque fichier
 * garde le chemin de son dossier (« Match U15 » ou « Match U15 / Mi-temps »). Les fichiers cachés du
 * système (.DS_Store, Thumbs.db…) sont ignorés.
 */
export type PickedFile = { file: File; folder: string | null };

const MAX_FOLDER = 200;
const isJunk = (name: string) => name.startsWith(".") || /^(thumbs\.db|desktop\.ini)$/i.test(name);

/** Chemin de dossier depuis « A/B/photo.jpg » → « A / B » ; null hors dossier. */
export function folderFromPath(relativePath: string): string | null {
  const parts = relativePath.split("/").filter(Boolean);
  parts.pop();
  if (parts.length === 0) return null;
  return parts.join(" / ").slice(0, MAX_FOLDER).trim() || null;
}

/** Fichiers d'un <input type="file"> (avec ou sans webkitdirectory). */
export function pickedFromInput(list: FileList | File[]): PickedFile[] {
  return Array.from(list)
    .filter((f) => !isJunk(f.name))
    .map((file) => ({ file, folder: folderFromPath(file.webkitRelativePath || "") }));
}

type Entry = FileSystemEntry;

function readAll(dir: FileSystemDirectoryEntry): Promise<Entry[]> {
  const reader = dir.createReader();
  const out: Entry[] = [];
  // readEntries rend les entrées par paquets (100 sous Chrome) : on relit jusqu'au paquet vide.
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(out);
        out.push(...batch);
        next();
      }, reject);
    next();
  });
}

async function walk(entry: Entry, parent: string, out: PickedFile[]) {
  if (isJunk(entry.name)) return;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, folder: parent ? parent.slice(0, MAX_FOLDER) : null });
    return;
  }
  if (entry.isDirectory) {
    const path = parent ? `${parent} / ${entry.name}` : entry.name;
    for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, path, out);
  }
}

/** Fichiers et dossiers glissés-déposés (les dossiers sont parcourus récursivement). */
export async function pickedFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  // Les entrées doivent être lues tout de suite : le DataTransfer est vidé après l'événement.
  const entries = Array.from(dt.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.() ?? null);
  if (entries.length === 0 || entries.some((e) => e === null)) return pickedFromInput(dt.files);
  const out: PickedFile[] = [];
  for (const e of entries) await walk(e!, "", out);
  return out;
}

/** Regroupe des éléments par dossier, dossiers triés par nom ; les éléments hors dossier sont à part. */
export function groupByFolder<T>(items: T[], folderOf: (t: T) => string | null | undefined) {
  const folders = new Map<string, T[]>();
  const loose: T[] = [];
  for (const it of items) {
    const f = folderOf(it);
    if (!f) loose.push(it);
    else folders.set(f, [...(folders.get(f) ?? []), it]);
  }
  return {
    folders: [...folders.entries()].sort(([a], [b]) => a.localeCompare(b, "fr", { numeric: true })).map(([name, files]) => ({ name, files })),
    loose,
  };
}
