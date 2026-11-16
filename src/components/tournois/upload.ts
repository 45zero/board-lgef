"use client";

// Envoi d'une pièce de dossier de tournoi par morceaux de 4 Mo vers /api/tournoi/chunk (relais Drive),
// avec reprise après coupure (fréquent au téléphone) : le serveur dit où le Drive en est.

const CHUNK = 4 * 1024 * 1024;

const nextOffset = (res: Response, fallback: number) => {
  const range = res.headers.get("x-range");
  return range ? Number(range.split("-")[1]) + 1 : fallback;
};

export async function uploadPiece(file: File, fileId: string, onProgress: (ratio: number) => void) {
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size);
    try {
      const res = await fetch("/api/tournoi/chunk", {
        method: "PUT",
        headers: { "x-file-id": fileId, "Content-Range": `bytes ${offset}-${end - 1}/${file.size}` },
        body: file.slice(offset, end),
      });
      if (res.status === 308) offset = nextOffset(res, end);
      else if (res.ok) offset = file.size;
      else {
        const json = await res.json().catch(() => ({}));
        throw Object.assign(new Error(json.error ?? "Envoi interrompu."), { fatal: res.status < 500 });
      }
      failures = 0;
      onProgress(offset / file.size);
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || ++failures > 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * failures));
      const probe = await fetch("/api/tournoi/chunk", { method: "PUT", headers: { "x-file-id": fileId, "Content-Range": `bytes */${file.size}` } }).catch(() => null);
      if (probe?.ok || probe?.status === 409) offset = file.size;
      else if (probe?.status === 308) offset = nextOffset(probe, 0);
    }
  }
}
