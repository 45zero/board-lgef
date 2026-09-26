"use client";

import { createClient } from "@/lib/supabase/client";
import { publishSocial } from "@/app/actions/social";
import { ensureFilePublication, publishPublicationToYoutube } from "@/lib/board/mediaPublications";
import { describeFailures, type FacebookRegion, type PublishInfo, type StandaloneMedia } from "@/lib/social/targets";

const BUCKET = "event-files";

export type { PublishTarget, SocialPublishTarget, PublishInfo } from "@/lib/social/targets";

export interface EventFile {
  id: string;
  event_id: string;
  path: string | null;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  uploaded_by: string;
  publish_info: PublishInfo | null;
  uploaded_by_profile: { first_name: string | null; last_name: string | null; email: string | null } | null;
  storage_provider: "supabase" | "drive";
  drive_file_id: string | null;
  drive_web_view_link: string | null;
}

function slugifyFilename(name: string) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const safeBase = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${safeBase || "fichier"}${ext.toLowerCase()}`;
}

export async function listEventFiles(eventId: string): Promise<EventFile[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_files")
    .select("*, uploaded_by_profile:profiles(first_name, last_name, email)")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[eventFiles.listEventFiles]", error);
    return [];
  }
  return (data as unknown as EventFile[]) ?? [];
}

export type UploadResult = { ok: boolean; name: string; error?: string; id?: string };

async function uploadEventFilesToSupabase(eventId: string, files: File[]) {
  const supabase = createClient();
  const results: UploadResult[] = [];
  for (const file of files) {
    const objectPath = `${eventId}/${crypto.randomUUID()}_${slugifyFilename(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) {
      results.push({ ok: false, name: file.name, error: uploadError.message });
      continue;
    }
    const { data: inserted, error: insertError } = await supabase
      .from("event_files")
      .insert({
        event_id: eventId,
        path: objectPath,
        filename: file.name,
        content_type: file.type || null,
        size_bytes: file.size,
        storage_provider: "supabase",
      })
      .select("id")
      .single();
    if (insertError) {
      await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => {});
      results.push({ ok: false, name: file.name, error: insertError.message });
      continue;
    }
    results.push({ ok: true, name: file.name, id: inserted?.id });
  }
  return results;
}

const CHUNK_SIZE = 3 * 1024 * 1024; // 3 Mio — multiple de 256 Kio (requis par Drive) et sous la limite de requête de l'hébergeur

/**
 * L'API Drive n'autorise pas le PUT direct navigateur→Google (CORS bloqué) et
 * un fichier entier dépasserait la limite de taille de requête de l'hébergeur.
 * On envoie donc le fichier par morceaux à notre propre route, qui relaie
 * chaque morceau à la session resumable Drive côté serveur.
 */
async function putFileToDriveViaRelay(
  chunkEndpoint: string,
  uploadUrl: string,
  file: File
): Promise<{ id: string; webViewLink?: string }> {
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const res = await fetch(chunkEndpoint, {
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
      throw new Error(err?.error ?? `Échec de l'envoi vers Drive (${res.status}).`);
    }
    return res.json();
  }
  throw new Error("Échec de l'envoi vers Drive (fichier vide).");
}

async function uploadEventFilesToDrive(eventId: string, files: File[]) {
  const results: UploadResult[] = [];
  for (const file of files) {
    try {
      const initRes = await fetch(`/api/events/${eventId}/attachments/drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok || !initJson.ok) {
        if (initJson.reason === "no_drive") {
          const fallback = await uploadEventFilesToSupabase(eventId, [file]);
          results.push(...fallback);
          continue;
        }
        results.push({ ok: false, name: file.name, error: initJson.error ?? "Échec de l'upload vers Drive." });
        continue;
      }

      const driveFile = await putFileToDriveViaRelay(`/api/events/${eventId}/attachments/drive/chunk`, initJson.uploadUrl, file);

      const confirmRes = await fetch(`/api/events/${eventId}/attachments/drive/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: driveFile.id,
          webViewLink: driveFile.webViewLink,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      });
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok || !confirmJson.ok) {
        results.push({ ok: false, name: file.name, error: confirmJson.error ?? "Échec de l'enregistrement." });
        continue;
      }
      results.push({ ok: true, name: file.name, id: confirmJson.id });
    } catch (e) {
      results.push({ ok: false, name: file.name, error: e instanceof Error ? e.message : "Erreur réseau." });
    }
  }
  return results;
}

