import "server-only";
import { format } from "date-fns";
import { getValidGoogleAccessToken } from "@/lib/google/accounts";
import { deleteFile, findOrCreateFolder, uploadFile } from "@/lib/google/drive";
import { getBoardDriveAccount } from "@/lib/board/teamDrive";

// Stockage des fichiers FIEF (photos du fil, plus tard documents) : le Drive du board, derrière une
// interface unique — le passage à OneDrive (Microsoft 365) ne touchera que ce fichier (même principe
// que src/lib/transfer/storage.ts). Fichiers jamais publics : servis aux membres par /api/fief/media/[id].
//
// Arborescence : FIEF / Fil d'actu / AAAA-MM / <fichier>
// OneDrive (Graph) : PUT /me/drive/items/{folder}:/{name}:/content (≤ 4 Mo), GET /me/drive/items/{id}/content.

export interface FiefStorage {
  /** Envoie un fichier (≤ 4 Mo) dans un sous-dossier de « FIEF » ; renvoie son identifiant. */
  put(folder: string[], file: { name: string; mimeType: string; data: Buffer }): Promise<string>;
  /** Contenu brut, pour le servir aux membres. */
  fetch(id: string): Promise<Response>;
  remove(id: string): Promise<void>;
}

const ROOT = "FIEF";

async function googleStorage(): Promise<FiefStorage | null> {
  const account = await getBoardDriveAccount();
  if (!account) return null;
  return {
    async put(folder, file) {
      let parent = (await findOrCreateFolder(account, { name: ROOT })).id;
      for (const name of folder) parent = (await findOrCreateFolder(account, { name, parentId: parent })).id;
      const created = await uploadFile(account, { name: file.name, parentId: parent, mimeType: file.mimeType, data: file.data });
      return created.id;
    },
    async fetch(id) {
      const token = await getValidGoogleAccessToken(account);
      return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    },
    async remove(id) {
      await deleteFile(account, id);
    },
  };
}

/** Stockage FIEF, ou null si aucun Drive n'est relié au board (Paramètres du board → Drive du board). */
export async function getFiefStorage(): Promise<FiefStorage | null> {
  return googleStorage();
}

export const feedFolder = (date = new Date()) => ["Fil d'actu", format(date, "yyyy-MM")];
