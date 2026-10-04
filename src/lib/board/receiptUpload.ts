"use client";

import { createClient } from "@/lib/supabase/client";
import { createReceiptUpload } from "@/app/actions/expense-scan";

const MAX_SIDE = 2000;

/**
 * Photo → JPEG ≤ 2000 px, orientation appliquée : HEIC de l'iPhone lisible partout, envoi rapide en
 * 4G. Si le navigateur ne sait pas décoder l'image, le fichier d'origine est envoyé tel quel (le
 * serveur la convertit à la lecture).
 */
export async function normalizePhoto(file: File): Promise<File> {
  const isImage = file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);
  if (!isImage || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    const base = (file.name || "photo").replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Dépose un justificatif dans expense_scans (URL signée) ; renvoie son chemin et son URL publique. */
export async function uploadReceipt(original: File): Promise<{ path: string; url: string; type: string }> {
  const file = await normalizePhoto(original);
  const name = file.name && file.name.includes(".") ? file.name : `photo-${Date.now()}.jpg`;
  const target = await createReceiptUpload(name);
  if (target.error) throw new Error(target.error);
  const { error } = await createClient()
    .storage.from("expense_scans")
    .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || undefined });
  if (error) throw new Error("Envoi du justificatif impossible.");
  return { path: target.path, url: target.publicUrl, type: file.type || "application/octet-stream" };
}

/** Types acceptés pour un justificatif : photos, PDF, feuilles de frais Excel / CSV. */
export const RECEIPT_ACCEPT = "image/*,application/pdf,.xlsx,.csv";