/**
 * Le média part dans le Drive du board (dossier "Médias", description
 * événement/date/auteur) quel que soit qui uploade — le serveur route vers le
 * compte Google désigné en réglages (board_settings), pas celui de l'uploadeur.
 * Repli automatique sur Supabase Storage tant qu'aucun Drive de board n'est connecté.
 */
export async function uploadEventFiles(eventId: string, files: File[]) {
  return uploadEventFilesToDrive(eventId, files);
}

/**
 * Médias d'une publication autonome (créée depuis le centre, sans événement) : Drive du board,
 * dossier « LGEF Drive / Publications / AAAA / MM - Mois ». Pas de repli Supabase Storage — ses
 * règles d'accès exigent un événement dans le chemin du fichier.
 */
export async function uploadStandaloneMedia(files: File[]): Promise<StandaloneMedia[]> {
  const media: StandaloneMedia[] = [];
  for (const file of files) {
    const initRes = await fetch("/api/publications/drive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, mimeType: file.type }),
    });
    const initJson = await initRes.json();
    if (!initRes.ok || !initJson.ok) {
      throw new Error(
        initJson.reason === "no_drive"
          ? "Aucun Drive de board configuré (Réglages) — impossible d'héberger les médias d'une publication sans événement."
          : initJson.error ?? `Échec de l'envoi de ${file.name}.`
      );
    }
    const driveFile = await putFileToDriveViaRelay("/api/publications/drive/chunk", initJson.uploadUrl, file);
    media.push({
      drive_file_id: driveFile.id,
      filename: file.name,
      content_type: file.type || null,
      web_view_link: driveFile.webViewLink ?? null,
    });
  }
  return media;
}

export async function deleteEventFile(file: { id: string; path: string | null }) {
  const supabase = createClient();
  await supabase.from("event_files").delete().eq("id", file.id);
  if (file.path) {
    await supabase.storage.from(BUCKET).remove([file.path]).catch(() => {});
  }
}

/** Lien d'accès au fichier — URL signée pour Supabase Storage, lien Drive natif sinon. */
export async function getEventFileViewUrl(file: EventFile, downloadAs?: string) {
  if (file.storage_provider === "drive") return file.drive_web_view_link;
  if (!file.path) return null;
  return createEventFileUrl(file.path, downloadAs);
}

/** URL signée temporaire — `downloadAs` force le téléchargement sous ce nom au lieu d'un affichage inline. */
export async function createEventFileUrl(path: string, downloadAs?: string) {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600, downloadAs ? { download: downloadAs } : undefined);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Lien de partage longue durée (7 jours) pour un fichier Supabase Storage — à copier/envoyer. */
export async function createEventFileShareUrl(path: string) {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 604800);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Publication depuis l'onglet Fichiers d'un événement — passe par la publication « un seul
 * fichier » de ce média (créée au besoin), comme le centre de publication : même source de vérité
 * pour les stats. Publie réellement sur les comptes publics de la ligue : ne jamais appeler sans
 * confirmation explicite de l'utilisateur.
 */
export async function publishToYoutube(
  file: EventFile,
  meta: { title: string; description?: string },
  by: { first_name: string | null; last_name: string | null } | null
) {
  const publicationId = await ensureFilePublication(file);
  await publishPublicationToYoutube({ id: publicationId, files: [file], media: [] }, meta, by);
}

export async function publishToFacebook(
  file: EventFile,
  selection: Partial<Record<FacebookRegion, { enabled: boolean; message: string }>>,
  by: { first_name: string | null; last_name: string | null } | null
) {
  const targets = (Object.entries(selection) as [FacebookRegion, { enabled: boolean; message: string } | undefined][])
    .filter(([, sel]) => sel?.enabled)
    .map(([key, sel]) => ({ key, caption: sel!.message }));
  if (targets.length === 0) return;

  const publicationId = await ensureFilePublication(file);
  const results = await publishSocial(publicationId, targets, by);
  const failures = describeFailures(results);
  if (failures && !results.some((r) => r.ok)) throw new Error(failures);
  if (failures) alert(`Publié partiellement :\n${failures}`);
}
