import "server-only";
import { Readable } from "stream";
import { google, drive_v3 } from "googleapis";
import { createOAuth2Client } from "@/lib/google/oauth";
import { getValidGoogleAccessToken } from "@/lib/google/accounts";
import type { ConnectedAccount } from "@/generated/prisma";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id, name, mimeType, iconLink, webViewLink, size, modifiedTime, owners(displayName)";

async function driveClient(account: ConnectedAccount) {
  const accessToken = await getValidGoogleAccessToken(account);
  const auth = createOAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export type DriveTypeFilter =
  | "all"
  | "folder"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "pdf"
  | "image"
  | "video";

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  iconLink: string;
  webViewLink: string;
  size: string | null;
  modifiedTime: string;
  ownerName: string;
}

function mapFile(f: drive_v3.Schema$File): DriveFileItem {
  return {
    id: f.id!,
    name: f.name ?? "(sans nom)",
    mimeType: f.mimeType ?? "",
    isFolder: f.mimeType === FOLDER_MIME_TYPE,
    iconLink: f.iconLink ?? "",
    webViewLink: f.webViewLink ?? "",
    size: f.size ?? null,
    modifiedTime: f.modifiedTime ?? "",
    ownerName: f.owners?.[0]?.displayName ?? "",
  };
}

function mimeTypeClause(type: DriveTypeFilter | undefined): string | null {
  switch (type) {
    case "folder":
      return `mimeType = '${FOLDER_MIME_TYPE}'`;
    case "document":
      return "mimeType = 'application/vnd.google-apps.document'";
    case "spreadsheet":
      return "mimeType = 'application/vnd.google-apps.spreadsheet'";
    case "presentation":
      return "mimeType = 'application/vnd.google-apps.presentation'";
    case "pdf":
      return "mimeType = 'application/pdf'";
    case "image":
      return "mimeType contains 'image/'";
    case "video":
      return "mimeType contains 'video/'";
    default:
      return null;
  }
}

export async function listFiles(
  account: ConnectedAccount,
  opts: {
    folderId?: string;
    query?: string;
    sharedWithMe?: boolean;
    type?: DriveTypeFilter;
    modifiedAfter?: string;
  }
): Promise<DriveFileItem[]> {
  const drive = await driveClient(account);
  const clauses = ["trashed = false"];

  // "Partagé avec moi" n'a pas de notion de dossier racine côté API — seule la
  // racine de la vue utilise sharedWithMe ; une fois qu'on navigue dans un
  // dossier (partagé ou non), c'est une relation parents classique.
  if (opts.sharedWithMe && !opts.folderId) {
    clauses.push("sharedWithMe = true");
  } else {
    clauses.push(`'${opts.folderId ?? "root"}' in parents`);
  }

  if (opts.query) {
    clauses.push(`name contains '${opts.query.replace(/'/g, "\\'")}'`);
  }
  const typeClause = mimeTypeClause(opts.type);
  if (typeClause) clauses.push(typeClause);
  if (opts.modifiedAfter) clauses.push(`modifiedTime > '${opts.modifiedAfter}'`);

  const { data } = await drive.files.list({
    q: clauses.join(" and "),
    fields: `files(${FILE_FIELDS})`,
    orderBy: "folder,name",
    pageSize: 200,
  });
  return (data.files ?? []).map(mapFile);
}

export async function getFile(account: ConnectedAccount, fileId: string): Promise<DriveFileItem> {
  const drive = await driveClient(account);
  const { data } = await drive.files.get({ fileId, fields: FILE_FIELDS });
  return mapFile(data);
}

export async function createFolder(
  account: ConnectedAccount,
  params: { name: string; parentId?: string }
): Promise<DriveFileItem> {
  const drive = await driveClient(account);
  const { data } = await drive.files.create({
    requestBody: {
      name: params.name,
      mimeType: FOLDER_MIME_TYPE,
      parents: [params.parentId ?? "root"],
    },
    fields: FILE_FIELDS,
  });
  return mapFile(data);
}

/** Réutilise un dossier existant du même nom sous parentId, sinon en crée un — évite les doublons "Médias". */
export async function findOrCreateFolder(
  account: ConnectedAccount,
  params: { name: string; parentId?: string }
): Promise<DriveFileItem> {
  const candidates = await listFiles(account, { folderId: params.parentId, query: params.name, type: "folder" });
  const match = candidates.find((f) => f.name === params.name);
  if (match) return match;
  return createFolder(account, params);
}

