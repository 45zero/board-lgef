"use client";

import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";

const BUCKET = "event-files";

export interface PublishTarget {
  published: boolean;
  at?: string;
  by?: { first_name: string | null; last_name: string | null } | null;
}

export interface PublishInfo {
  youtube?: PublishTarget & { videoId?: string; title?: string };
  facebook?: {
    lorraine?: PublishTarget;
    champagne_ardenne?: PublishTarget;
    alsace?: PublishTarget;
  };
}

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

async function uploadEventFilesToSupabase(eventId: string, files: File[]) {
  const supabase = createClient();
  const results: { ok: boolean; name: string; error?: string }[] = [];
  for (const file of files) {
    const objectPath = `${eventId}/${crypto.randomUUID()}_${slugifyFilename(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) {
      results.push({ ok: false, name: file.name, error: uploadError.message });
      continue;
    }
    const { error: insertError } = await supabase.from("event_files").insert({
      event_id: eventId,
      path: objectPath,
      filename: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
      storage_provider: "supabase",
    });
    if (insertError) {
      await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => {});
      results.push({ ok: false, name: file.name, error: insertError.message });
      continue;
    }
    results.push({ ok: true, name: file.name });
  }
  return results;
}

async function uploadEventFilesToDrive(eventId: string, files: File[]) {
  const results: { ok: boolean; name: string; error?: string }[] = [];
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/events/${eventId}/attachments/drive`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.reason === "no_drive") {
          const fallback = await uploadEventFilesToSupabase(eventId, [file]);
          results.push(...fallback);
          continue;
        }
        results.push({ ok: false, name: file.name, error: json.error ?? "Échec de l'upload vers Drive." });
        continue;
      }
      results.push({ ok: true, name: file.name });
    } catch (e) {
      results.push({ ok: false, name: file.name, error: e instanceof Error ? e.message : "Erreur réseau." });
    }
  }
  return results;
}

/**
 * Si l'uploadeur a un compte Google connecté, le média part dans son Drive
 * (dossier "Médias", avec description événement/date/auteur) pour ne pas
 * charger le stockage Supabase — sinon repli sur le bucket event-files.
 */
export async function uploadEventFiles(eventId: string, files: File[]) {
  const accounts = await getMyConnectedAccounts();
  const hasGoogleDrive = accounts.some((a) => a.provider === "google");
  return hasGoogleDrive ? uploadEventFilesToDrive(eventId, files) : uploadEventFilesToSupabase(eventId, files);
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

/** Lecture-modification-écriture sûre : relit toujours publish_info avant de le patcher. */
export async function updatePublishInfo(fileId: string, updater: (current: PublishInfo) => PublishInfo) {
  const supabase = createClient();
  const { data: current } = await supabase.from("event_files").select("publish_info").eq("id", fileId).single();
  const next = updater((current?.publish_info as PublishInfo | null) ?? {});
  await supabase.from("event_files").update({ publish_info: next as unknown as Json }).eq("id", fileId);
  return next;
}

/**
 * Publication réelle — appelle les Edge Functions déjà en production sur ce même
 * projet Supabase (calendrier-lgef). Poste effectivement sur la chaîne YouTube /
 * les pages Facebook publiques de la fédération : ne jamais appeler sans
 * confirmation explicite de l'utilisateur.
 */
export async function publishToYoutube(
  file: EventFile,
  { title, description }: { title: string; description?: string },
  by: { first_name: string | null; last_name: string | null } | null
) {
  if (file.storage_provider !== "supabase" || !file.path) {
    throw new Error("Publication indisponible pour un fichier stocké sur Drive pour l'instant.");
  }
  const supabase = createClient();
  const videoUrl = await createEventFileUrl(file.path);
  if (!videoUrl) throw new Error("Impossible de générer l'URL de la vidéo.");

  const { data, error } = await supabase.functions.invoke("publish-youtube", {
    body: { videoUrl, title, description: description ?? "" },
  });
  if (error || !data?.success) {
    throw new Error(data?.error ?? error?.message ?? "Échec de la publication YouTube.");
  }

  return updatePublishInfo(file.id, (current) => ({
    ...current,
    youtube: {
      published: true,
      videoId: data.youtube?.videoId,
      title,
      at: data.youtube?.at ?? new Date().toISOString(),
      by,
    },
  }));
}

const FACEBOOK_PAGE_KEYS = {
  lorraine: "pageA",
  champagne_ardenne: "pageB",
  alsace: "pageC",
} as const;

export async function publishToFacebook(
  file: EventFile,
  selection: Partial<Record<keyof typeof FACEBOOK_PAGE_KEYS, { enabled: boolean; message: string }>>,
  by: { first_name: string | null; last_name: string | null } | null
) {
  if (file.storage_provider !== "supabase" || !file.path) {
    throw new Error("Publication indisponible pour un fichier stocké sur Drive pour l'instant.");
  }
  const supabase = createClient();
  const videoUrl = await createEventFileUrl(file.path);
  if (!videoUrl) throw new Error("Impossible de générer l'URL de la vidéo.");

  const pages: Record<string, boolean> = {};
  const messages: Record<string, string> = {};
  for (const [region, key] of Object.entries(FACEBOOK_PAGE_KEYS) as [keyof typeof FACEBOOK_PAGE_KEYS, string][]) {
    const sel = selection[region];
    if (sel?.enabled) {
      pages[key] = true;
      messages[key] = sel.message;
    }
  }

  const { data, error } = await supabase.functions.invoke("publish-facebook", {
    body: { videoUrl, pages, messages },
  });
  if (error || !data?.success) {
    throw new Error(data?.error ?? error?.message ?? "Échec de la publication Facebook.");
  }

  const publishedNames: string[] = data.publishedPages ?? [];
  const at = new Date().toISOString();
  return updatePublishInfo(file.id, (current) => {
    const next: PublishInfo = { ...current, facebook: { ...current.facebook } };
    if (publishedNames.includes("Lorraine")) next.facebook!.lorraine = { published: true, at, by };
    if (publishedNames.includes("Champagne-Ardenne")) next.facebook!.champagne_ardenne = { published: true, at, by };
    if (publishedNames.includes("Alsace")) next.facebook!.alsace = { published: true, at, by };
    return next;
  });
}
