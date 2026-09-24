"use client";

import {
  initCampaignAssetUpload,
  finalizeCampaignImageAsset,
  finalizeCampaignVideoAsset,
  finalizeCampaignPdfAsset,
  type CampaignAssetField,
} from "@/app/actions/registration";

const CHUNK_SIZE = 3 * 1024 * 1024;

/** Upload direct-navigateur vers Drive (même relais par morceaux que les pièces jointes d'événement) — évite CORS et le 413. */
async function putFileToDriveViaRelay(eventId: string, uploadUrl: string, file: File): Promise<{ id: string; webViewLink?: string }> {
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const res = await fetch(`/api/events/${eventId}/attachments/drive/chunk`, {
      method: "PUT",
      headers: {
        "X-Upload-Url": uploadUrl,
        "X-File-Content-Type": file.type || "application/octet-stream",
        "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
      },
      body: chunk,
    });
    if (res.status === 308) {
      offset = end;
      continue;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error ?? `Échec de l'envoi (${res.status}).`);
    }
    return res.json();
  }
  throw new Error("Échec de l'envoi (fichier vide).");
}

export async function uploadCampaignImageAsset(campaignId: string, field: CampaignAssetField, file: File) {
  const { uploadUrl, eventId } = await initCampaignAssetUpload(campaignId, file.name, file.type);
  const driveFile = await putFileToDriveViaRelay(eventId, uploadUrl, file);
  return finalizeCampaignImageAsset(campaignId, field, driveFile.id);
}

export async function uploadCampaignVideoAsset(campaignId: string, file: File) {
  const { uploadUrl, eventId } = await initCampaignAssetUpload(campaignId, file.name, file.type);
  const driveFile = await putFileToDriveViaRelay(eventId, uploadUrl, file);
  await finalizeCampaignVideoAsset(campaignId, driveFile.id, driveFile.webViewLink ?? "");
}

export async function uploadCampaignPdfAsset(campaignId: string, file: File) {
  const { uploadUrl, eventId } = await initCampaignAssetUpload(campaignId, file.name, file.type);
  const driveFile = await putFileToDriveViaRelay(eventId, uploadUrl, file);
  await finalizeCampaignPdfAsset(campaignId, driveFile.id, file.name);
}
