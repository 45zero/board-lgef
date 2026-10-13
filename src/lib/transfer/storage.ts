import "server-only";
import { format } from "date-fns";
import { getValidGoogleAccessToken } from "@/lib/google/accounts";
import { createResumableUploadSession, ensurePublicViewAccess, findOrCreateFolder, getFile, getFileParents, searchFiles, trashFile } from "@/lib/google/drive";
import { getBoardDriveAccount } from "@/lib/board/teamDrive";
import type { TransferPreview } from "@/lib/transfer/shared";

// Stockage de LGEF Transfer : le Drive du board, derrière une interface unique pour que le passage
// du Drive Google à OneDrive (Microsoft 365 / Outlook) ne touche que ce fichier.
//
// Arborescence : LGEF Transfer / AAAA-MM / <date> - <expéditeur> - <code>
//
// OneDrive (à brancher quand le compte Microsoft du board sera connecté) — API Graph :
//   dossier      POST /me/drive/items/{parent}/children  { name, folder: {} }
//   envoi        POST /me/drive/items/{folder}:/{name}:/createUploadSession → uploadUrl pré-authentifiée,
//                que le navigateur peut viser DIRECTEMENT (CORS autorisé) : relay = false
//   téléchargement GET /me/drive/items/{id}?select=@microsoft.graph.downloadUrl (lien court, sans partage public)
//   aperçu       POST /me/drive/items/{id}/preview → getUrl (iframe)
//   corbeille    DELETE /me/drive/items/{id}

export type { TransferPreview };

export interface TransferStorage {
  provider: "google" | "microsoft";
  /** Dossier d'un transfert (créé au besoin). */
  transferFolder(name: string, date: Date): Promise<string>;
  /** Dossier fixe sous « LGEF Transfer » (ex. « Publicités »). */
  namedFolder(name: string): Promise<string>;
  /** Session d'envoi d'un fichier ; relay : le navigateur doit passer par /api/transfer/chunk. */
  createUpload(folderId: string, file: { name: string; mimeType: string; size: number }): Promise<{ uploadUrl: string; relay: boolean }>;
  /** Fichier réellement arrivé : taille, dossiers parents. */
  fileInfo(fileId: string): Promise<{ name: string; mimeType: string; size: number; parents: string[]; trashed: boolean }>;
  /** Rend le fichier téléchargeable par lien (sans compte). */
  publish(fileId: string): Promise<void>;
  /** Retire l'accès par lien (transfert archivé arrivé à expiration : le fichier reste, privé). */
  unpublish(fileId: string): Promise<void>;
  /** URL de téléchargement direct (le fichier ne transite pas par nos serveurs). */
  downloadUrl(fileId: string): Promise<string>;
  /** Aperçu affichable dans la page de téléchargement. */
  preview(fileId: string, mimeType: string): TransferPreview;
  /** Contenu brut (pubs : servies par nos serveurs avec cache) ; `range` : en-tête Range transmis (vidéo sur Safari). */
  fetchMedia(fileId: string, range?: string | null): Promise<Response>;
  trash(fileId: string): Promise<void>;
  /** Recherche dans le Drive du board (envoi depuis le board sans recharger) — fichiers téléchargeables seulement. */
  search(query: string): Promise<{ id: string; name: string; size: number; mimeType: string; modifiedTime: string }[]>;
}

const ROOT = "LGEF Transfer";
const clean = (s: string) => s.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Transfert";

async function googleStorage(): Promise<TransferStorage | null> {
  const account = await getBoardDriveAccount();
  if (!account) return null;
  const root = () => findOrCreateFolder(account, { name: ROOT });

  return {
    provider: "google",
    async transferFolder(name, date) {
      const month = await findOrCreateFolder(account, { name: format(date, "yyyy-MM"), parentId: (await root()).id });
      const folder = await findOrCreateFolder(account, { name: clean(name), parentId: month.id });
      return folder.id;
    },
    async namedFolder(name) {
      return (await findOrCreateFolder(account, { name: clean(name), parentId: (await root()).id })).id;
    },
    async createUpload(folderId, file) {
      const { uploadUrl } = await createResumableUploadSession(account, { name: file.name, parentId: folderId, mimeType: file.mimeType || "application/octet-stream" });
      return { uploadUrl, relay: true };
    },
    async fileInfo(fileId) {
      const [meta, parents] = await Promise.all([getFile(account, fileId), getFileParents(account, fileId)]);
      return { name: meta.name, mimeType: meta.mimeType, size: Number(meta.size ?? 0), parents: parents.parents, trashed: parents.trashed };
    },
    async publish(fileId) {
      await ensurePublicViewAccess(account, fileId);
    },
    async unpublish(fileId) {
      const token = await getValidGoogleAccessToken(account);
      const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`;
      const res = await fetch(`${base}?fields=permissions(id,type)`, { headers: { Authorization: `Bearer ${token}` } });
      const { permissions = [] } = (await res.json().catch(() => ({}))) as { permissions?: { id: string; type: string }[] };
      await Promise.all(permissions.filter((p) => p.type === "anyone").map((p) => fetch(`${base}/${p.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })));
    },
    async downloadUrl(fileId) {
      return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
    },
    preview(fileId, mimeType) {
      const id = encodeURIComponent(fileId);
      if (mimeType.startsWith("image/")) return { kind: "image", url: `https://drive.google.com/thumbnail?id=${id}&sz=w2000` };
      if (mimeType.startsWith("video/") || mimeType.startsWith("audio/") || mimeType === "application/pdf" || mimeType.startsWith("text/") || /officedocument|msword|ms-excel|ms-powerpoint/.test(mimeType)) {
        return { kind: "iframe", url: `https://drive.google.com/file/d/${id}/preview` };
      }
      return { kind: "none" };
    },
    async fetchMedia(fileId, range) {
      const token = await getValidGoogleAccessToken(account);
      return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
        headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) },
      });
    },
    async trash(fileId) {
      await trashFile(account, fileId);
    },
    async search(query) {
      // Documents Google natifs exclus : pas de fichier brut à télécharger.
      const files = await searchFiles(account, query);
      return files
        .filter((f) => !f.mimeType.startsWith("application/vnd.google-apps."))
        .map((f) => ({ id: f.id, name: f.name, size: Number(f.size ?? 0), mimeType: f.mimeType, modifiedTime: f.modifiedTime }));
    },
  };
}

/** Stockage du board, ou null si aucun Drive n'est configuré (Paramètres du board → Drive du board). */
export async function getTransferStorage(): Promise<TransferStorage | null> {
  return googleStorage();
}
