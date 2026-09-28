"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import type { Json } from "@/lib/supabase/database.types";
import type { HabillageSettings } from "@/lib/board/habillage";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_user") {
    throw new Error("Réservé aux administrateurs.");
  }
  return { supabase, userId: user.id };
}

/** Personnes prévenues des commentaires haineux en plus des admins et de l'auteur de la publication. */
export async function getModerationRecipients(): Promise<{ ids: string[]; members: { id: string; name: string; email: string | null }[] }> {
  const supabase = await createClient();
  const [{ data: settings }, { data: members }] = await Promise.all([
    supabase.from("board_settings").select("moderation_recipient_ids").eq("id", true).single(),
    supabase.from("profiles").select("id, first_name, last_name, email").order("last_name"),
  ]);
  return {
    ids: settings?.moderation_recipient_ids ?? [],
    members: (members ?? []).map((m) => ({
      id: m.id,
      name: [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email || "—",
      email: m.email,
    })),
  };
}

export async function setModerationRecipients(ids: string[]) {
  const { supabase, userId } = await requireAdmin();
  const { error } = await supabase
    .from("board_settings")
    .update({ moderation_recipient_ids: ids, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

/** Compte Google connecté désigné comme "Drive du board" — reçoit tous les médias d'événements, quel que soit l'uploadeur. */
export async function getBoardDriveAccountId() {
  const supabase = await createClient();
  const { data } = await supabase.from("board_settings").select("drive_connected_account_id").eq("id", true).single();
  return data?.drive_connected_account_id ?? null;
}

export async function setBoardDriveAccount(accountId: string | null) {
  const { supabase, userId } = await requireAdmin();
  const { error } = await supabase
    .from("board_settings")
    .update({ drive_connected_account_id: accountId, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

/* ---------- Habillages des publications ---------- */

/** Réglages des habillages (tout utilisateur connecté : utilisés au moment de publier). */
export async function getHabillageSettings(): Promise<Partial<HabillageSettings>> {
  const supabase = await createClient();
  const { data } = await supabase.from("board_settings").select("habillage").eq("id", true).single();
  return (data?.habillage as Partial<HabillageSettings> | null) ?? {};
}

export async function saveHabillageSettings(settings: HabillageSettings) {
  const { supabase, userId } = await requireAdmin();
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(n) || min)));
  const isAnim = (a: { url?: unknown; preview?: unknown } | undefined) =>
    !!a && typeof a.url === "string" && a.url.includes("/board-assets/habillages/anim/") && typeof a.preview === "string" && a.preview.includes("/board-assets/habillages/anim/");
  const clean: HabillageSettings = {
    logoHeight: clamp(settings.logoHeight, 40, 320),
    textMax: clamp(settings.textMax, 28, 120),
    signature: String(settings.signature ?? "").slice(0, 80),
    builtins: { bandeau: !!settings.builtins?.bandeau, cadre: !!settings.builtins?.cadre, titre: !!settings.builtins?.titre },
    // Pas de pré-roll général : chaque environnement a le sien.
    preroll: null,
    custom: (settings.custom ?? []).slice(0, 20).map((c) => ({
      id: String(c.id).slice(0, 40),
      name: String(c.name ?? "Habillage").slice(0, 40),
      overlays: Object.fromEntries(
        Object.entries(c.overlays ?? {}).filter(([k, v]) => (k === "portrait" || k === "carre") && typeof v === "string" && v.includes("/board-assets/"))
      ),
      textPosition: c.textPosition === "top" || c.textPosition === "none" ? c.textPosition : "bottom",
      textColor: /^#[0-9a-fA-F]{6}$/.test(c.textColor) ? c.textColor : "#FFFFFF",
      animationMode: c.animationMode === "loop" ? "loop" : "once",
      context: String(c.context ?? "").trim().slice(0, 40) || undefined,
      preroll: c.preroll
        ? {
            animations: Object.fromEntries(Object.entries(c.preroll.animations ?? {}).filter(([k, a]) => (k === "vertical" || k === "horizontal") && isAnim(a))),
            revealAt: Math.min(30, Math.max(0, Number(c.preroll.revealAt) || 0)),
          }
        : null,
      keywords: String(c.keywords ?? "").slice(0, 200) || undefined,
      animations: Object.fromEntries(
        Object.entries(c.animations ?? {}).filter(
          ([k, a]) =>
            (k === "vertical" || k === "horizontal") &&
            !!a &&
            typeof a.url === "string" &&
            a.url.includes("/board-assets/habillages/anim/") &&
            typeof a.preview === "string" &&
            a.preview.includes("/board-assets/habillages/anim/")
        )
      ),
    })),
  };
  const { error } = await supabase
    .from("board_settings")
    .update({ habillage: clean as unknown as Json, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

/** URL signée pour déposer un calque PNG d'habillage (administrateurs). */
export async function createHabillageOverlayUpload(fileName: string): Promise<{ path: string; token: string; publicUrl: string }> {
  await requireAdmin();
  if (!/\.png$/i.test(fileName)) throw new Error("Le calque doit être une image PNG (fond transparent).");
  const service = createServiceClient();
  const path = `habillages/${randomUUID()}.png`;
  const { data, error } = await service.storage.from("board-assets").createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Dépôt impossible.");
  return { path, token: data.token, publicUrl: service.storage.from("board-assets").getPublicUrl(path).data.publicUrl };
}

/* ---------- Centre de publication : personnes habilitées ---------- */

/** Personnes habilitées à publier (en plus des administrateurs) et annuaire pour les choisir. */
export async function getPublisherSettings(): Promise<{ ids: string[]; members: { id: string; name: string; email: string | null; role: string | null }[] }> {
  const { supabase } = await requireAdmin();
  const [{ data: settings }, { data: members }] = await Promise.all([
    supabase.from("board_settings").select("publisher_ids").eq("id", true).single(),
    supabase.from("profiles").select("id, first_name, last_name, email, role").order("last_name"),
  ]);
  return {
    ids: settings?.publisher_ids ?? [],
    members: (members ?? []).map((m) => ({
      id: m.id,
      name: [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email || "—",
      email: m.email,
      role: m.role,
    })),
  };
}

export async function setPublishers(ids: string[]) {
  const { supabase, userId } = await requireAdmin();
  const { error } = await supabase
    .from("board_settings")
    .update({ publisher_ids: [...new Set(ids)], updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

/** URL signée pour déposer une animation .mov (couche alpha) à convertir (administrateurs). */
export async function createHabillageAnimationUpload(fileName: string): Promise<{ path: string; token: string }> {
  await requireAdmin();
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  if (!["mov", "webm"].includes(ext)) throw new Error("L'animation doit être un fichier .mov avec couche alpha.");
  const service = createServiceClient();
  const path = `habillages/src/${randomUUID()}.${ext}`;
  const { data, error } = await service.storage.from("board-assets").createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Dépôt impossible.");
  return { path, token: data.token };
}
