"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  listEventFiles,
  uploadEventFiles,
  deleteEventFile,
  publishToYoutube,
  publishToFacebook,
  type EventFile,
} from "@/lib/board/eventFiles";
import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";

function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} Mo`;
}

/** Pièces jointes d'un événement (photo/vidéo) + publication YouTube/Facebook. */
export function useEventFiles(eventId: string | undefined, canManage: boolean) {
  const { user } = useAuth();
  const { runTask } = useBackgroundTasks();
  const [files, setFiles] = useState<EventFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [me, setMe] = useState<{ first_name: string | null; last_name: string | null } | null>(null);

  const refetch = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setFiles(await listEventFiles(eventId));
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .single()
      .then(({ data }) => setMe(data ?? null));
  }, [user?.id]);

  /**
   * Envoi en tâche de fond (voir BackgroundTasksContext) : rend la main tout de suite, la
   * progression s'affiche en bas à droite et on peut quitter l'événement ou changer de module.
   */
  const addFiles = (fileList: FileList | File[]) => {
    if (!eventId || !canManage) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(true);
    void runTask(
      files.length > 1 ? `Envoi de ${files.length} fichiers` : `Envoi de ${files[0].name}`,
      async ({ setProgress }) => {
        try {
          const results = await uploadEventFiles(eventId, files, (sent, total, current) =>
            setProgress(total ? sent / total : undefined, `${current} — ${formatMb(sent)} / ${formatMb(total)}`)
          );
          const uploaded = results.filter((r) => r.ok && r.id);
          const updated = await listEventFiles(eventId);
          // La mise en file « À publier » des photos/vidéos est faite par un trigger sur event_files
          // (sql/2026-09-28_queue_event_media.sql), pour le board comme pour le calendrier.
          setFiles(updated);
          const failed = results.filter((r) => !r.ok);
          if (failed.length === files.length) throw new Error(`Échec de l'envoi : ${failed.map((f) => f.name).join(", ")}`);
          return { ok: uploaded.length, failed: failed.map((f) => f.name) };
        } finally {
          setUploading(false);
        }
      },
      {
        success: (r) =>
          r.failed.length
            ? `${r.ok} fichier(s) envoyé(s) — échec pour : ${r.failed.join(", ")}`
            : `${r.ok} fichier${r.ok > 1 ? "s" : ""} ajouté${r.ok > 1 ? "s" : ""} à l'événement.`,
      }
    );
  };

  const removeFile = async (file: EventFile) => {
    if (!canManage && file.uploaded_by !== user?.id) return;
    await deleteEventFile(file);
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
  };

  // Publications en tâche de fond : l'envoi d'une vidéo à YouTube/Facebook peut prendre plusieurs minutes.
  const doPublishYoutube = async (file: EventFile, data: { title: string; description?: string }) => {
    setPublishing(file.id);
    void runTask(`YouTube — ${data.title}`, async ({ setProgress }) => {
      setProgress(undefined, "Envoi de la vidéo à YouTube…");
      try {
        await publishToYoutube(file, data, me);
        await refetch();
      } finally {
        setPublishing(null);
      }
    }, { success: () => "Vidéo publiée sur YouTube." });
  };

  const doPublishFacebook = async (file: EventFile, selection: Parameters<typeof publishToFacebook>[1]) => {
    setPublishing(file.id);
    void runTask(`Facebook — ${file.filename}`, async ({ setProgress }) => {
      setProgress(undefined, "Publication sur les pages Facebook…");
      try {
        const partialFailures = await publishToFacebook(file, selection, me);
        await refetch();
        return partialFailures;
      } finally {
        setPublishing(null);
      }
    }, { success: (failures) => (failures ? `Publié partiellement :\n${failures}` : "Publié sur Facebook.") });
  };

  return {
    files,
    loading,
    uploading,
    publishing,
    addFiles,
    removeFile,
    publishYoutube: doPublishYoutube,
    publishFacebook: doPublishFacebook,
  };
}
