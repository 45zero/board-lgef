"use server";

import { randomUUID } from "crypto";
import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import type { Json } from "@/lib/supabase/database.types";

// Centre d'aide (sql/2026-10-04_support_tickets.sql). Chacun signale un problème (texte + photos,
// contexte technique) et suit ses signalements ; admins et super users voient tous les tickets et
// les classent. Nouveau ticket → super users prévenus ; ticket réglé → auteur prévenu.
// Photos dans le bucket privé « support », sous <auteur>/ : déposées et relues par URL signée.

const BUCKET = "support";
const MAX_FILES = 6;
const STATUSES = ["nouveau", "en_cours", "regle", "sans_suite"] as const;
export type SupportStatus = (typeof STATUSES)[number];

export type SupportTicket = {
  id: string;
  createdAt: string;
  author: { id: string; name: string; email: string | null };
  message: string;
  app: string | null;
  context: Json;
  attachments: { path: string; url: string }[];
  status: SupportStatus;
  resolution: string | null;
  resolvedAt: string | null;
};

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("role, first_name, last_name, email").eq("id", userId).maybeSingle();
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || profile?.email || "Quelqu'un";
  return { userId, service, name, isStaff: profile?.role === "admin" || profile?.role === "super_user" };
}

/** URLs de dépôt signées pour les photos d'un signalement (avant son envoi). */
export async function createSupportUploads(count: number) {
  return toResult(async () => {
    const { userId, service } = await session();
    if (count < 1 || count > MAX_FILES) throw new Error(`${MAX_FILES} photos au maximum.`);
    return Promise.all(
      Array.from({ length: count }, async () => {
        const path = `${userId}/${randomUUID()}.jpg`;
        const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error || !data) throw new Error("Dépôt des photos impossible.");
        return { path, token: data.token };
      })
    );
  });
}

export async function submitSupportTicket(input: { message: string; app: string | null; context: Json; attachments: string[] }) {
  return toResult(async () => {
    const { userId, service, name } = await session();
    const message = input.message.trim();
    if (message.length < 3) throw new Error("Décrivez le problème en quelques mots.");
    // Seulement des photos déposées par l'auteur (createSupportUploads).
    const attachments = input.attachments.filter((p) => p.startsWith(`${userId}/`)).slice(0, MAX_FILES);
    const { data, error } = await service
      .from("support_tickets")
      .insert({ created_by: userId, message: message.slice(0, 5000), app: input.app, context: input.context, attachments })
      .select("id")
      .single();
    if (error || !data) throw new Error("Le signalement n'a pas pu être enregistré.");

    const { data: staff } = await service.from("profiles").select("id").eq("role", "super_user");
    const recipients = (staff ?? []).filter((p) => p.id !== userId);
    if (recipients.length) {
      await service.from("notifications").insert(
        recipients.map((p) => ({
          user_id: p.id,
          type: "support_ticket" as const,
          title: "Nouveau signalement",
          message: `${name} : ${message.length > 140 ? `${message.slice(0, 140)}…` : message}`,
          actor_name: name,
          data: { support_ticket_id: data.id },
        }))
      );
    }
    return { id: data.id };
  });
}

/** mine : mes signalements ; all : tous (admins et super users). */
export async function listSupportTickets(scope: "mine" | "all") {
  return toResult(async (): Promise<SupportTicket[]> => {
    const { userId, service, isStaff } = await session();
    if (scope === "all" && !isStaff) throw new Error("Réservé aux administrateurs.");
    let query = service.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(100);
    if (scope === "mine") query = query.eq("created_by", userId);
    const { data: rows, error } = await query;
    if (error) throw new Error("Lecture des signalements impossible.");
    if (!rows?.length) return [];

    const authorIds = [...new Set(rows.map((r) => r.created_by))];
    const paths = rows.flatMap((r) => r.attachments);
    const [{ data: authors }, { data: signed }] = await Promise.all([
      service.from("profiles").select("id, first_name, last_name, email").in("id", authorIds),
      paths.length ? service.storage.from(BUCKET).createSignedUrls(paths, 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    ]);
    const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    const authorOf = new Map((authors ?? []).map((a) => [a.id, a]));

    return rows.map((r) => {
      const a = authorOf.get(r.created_by);
      return {
        id: r.id,
        createdAt: r.created_at,
        author: { id: r.created_by, name: [a?.first_name, a?.last_name].filter(Boolean).join(" ").trim() || a?.email || "—", email: a?.email ?? null },
        message: r.message,
        app: r.app,
        context: r.context,
        attachments: r.attachments.map((path) => ({ path, url: urlOf.get(path) ?? "" })).filter((f) => f.url),
        status: r.status as SupportStatus,
        resolution: r.resolution,
        resolvedAt: r.resolved_at,
      };
    });
  });
}

/** Admins et super users : statut et réponse à l'auteur. Passage à « Réglé » → auteur prévenu. */
export async function updateSupportTicket(id: string, patch: { status: SupportStatus; resolution: string | null }) {
  return toResult(async () => {
    const { service, isStaff, name } = await session();
    if (!isStaff) throw new Error("Réservé aux administrateurs.");
    if (!STATUSES.includes(patch.status)) throw new Error("Statut inconnu.");
    const { data: before } = await service.from("support_tickets").select("status, created_by, message").eq("id", id).maybeSingle();
    if (!before) throw new Error("Signalement introuvable.");
    const closed = patch.status === "regle" || patch.status === "sans_suite";
    const resolution = patch.resolution?.trim() || null;
    const { error } = await service
      .from("support_tickets")
      .update({ status: patch.status, resolution, resolved_at: closed ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error("Mise à jour impossible.");

    if (patch.status === "regle" && before.status !== "regle") {
      const subject = before.message.length > 80 ? `${before.message.slice(0, 80)}…` : before.message;
      await service.from("notifications").insert({
        user_id: before.created_by,
        type: "support_resolved" as const,
        title: "Problème réglé",
        message: resolution ? `« ${subject} » — ${resolution}` : `« ${subject} » est réglé. Merci pour le signalement !`,
        actor_name: name,
        data: { support_ticket_id: id },
      });
    }
  });
}
