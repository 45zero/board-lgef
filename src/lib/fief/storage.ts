import "server-only";
import { format } from "date-fns";
import { getValidGoogleAccessToken } from "@/lib/google/accounts";
import { createResumableUploadSession, deleteFile, findOrCreateFolder, getFileParents, moveFile, uploadFile } from "@/lib/google/drive";
import { getBoardDriveAccount } from "@/lib/board/teamDrive";

// Stockage des fichiers FIEF (photos du fil, documents) : le Drive du board, derrière une interface
// unique — le passage à OneDrive (Microsoft 365) ne touchera que ce fichier (même principe que
// src/lib/transfer/storage.ts). Fichiers jamais publics : servis aux membres par nos routes /api/fief/*.
//
// Arborescence : FIEF / Fil d'actu / AAAA-MM ; FIEF / Documents / <dossier> ; FIEF / Documents / Personnels / <nom>.
// OneDrive (Graph) : PUT /me/drive/items/{folder}:/{name}:/content (≤ 4 Mo), POST …:/createUploadSession
// (gros fichiers), PATCH /me/drive/items/{id} { parentReference } (déplacement), GET …/content.

export interface FiefStorage {
  /** Envoie un petit fichier (≤ 4 Mo) dans un sous-dossier de « FIEF » ; renvoie son identifiant. */
  put(folder: string[], file: { name: string; mimeType: string; data: Buffer }): Promise<string>;
  /** Session d'envoi par morceaux (gros fichiers) ; les morceaux passent par notre serveur (relais). */
  createUpload(folder: string[], file: { name: string; mimeType: string }): Promise<string>;
  /** Range le fichier dans un autre sous-dossier de « FIEF ». */
  move(id: string, folder: string[]): Promise<void>;
  /** Contenu brut, pour le servir aux membres. */
  fetch(id: string): Promise<Response>;
  remove(id: string): Promise<void>;
  /** Lien d'ouverture du dossier dans le Drive (équipe FIEF, depuis le board). */
  folderUrl(folder: string[]): Promise<string>;
}

const ROOT = "FIEF";
const clean = (s: string) => s.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Sans nom";

async function googleStorage(): Promise<FiefStorage | null> {
  const account = await getBoardDriveAccount();
  if (!account) return null;
  const folderId = async (path: string[]) => {
    let parent = (await findOrCreateFolder(account, { name: ROOT })).id;
    for (const name of path) parent = (await findOrCreateFolder(account, { name: clean(name), parentId: parent })).id;
    return parent;
  };
  return {
    async put(folder, file) {
      const created = await uploadFile(account, { name: clean(file.name), parentId: await folderId(folder), mimeType: file.mimeType, data: file.data });
      return created.id;
    },
    async createUpload(folder, file) {
      const { uploadUrl } = await createResumableUploadSession(account, { name: clean(file.name), parentId: await folderId(folder), mimeType: file.mimeType || "application/octet-stream" });
      return uploadUrl;
    },
    async move(id, folder) {
      const [target, { parents }] = await Promise.all([folderId(folder), getFileParents(account, id)]);
      await moveFile(account, id, { fromParents: parents, toParent: target });
    },
    async fetch(id) {
      const token = await getValidGoogleAccessToken(account);
      return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    },
    async remove(id) {
      await deleteFile(account, id);
    },
    async folderUrl(folder) {
      return `https://drive.google.com/drive/folders/${encodeURIComponent(await folderId(folder))}`;
    },
  };
}

/** Stockage FIEF, ou null si aucun Drive n'est relié au board (Paramètres du board → Drive du board). */
export async function getFiefStorage(): Promise<FiefStorage | null> {
  return googleStorage();
}

export const feedFolder = (date = new Date()) => ["Fil d'actu", format(date, "yyyy-MM")];

/** Rangement d'un document : dossier partagé (ou « Divers »), sinon dossier personnel de sa propriétaire. */
export const documentFolder = (doc: { shared: boolean; folderName: string | null; ownerName: string }) =>
  doc.shared ? ["Documents", doc.folderName || "Divers"] : ["Documents", "Personnels", doc.ownerName];
