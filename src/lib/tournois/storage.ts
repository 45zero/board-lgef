import "server-only";
import { getValidGoogleAccessToken } from "@/lib/google/accounts";
import { createResumableUploadSession, findOrCreateFolder } from "@/lib/google/drive";
import { getBoardDriveAccount } from "@/lib/board/teamDrive";

// Pièces des déclarations de tournoi (affiches, règlements, pièces jointes des réponses) : Drive du board,
// derrière cette interface — le passage à OneDrive ne touchera que ce fichier (comme src/lib/fief/storage.ts).
// Jamais publiques : servies par /api/tournoi/file après contrôle (board ou lien de réponse).
// Arborescence : Tournois / <saison> / <district> / <n° de dossier — nom>.

export interface TournamentStorage {
  /** Session d'envoi par morceaux ; les morceaux passent par notre serveur (/api/tournoi/chunk). */
  createUpload(folder: string[], file: { name: string; mimeType: string }): Promise<string>;
  fetch(id: string): Promise<Response>;
  folderUrl(folder: string[]): Promise<string>;
}

const ROOT = "Tournois";
const clean = (s: string) => s.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Sans nom";

/** Saison sportive d'une date : juillet → juin (« 2026-2027 »). */
export function seasonOf(isoDate: string) {
  const [y, m] = isoDate.split("-").map(Number);
  return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export const declarationFolder = (d: { ref: string | null; title: string; start_date: string; districtName: string | null }) => [
  seasonOf(d.start_date),
  d.districtName || "Sans district",
  `${d.ref ?? "Dossier"} — ${d.title}`,
];

export async function getTournamentStorage(): Promise<TournamentStorage | null> {
  const account = await getBoardDriveAccount();
  if (!account) return null;
  const folderId = async (path: string[]) => {
    let parent = (await findOrCreateFolder(account, { name: ROOT })).id;
    for (const name of path) parent = (await findOrCreateFolder(account, { name: clean(name), parentId: parent })).id;
    return parent;
  };
  return {
    async createUpload(folder, file) {
      const { uploadUrl } = await createResumableUploadSession(account, {
        name: clean(file.name),
        parentId: await folderId(folder),
        mimeType: file.mimeType || "application/octet-stream",
      });
      return uploadUrl;
    },
    async fetch(id) {
      const token = await getValidGoogleAccessToken(account);
      return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    },
    async folderUrl(folder) {
      return `https://drive.google.com/drive/folders/${encodeURIComponent(await folderId(folder))}`;
    },
  };
}