export async function uploadFile(
  account: ConnectedAccount,
  params: { name: string; parentId?: string; mimeType: string; data: string | Buffer; description?: string }
): Promise<DriveFileItem> {
  const drive = await driveClient(account);
  const buffer = Buffer.isBuffer(params.data) ? params.data : Buffer.from(params.data, "base64");
  const { data } = await drive.files.create({
    requestBody: {
      name: params.name,
      parents: [params.parentId ?? "root"],
      description: params.description,
    },
    media: {
      mimeType: params.mimeType,
      body: Readable.from(buffer),
    },
    fields: FILE_FIELDS,
  });
  return mapFile(data);
}

/**
 * Session d'upload direct-navigateur (protocole resumable Drive) — le fichier
 * n'a jamais à transiter par notre serveur (évite toute limite de taille de
 * requête côté hébergeur), le client PUT ses octets directement sur l'URL
 * retournée par Google.
 */
export async function createResumableUploadSession(
  account: ConnectedAccount,
  params: { name: string; parentId?: string; mimeType: string; description?: string; appProperties?: Record<string, string> }
): Promise<{ uploadUrl: string }> {
  const accessToken = await getValidGoogleAccessToken(account);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": params.mimeType,
      },
      body: JSON.stringify({
        name: params.name,
        parents: [params.parentId ?? "root"],
        description: params.description,
        appProperties: params.appProperties,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Échec de l'initialisation de l'upload Drive : ${await res.text()}`);
  }
  const uploadUrl = res.headers.get("location");
  if (!uploadUrl) throw new Error("URL de session d'upload Drive absente.");
  return { uploadUrl };
}

export async function downloadFile(
  account: ConnectedAccount,
  fileId: string
): Promise<{ data: string; mimeType: string; name: string }> {
  const drive = await driveClient(account);
  const meta = await drive.files.get({ fileId, fields: "name, mimeType" });
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  const buffer = Buffer.from(res.data as ArrayBuffer);
  return {
    data: buffer.toString("base64"),
    mimeType: meta.data.mimeType ?? "application/octet-stream",
    name: meta.data.name ?? "fichier",
  };
}

/** Corbeille Drive plutôt que suppression définitive — cohérent avec trashMessage côté Gmail. */
export async function trashFile(account: ConnectedAccount, fileId: string) {
  const drive = await driveClient(account);
  await drive.files.update({ fileId, requestBody: { trashed: true } });
}

/** Rend un fichier consultable par quiconque a le lien — nécessaire pour qu'un partage soit ouvrable hors du compte Drive du board. */
export async function ensurePublicViewAccess(account: ConnectedAccount, fileId: string) {
  const drive = await driveClient(account);
  await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });
}

/* ---------- Dossiers étiquetés (pièces jointes de l'Espace Team) ---------- */

/** Fichier avec ses propriétés d'application et sa date de création (pièces jointes). */
export type DriveTaggedFile = DriveFileItem & { createdTime: string; appProperties: Record<string, string> };

const TAGGED_FIELDS = `${FILE_FIELDS}, createdTime, appProperties, parents`;

const toTagged = (f: drive_v3.Schema$File): DriveTaggedFile => ({
  ...mapFile(f),
  createdTime: f.createdTime ?? "",
  appProperties: (f.appProperties as Record<string, string> | undefined) ?? {},
});

/** Premier dossier (non supprimé) portant cette propriété d'application, avec ses parents. */
export async function findFolderByAppProperty(account: ConnectedAccount, key: string, value: string) {
  const drive = await driveClient(account);
  const { data } = await drive.files.list({
    q: `mimeType = '${FOLDER_MIME_TYPE}' and trashed = false and appProperties has { key='${key}' and value='${value.replace(/'/g, "\\'")}' }`,
    fields: "files(id, name, parents)",
    pageSize: 1,
  });
  const f = data.files?.[0];
  return f?.id ? { id: f.id, name: f.name ?? "", parents: f.parents ?? [] } : null;
}

export async function createTaggedFolder(account: ConnectedAccount, params: { name: string; parentId: string; appProperties: Record<string, string> }) {
  const drive = await driveClient(account);
  const { data } = await drive.files.create({
    requestBody: { name: params.name, mimeType: FOLDER_MIME_TYPE, parents: [params.parentId], appProperties: params.appProperties },
    fields: "id, name, parents",
  });
  return { id: data.id!, name: data.name ?? params.name, parents: data.parents ?? [params.parentId] };
}

/** Range un fichier/dossier sous un autre parent (et/ou le renomme). */
export async function moveFile(account: ConnectedAccount, fileId: string, params: { fromParents: string[]; toParent?: string; name?: string }) {
  const drive = await driveClient(account);
  const moving = params.toParent && !params.fromParents.includes(params.toParent);
  await drive.files.update({
    fileId,
    addParents: moving ? params.toParent : undefined,
    removeParents: moving ? params.fromParents.join(",") : undefined,
    requestBody: params.name ? { name: params.name } : {},
  });
}

