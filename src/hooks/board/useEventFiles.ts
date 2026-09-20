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

/** Pièces jointes d'un événement (photo/vidéo) + publication YouTube/Facebook. */
export function useEventFiles(eventId: string | undefined, canManage: boolean) {
  const { user } = useAuth();
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

  const addFiles = async (fileList: FileList | File[]) => {
    if (!eventId || !canManage) return { ok: 0, failed: [] as string[] };
    setUploading(true);
    try {
      const results = await uploadEventFiles(eventId, Array.from(fileList));
      await refetch();
      return {
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).map((r) => r.name),
      };
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (file: EventFile) => {
    if (!canManage && file.uploaded_by !== user?.id) return;
    await deleteEventFile(file);
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
  };

  const doPublishYoutube = async (file: EventFile, data: { title: string; description?: string }) => {
    setPublishing(file.id);
    try {
      await publishToYoutube(file, data, me);
      await refetch();
    } finally {
      setPublishing(null);
    }
  };

  const doPublishFacebook = async (file: EventFile, selection: Parameters<typeof publishToFacebook>[1]) => {
    setPublishing(file.id);
    try {
      await publishToFacebook(file, selection, me);
      await refetch();
    } finally {
      setPublishing(null);
    }
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
