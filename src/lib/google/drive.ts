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