export async function listFolderTagged(account: ConnectedAccount, folderId: string): Promise<DriveTaggedFile[]> {
  const drive = await driveClient(account);
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: `files(${TAGGED_FIELDS})`,
    orderBy: "createdTime desc",
    pageSize: 200,
  });
  return (data.files ?? []).map(toTagged);
}

export async function getFileParents(account: ConnectedAccount, fileId: string) {
  const drive = await driveClient(account);
  const { data } = await drive.files.get({ fileId, fields: "id, name, mimeType, parents, trashed, appProperties" });
  return {
    name: data.name ?? "fichier",
    mimeType: data.mimeType ?? "",
    parents: data.parents ?? [],
    trashed: !!data.trashed,
    appProperties: (data.appProperties as Record<string, string> | undefined) ?? {},
  };
}

/** Fichiers (hors dossiers, non supprimés) portant cette propriété d'application, où qu'ils soient. */
export async function listFilesByAppProperty(account: ConnectedAccount, key: string, value: string): Promise<DriveTaggedFile[]> {
  const drive = await driveClient(account);
  const { data } = await drive.files.list({
    q: `mimeType != '${FOLDER_MIME_TYPE}' and trashed = false and appProperties has { key='${key}' and value='${value.replace(/'/g, "\\'")}' }`,
    fields: `files(${TAGGED_FIELDS})`,
    orderBy: "createdTime desc",
    pageSize: 200,
  });
  return (data.files ?? []).map(toTagged);
}

/** Recherche dans tout le Drive (fichiers seulement), les plus récents d'abord. */
export async function searchFiles(account: ConnectedAccount, query: string): Promise<DriveFileItem[]> {
  const drive = await driveClient(account);
  const clauses = ["trashed = false", `mimeType != '${FOLDER_MIME_TYPE}'`];
  if (query.trim()) clauses.push(`name contains '${query.trim().replace(/'/g, "\\'")}'`);
  const { data } = await drive.files.list({ q: clauses.join(" and "), fields: `files(${FILE_FIELDS})`, orderBy: "modifiedTime desc", pageSize: 30 });
  return (data.files ?? []).map(mapFile);
}

const GOOGLE_EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: ".pdf" },
};

/** Contenu d'un fichier ; les documents Google sont exportés (PDF, ou XLSX pour les feuilles). */
export async function readFileContent(account: ConnectedAccount, fileId: string, maxBytes: number) {
  const drive = await driveClient(account);
  const { data: meta } = await drive.files.get({ fileId, fields: "name, mimeType, size" });
  const mimeType = meta.mimeType ?? "application/octet-stream";
  if (meta.size && Number(meta.size) > maxBytes) throw new Error(`Fichier trop lourd (max ${Math.round(maxBytes / 1048576)} Mo).`);
  const exp = GOOGLE_EXPORTS[mimeType];
  if (mimeType.startsWith("application/vnd.google-apps.") && !exp) throw new Error("Ce type de document Google ne peut pas être joint.");
  const res = exp
    ? await drive.files.export({ fileId, mimeType: exp.mime }, { responseType: "arraybuffer" })
    : await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const data = Buffer.from(res.data as ArrayBuffer);
  if (data.length > maxBytes) throw new Error(`Fichier trop lourd (max ${Math.round(maxBytes / 1048576)} Mo).`);
  const name = meta.name ?? "fichier";
  return { data, mimeType: exp?.mime ?? mimeType, name: exp && !name.toLowerCase().endsWith(exp.ext) ? `${name}${exp.ext}` : name };
}

export async function uploadTaggedFile(
  account: ConnectedAccount,
  params: { name: string; parentId: string; mimeType: string; data: Buffer; description?: string; appProperties?: Record<string, string> }
) {
  const drive = await driveClient(account);
  const { data } = await drive.files.create({
    requestBody: { name: params.name, parents: [params.parentId], description: params.description, appProperties: params.appProperties },
    media: { mimeType: params.mimeType, body: Readable.from(params.data) },
    fields: TAGGED_FIELDS,
  });
  return toTagged(data);
}

/** Partage un fichier en lecture avec une adresse e-mail : Google envoie l'invitation (message facultatif). */
export async function shareFileWithEmail(account: ConnectedAccount, fileId: string, email: string, message?: string) {
  const drive = await driveClient(account);
  await drive.permissions.create({
    fileId,
    sendNotificationEmail: true,
    emailMessage: message || undefined,
    requestBody: { role: "reader", type: "user", emailAddress: email },
  });
}
