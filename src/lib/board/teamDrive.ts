import "server-only";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getGoogleAccountById } from "@/lib/google/accounts";
import { archiveSubFolder, eventArchiveFolder, monthArchiveFolder } from "@/lib/google/archiveFolders";
import { createTaggedFolder, findFolderByAppProperty, getFileParents, moveFile } from "@/lib/google/drive";

// Pièces jointes de l'Espace Team : rangées dans le Drive du board, un dossier par carte, étiqueté
// avec l'id de la carte (propriété d'application Drive « teamCardId ») — le Drive fait office de
// registre, sans table en base :
//   LGEF Drive / AAAA / MM - Mois / JJ - Événement / Espace Team / <carte>     (carte liée à un événement)
//   LGEF Drive / AAAA / MM - Mois / Espace Team hors événement / <carte>       (mois de création de la carte)
// Le dossier suit la carte : lier, changer ou retirer l'événement le déplace, la renommer le renomme.
// Carte liée à un événement : les nouveaux fichiers vont dans l'événement lui-même (Documents ou
// Médias, voir l'API attachments/drive), étiquetés « teamCardId » pour que la carte les retrouve.

export const CARD_FOLDER_KEY = "teamCardId";
const EVENT_SUBFOLDER = "Espace Team";
const NO_EVENT_FOLDER = "Espace Team hors événement";

export type CardForDrive = { id: string; title: string; createdAt: string; event: { title: string; startDate: string } | null };

const clean = (s: string) => s.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Carte";

export async function getBoardDriveAccount() {
  const { data } = await createServiceClient().from("board_settings").select("drive_connected_account_id").eq("id", true).single();
  return data?.drive_connected_account_id ? getGoogleAccountById(data.drive_connected_account_id) : null;
}

type Account = NonNullable<Awaited<ReturnType<typeof getBoardDriveAccount>>>;

async function targetParent(account: Account, card: CardForDrive) {
  const cache = new Map();
  if (card.event) {
    const eventFolder = await eventArchiveFolder(account, { title: card.event.title, start: new Date(card.event.startDate) }, cache);
    return archiveSubFolder(account, eventFolder, EVENT_SUBFOLDER, cache);
  }
  return archiveSubFolder(account, await monthArchiveFolder(account, new Date(card.createdAt), cache), NO_EVENT_FOLDER, cache);
}

export function findCardFolder(account: Account, cardId: string) {
  return findFolderByAppProperty(account, CARD_FOLDER_KEY, cardId);
}

/** Dossier de la carte, créé au premier fichier et toujours rangé au bon endroit. */
export async function ensureCardFolder(account: Account, card: CardForDrive) {
  const parent = await targetParent(account, card);
  const existing = await findCardFolder(account, card.id);
  if (!existing) return createTaggedFolder(account, { name: clean(card.title), parentId: parent.id, appProperties: { [CARD_FOLDER_KEY]: card.id } });
  if (!existing.parents.includes(parent.id) || existing.name !== clean(card.title)) {
    await moveFile(account, existing.id, { fromParents: existing.parents, toParent: parent.id, name: clean(card.title) });
  }
  return { ...existing, parents: [parent.id] };
}

/** Après un changement de titre ou d'événement : range le dossier s'il existe (au mieux, sans bloquer). */
export async function syncCardFolder(card: CardForDrive) {
  try {
    const account = await getBoardDriveAccount();
    if (!account || !(await findCardFolder(account, card.id))) return;
    await ensureCardFolder(account, card);
  } catch (e) {
    console.error("[teamDrive.syncCardFolder]", e);
  }
}

const isMedia = (mime: string) => /^(image|video)\//.test(mime);
export { isMedia as isTeamMedia };

/** Dossier d'un événement pour un fichier : « Médias » (photo/vidéo) ou « Documents ». */
export async function eventFilesFolder(account: Account, event: { title: string; startDate: string }, mimeType: string) {
  const cache = new Map();
  const eventFolder = await eventArchiveFolder(account, { title: event.title, start: new Date(event.startDate) }, cache);
  return archiveSubFolder(account, eventFolder, isMedia(mimeType) ? "Médias" : "Documents", cache);
}

/**
 * Le fichier appartient-il à la carte ? Rangé dans son dossier, ou étiqueté pour elle (fichier
 * d'événement déposé depuis la carte). Renvoie ses infos et où il est, sinon null.
 */
export async function cardFileInfo(account: Account, cardId: string, fileId: string) {
  const [folder, file] = await Promise.all([findCardFolder(account, cardId), getFileParents(account, fileId).catch(() => null)]);
  if (!file || file.trashed) return null;
  if (folder && file.parents.includes(folder.id)) return { ...file, place: "card" as const };
  if (file.appProperties[CARD_FOLDER_KEY] === cardId) return { ...file, place: "event" as const };
  return null;
}
