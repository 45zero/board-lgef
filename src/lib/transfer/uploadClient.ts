"use client";

// LGEF Transfer — envoi d'un fichier du navigateur vers le Drive du board, par morceaux de 4 Mio
// (multiple de 256 Kio exigé par Google, sous la limite de requête de l'hébergeur), chaque morceau
// réessayé, reprise à l'octet près après une coupure (4G, wifi de stade…).
//   relay = true  : Drive Google, via /api/transfer/chunk (Google refuse l'envoi direct — CORS)
//   relay = false : OneDrive, envoi direct sur l'URL pré-authentifiée de la session Graph

const CHUNK = 4 * 1024 * 1024;
const RETRIES = 6;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FatalUploadError extends Error {}

/** « bytes=0-12345 » → prochain octet attendu (12346) ; absent → 0. */
const nextOffset = (range: string | null) => {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
};

export async function uploadFileToTransfer(opts: {
  file: File;
  target: { uploadUrl: string; relay: boolean };
  /** Id du transfert (ou « ads ») et jeton d'envoi signé. */
  scope: { id: string; token: string };
  onProgress?: (sentInFile: number) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const { file, target, scope } = opts;
  const size = file.size;

  const put = (range: string, body?: Blob) =>
    target.relay
      ? fetch("/api/transfer/chunk", {
          method: "PUT",
          signal: opts.signal,
          headers: {
            "X-Transfer-Id": scope.id,
            "X-Transfer-Token": scope.token,
            "X-Upload-Url": target.uploadUrl,
            "X-File-Content-Type": file.type || "application/octet-stream",
            "Content-Range": range,
          },
          body,
        })
      : fetch(target.uploadUrl, { method: "PUT", signal: opts.signal, headers: { "Content-Range": range }, body });

  /** Réponse finale → id du fichier dans le Drive. */
  const finish = async (res: Response) => {
    const json = await res.json().catch(() => null);
    const id = json?.id as string | undefined;
    if (!id) throw new FatalUploadError("Réponse du Drive inattendue.");
    return id;
  };

  /** Où en est l'envoi côté Drive ? (après une erreur, le morceau a pu arriver) */
  const status = async (): Promise<number | string> => {
    if (!target.relay) {
      const res = await fetch(target.uploadUrl, { signal: opts.signal });
      const json = await res.json().catch(() => null);
      const first = (json?.nextExpectedRanges?.[0] as string | undefined)?.split("-")[0];
      return first ? Number(first) : 0;
    }
    const res = await put(`bytes */${size}`);
    if (res.status === 308) return nextOffset(res.headers.get("x-range"));
    if (res.ok) return finish(res);
    throw new FatalUploadError(`Envoi interrompu (${res.status}).`);
  };

  if (size === 0) {
    const res = await put("bytes */0");
    if (!res.ok) throw new Error(`Envoi refusé (${res.status}).`);
    return finish(res);
  }

  let offset = 0;
  let failures = 0;
  while (true) {
    const end = Math.min(offset + CHUNK, size);
    try {
      const res = await put(`bytes ${offset}-${end - 1}/${size}`, file.slice(offset, end));
      if (res.status === 308 || res.status === 202) {
        offset = target.relay ? nextOffset(res.headers.get("x-range")) || end : end;
        failures = 0;
        opts.onProgress?.(offset);
        continue;
      }
      if (res.ok) {
        opts.onProgress?.(size);
        return await finish(res);
      }
      const err = await res.json().catch(() => null);
      if ([400, 401, 403, 404, 409].includes(res.status)) throw new FatalUploadError(err?.error ?? `Envoi refusé (${res.status}).`);
      throw new Error(err?.error ?? `HTTP ${res.status}`);
    } catch (e) {
      if (opts.signal?.aborted) throw new FatalUploadError("Envoi annulé.");
      if (e instanceof FatalUploadError || ++failures > RETRIES) throw e instanceof Error ? e : new Error("Réseau coupé.");
      await wait(1500 * failures);
      const at = await status().catch(() => null);
      if (typeof at === "string") return at;
      if (typeof at === "number") {
        offset = at;
        opts.onProgress?.(offset);
      }
    }
  }
}
