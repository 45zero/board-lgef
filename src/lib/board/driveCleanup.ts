import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { getBoardDriveAccount } from "@/lib/board/teamDrive";
import { trashFile } from "@/lib/google/drive";
import { publishedNetworks, type PublishInfo, type StandaloneMedia } from "@/lib/social/targets";

// Nettoyage du Drive du board (cron quotidien /api/cron/drive-cleanup) : les photos et vidéos d'une
// publication en ligne sur les réseaux depuis 7 jours sont mises à la corbeille du Drive (vidée par
// Google au bout de 30 jours). Garde-fous :
// - publication « publiée » ET au moins un réseau confirmé (publish_info) — un échec ne compte pas ;
// - un fichier encore utilisé par une publication à publier, programmée ou trop récente est gardé ;
// - photos et vidéos seulement : documents, justificatifs et factures ne sont jamais touchés.

type Service = ReturnType<typeof createServiceClient>;

export const PURGE_AFTER_DAYS = 7;
const MAX_PER_RUN = 150;
const isMedia = (type: string | null | undefined) => /^(image|video)\//.test(type ?? "");

type Pub = {
  id: string;
  status: string;
  published_at: string | null;
  publish_info: unknown;
  file_ids: string[] | null;
  media: unknown;
  media_purged_at: string | null;
};

const eligible = (p: Pub, cutoff: number) =>
  p.status === "published" && !!p.published_at && new Date(p.published_at).getTime() <= cutoff && publishedNetworks(p.publish_info as PublishInfo | null).length > 0;

/** Fichiers qui seront retirés au prochain passage (aperçu) ou retrait effectif. */
export async function purgePublishedMedia(service: Service, { dryRun = false } = {}) {
  const cutoff = Date.now() - PURGE_AFTER_DAYS * 86_400_000;
  const { data, error } = await service.from("media_publications").select("id, status, published_at, publish_info, file_ids, media, media_purged_at");
  if (error) throw new Error(error.message);
  const pubs = (data ?? []) as Pub[];

  // Un fichier partagé avec une publication non éligible (à publier, programmée, récente) est gardé.
  const keep = new Set(pubs.filter((p) => !eligible(p, cutoff)).flatMap((p) => p.file_ids ?? []));
  const candidates = [...new Set(pubs.filter((p) => eligible(p, cutoff)).flatMap((p) => p.file_ids ?? []))].filter((id) => !keep.has(id));

  const { data: files } = candidates.length
    ? await service
        .from("event_files")
        .select("id, drive_file_id, content_type, filename, size_bytes")
        .in("id", candidates)
        .eq("storage_provider", "drive")
        .is("drive_purged_at", null)
    : { data: [] };
  const eventFiles = (files ?? []).filter((f) => f.drive_file_id && isMedia(f.content_type));
  const standalone = pubs.filter((p) => eligible(p, cutoff) && !p.media_purged_at && ((p.media as StandaloneMedia[] | null) ?? []).length > 0);

  const bytes = eventFiles.reduce((n, f) => n + (f.size_bytes ?? 0), 0);
  if (dryRun) return { files: eventFiles.length + standalone.length, bytes, trashed: 0, errors: [] as string[] };

  const account = await getBoardDriveAccount();
  if (!account) return { files: 0, bytes: 0, trashed: 0, errors: ["Aucun Drive de board configuré."] };

  const errors: string[] = [];
  let trashed = 0;
  // Déjà supprimé à la main dans le Drive : on le note comme retiré, sans erreur.
  const trash = async (fileId: string) => {
    try {
      await trashFile(account, fileId);
    } catch (e) {
      const status = (e as { code?: number; status?: number }).code ?? (e as { status?: number }).status;
      if (status !== 404) throw e;
    }
  };

  for (const f of eventFiles.slice(0, MAX_PER_RUN)) {
    try {
      await trash(f.drive_file_id!);
      await service.from("event_files").update({ drive_purged_at: new Date().toISOString() }).eq("id", f.id);
      trashed++;
    } catch (e) {
      errors.push(`${f.filename} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const p of standalone.slice(0, Math.max(0, MAX_PER_RUN - trashed))) {
    try {
      for (const m of (p.media as StandaloneMedia[]).filter((m) => isMedia(m.content_type))) await trash(m.drive_file_id);
      await service.from("media_publications").update({ media_purged_at: new Date().toISOString() }).eq("id", p.id);
      trashed++;
    } catch (e) {
      errors.push(`Publication ${p.id} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { files: eventFiles.length + standalone.length, bytes, trashed, errors };
}
