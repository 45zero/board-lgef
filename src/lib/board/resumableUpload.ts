"use client";

// Envoi reprenable (protocole TUS de Supabase Storage) vers une URL d'envoi signée
// (createSignedUploadUrl) : morceaux de 6 Mo, chaque morceau réessayé en cas de coupure, reprise à
// l'octet près. Indispensable pour les vidéos filmées au téléphone (centaines de Mo en 4G) : un
// envoi d'un seul tenant échoue à la moindre micro-coupure.

const CHUNK = 6 * 1024 * 1024; // taille imposée par Supabase (sauf le dernier morceau)
const RETRIES = 5;

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadResumableSigned(opts: {
  bucket: string;
  path: string;
  token: string;
  file: Blob;
  contentType: string;
  onProgress?: (sent: number, total: number) => void;
}) {
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable/sign`;
  const headers = {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    "x-signature": opts.token,
    "Tus-Resumable": "1.0.0",
  };
  const total = opts.file.size;

  const created = await fetch(base, {
    method: "POST",
    headers: {
      ...headers,
      "Upload-Length": String(total),
      "Upload-Metadata": `bucketName ${b64(opts.bucket)},objectName ${b64(opts.path)},contentType ${b64(opts.contentType)}`,
    },
  });
  const location = created.headers.get("location");
  if (!created.ok || !location) throw new Error(`dépôt refusé (${created.status}) ${(await created.text().catch(() => "")).slice(0, 160)}`.trim());

  let offset = 0;
  let failures = 0;
  while (offset < total) {
    try {
      const res = await fetch(location, {
        method: "PATCH",
        headers: { ...headers, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
        body: opts.file.slice(offset, offset + CHUNK),
      });
      if (res.status === 409 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`envoi refusé (${res.status}) ${(await res.text().catch(() => "")).slice(0, 160)}`.trim()), { fatal: true });
      offset = Number(res.headers.get("upload-offset") ?? offset + CHUNK);
      failures = 0;
      opts.onProgress?.(offset, total);
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || ++failures > RETRIES) throw e instanceof Error ? e : new Error("réseau coupé");
      await wait(1000 * failures);
      // Où en est le serveur ? (le morceau a pu arriver malgré l'erreur)
      const head = await fetch(location, { method: "HEAD", headers }).catch(() => null);
      const at = Number(head?.headers.get("upload-offset"));
      if (head?.ok && Number.isFinite(at)) offset = at;
    }
  }
}
