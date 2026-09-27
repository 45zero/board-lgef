import "server-only";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { findOrCreateFolder, type DriveFileItem } from "@/lib/google/drive";
import type { ConnectedAccount } from "@/generated/prisma";

// Arborescence d'archivage du Drive du board : LGEF Drive / AAAA / MM - Mois / JJ - Événement.
// Partagée par les médias des événements et les justificatifs de frais.

export const ARCHIVE_ROOT_FOLDER_NAME = "LGEF Drive";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Cache de dossiers pour une série d'appels (évite de relister les mêmes dossiers). */
export type FolderCache = Map<string, Promise<DriveFileItem>>;

function folder(account: ConnectedAccount, cache: FolderCache, name: string, parentId?: string) {
  const key = `${parentId ?? "root"}/${name}`;
  if (!cache.has(key)) cache.set(key, findOrCreateFolder(account, { name, parentId }));
  return cache.get(key)!;
}

/** Dossier du mois : LGEF Drive / AAAA / MM - Mois. */
export async function monthArchiveFolder(account: ConnectedAccount, date: Date, cache: FolderCache = new Map()) {
  const root = await folder(account, cache, ARCHIVE_ROOT_FOLDER_NAME);
  const year = await folder(account, cache, format(date, "yyyy"), root.id);
  return folder(account, cache, `${format(date, "MM")} - ${capitalize(format(date, "MMMM", { locale: fr }))}`, year.id);
}

/** Dossier d'un événement : LGEF Drive / AAAA / MM - Mois / JJ - Titre (date de début de l'événement). */
export async function eventArchiveFolder(account: ConnectedAccount, event: { title: string; start: Date }, cache: FolderCache = new Map()) {
  const month = await monthArchiveFolder(account, event.start, cache);
  return folder(account, cache, `${format(event.start, "dd")} - ${event.title}`, month.id);
}

/** Sous-dossier (Médias, Frais…) d'un dossier d'archive. */
export function archiveSubFolder(account: ConnectedAccount, parent: DriveFileItem, name: string, cache: FolderCache = new Map()) {
  return folder(account, cache, name, parent.id);
}
