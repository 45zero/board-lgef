import "server-only";
import { Readable } from "stream";
import { google, drive_v3 } from "googleapis";
import { createOAuth2Client } from "@/lib/google/oauth";
import { getValidGoogleAccessToken } from "@/lib/google/accounts";
import type { ConnectedAccount } from "@/generated/prisma";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

async function driveClient(account: ConnectedAccount) {
  const accessToken = await getValidGoogleAccessToken(account);
  const auth = createOAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  iconLink: string;
  webViewLink: string;
  size: string | null;
  modifiedTime: string;
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
  };
}

export async function listFiles(
  account: ConnectedAccount,
  opts: { folderId?: string; query?: string }
): Promise<DriveFileItem[]> {
  const drive = await driveClient(account);
  const parent = opts.folderId ?? "root";
  const q = opts.query
    ? `'${parent}' in parents and trashed = false and name contains '${opts.query.replace(/'/g, "\\'")}'`
    : `'${parent}' in parents and trashed = false`;
  const { data } = await drive.files.list({
    q,
    fields: "files(id, name, mimeType, iconLink, webViewLink, size, modifiedTime)",
    orderBy: "folder,name",
    pageSize: 200,
  });
  return (data.files ?? []).map(mapFile);
}

export async function getFile(account: ConnectedAccount, fileId: string): Promise<DriveFileItem> {
  const drive = await driveClient(account);
  const { data } = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, iconLink, webViewLink, size, modifiedTime",
  });
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
    fields: "id, name, mimeType, iconLink, webViewLink, size, modifiedTime",
  });
  return mapFile(data);
}

export async function uploadFile(
  account: ConnectedAccount,
  params: { name: string; parentId?: string; mimeType: string; data: string }
): Promise<DriveFileItem> {
  const drive = await driveClient(account);
  const buffer = Buffer.from(params.data, "base64");
  const { data } = await drive.files.create({
    requestBody: {
      name: params.name,
      parents: [params.parentId ?? "root"],
    },
    media: {
      mimeType: params.mimeType,
      body: Readable.from(buffer),
    },
    fields: "id, name, mimeType, iconLink, webViewLink, size, modifiedTime",
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
