import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { done, fail, getFiefActor, type FiefActor } from "@/lib/fief/actor";
import { documentFolder, getFiefStorage } from "@/lib/fief/storage";

// Documents FIEF (sql/2026-11-13_fief_documents.sql) — écritures : préparer un envoi (session Drive,
// les morceaux passent ensuite par /api/fief/documents/chunk), modifier (partage, dossier, nom),
// supprimer ; dossiers (équipe FIEF). Lectures : fief_documents_list / fief_doc_folders_list.
// Partage : réservé à l'équipe FIEF, à toutes les membres ou à un public choisi (personnes, fonctions,
// clubs — sql/2026-11-16_fief_evolutions.sql). Une membre garde ses documents pour elle.

export const maxDuration = 30;

const MAX_BYTES = 50 * 1024 * 1024;
const uuid = z.string().uuid();
const audienceSchema = z.object({
  audience: z.enum(["all", "custom"]),
  ids: z.array(uuid).max(500).default([]),
  functions: z.array(z.string().max(40)).max(50).default([]),
  clubs: z.array(z.string().max(20)).max(200).default([]),
});
type AudienceInput = z.infer<typeof audienceSchema>;
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    name: z.string().trim().min(1).max(200),
    mimeType: z.string().max(200).default("application/octet-stream"),
    size: z.number().int().min(1).max(MAX_BYTES, "Fichier trop lourd (50 Mo maximum)."),
    folderId: uuid.nullable().default(null),
    shared: z.boolean(),
    description: z.string().trim().max(500).default(""),
    asTeam: z.boolean().default(false),
    audience: audienceSchema.optional(),
  }),
  z.object({
    action: z.literal("update"),
    id: uuid,
    shared: z.boolean().optional(),
    folderId: uuid.nullable().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(500).optional(),
    audience: audienceSchema.optional(),
  }),
  z.object({ action: z.literal("delete"), id: uuid }),
  z.object({ action: z.literal("createFolder"), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("renameFolder"), id: uuid, name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("deleteFolder"), id: uuid }),
]);

const ownerName = (a: FiefActor) => (a.member ? `${a.member.lastName} ${a.member.firstName}` : "Équipe FIEF");

/** Colonnes du public d'un document ; null si un public « custom » est vide. */
function audienceColumns(a: AudienceInput | undefined) {
  if (!a || a.audience === "all") return { audience: "all" as const, audience_ids: [], audience_functions: [], audience_clubs: [] };
  const cols = { audience: "custom" as const, audience_ids: [...new Set(a.ids)], audience_functions: [...new Set(a.functions)], audience_clubs: [...new Set(a.clubs)] };
  return cols.audience_ids.length + cols.audience_functions.length + cols.audience_clubs.length ? cols : null;
}

async function folderName(id: string | null) {
  if (!id) return null;
  const { data } = await createServiceClient().from("fief_doc_folders").select("name").eq("id", id).maybeSingle();
  return data?.name ?? null;
}

export async function POST(request: Request) {
  const actor = await getFiefActor();
  if (!actor || (!actor.member && !actor.manager)) return fail(403, "Réservé aux membres FIEF.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Requête invalide.");
  const input = parsed.data;
  const service = createServiceClient();

  if (input.action === "createFolder" || input.action === "renameFolder" || input.action === "deleteFolder") {
    if (!actor.manager) return fail(403, "Réservé à l'équipe FIEF.");
    if (input.action === "deleteFolder") {
      // Les documents du dossier restent (classés « Divers »).
      const { error } = await service.from("fief_doc_folders").delete().eq("id", input.id);
      return error ? fail(500, "Suppression impossible.") : done();
    }
    const duplicate = (code?: string) => (code === "23505" ? fail(409, "Ce dossier existe déjà.") : fail(500, "Enregistrement impossible."));
    if (input.action === "renameFolder") {
      const { error } = await service.from("fief_doc_folders").update({ name: input.name }).eq("id", input.id);
      return error ? duplicate(error.code) : done();
    }
    const { data: last } = await service.from("fief_doc_folders").select("position").order("position", { ascending: false }).limit(1);
    const { error } = await service.from("fief_doc_folders").insert({ name: input.name, position: (last?.[0]?.position ?? 0) + 10 });
    return error ? duplicate(error.code) : done();
  }

  const storage = await getFiefStorage();
  if (!storage) return fail(503, "Le stockage FIEF n'est pas configuré (Drive du board).");

  if (input.action === "start") {
    if (input.asTeam && !actor.manager) return fail(403, "Réservé à l'équipe FIEF.");
    const asTeam = actor.manager && (input.asTeam || !actor.member);
    const shared = asTeam || input.shared;
    if (shared && !actor.manager) return fail(403, "Seule l'équipe FIEF partage des documents : le vôtre reste dans « Mes documents ».");
    const audience = audienceColumns(input.audience);
    if (!audience) return fail(400, "Choisissez au moins une personne, une fonction ou un club.");
    const fName = await folderName(input.folderId);
    if (input.folderId && !fName) return fail(400, "Dossier introuvable.");
    // Garde-fou : 10 envois en cours maximum par personne.
    const { count } = await service.from("fief_documents").select("id", { count: "exact", head: true }).eq("owner_id", actor.userId).eq("status", "uploading");
    if ((count ?? 0) >= 10) return fail(429, "Trop d'envois en cours : attendez qu'ils se terminent.");
    try {
      const uploadUrl = await storage.createUpload(documentFolder({ shared, folderName: fName, ownerName: ownerName(actor) }), { name: input.name, mimeType: input.mimeType });
      const { data, error } = await service
        .from("fief_documents")
        .insert({
          owner_id: actor.userId,
          as_team: asTeam,
          folder_id: input.folderId,
          name: input.name,
          description: input.description || null,
          mime_type: input.mimeType || "application/octet-stream",
          size_bytes: input.size,
          visibility: shared ? "shared" : "private",
          ...audience,
          upload_url: uploadUrl,
        })
        .select("id")
        .single();
      if (error) return fail(500, "Envoi impossible.");
      return done({ id: data.id });
    } catch (e) {
      console.error("[fief.documents.start]", e);
      return fail(502, "Le Drive ne répond pas : réessayez.");
    }
  }

  if (input.action === "update") {
    const { data: doc } = await service.from("fief_documents").select("*").eq("id", input.id).eq("status", "ready").maybeSingle();
    if (!doc || (doc.owner_id !== actor.userId && !actor.manager)) return fail(403, "Vous ne pouvez modifier que vos documents.");
    if (doc.as_team && input.shared === false) return fail(400, "Un document de l'équipe reste partagé.");
    const shared = input.shared ?? doc.visibility === "shared";
    if (shared && doc.visibility !== "shared" && !actor.manager) return fail(403, "Seule l'équipe FIEF partage des documents.");
    if (input.audience && !actor.manager) return fail(403, "Réservé à l'équipe FIEF.");
    const audience = input.audience ? audienceColumns(input.audience) : null;
    if (input.audience && !audience) return fail(400, "Choisissez au moins une personne, une fonction ou un club.");
    const folderId = input.folderId === undefined ? doc.folder_id : input.folderId;
    const fName = await folderName(folderId);
    if (folderId && !fName) return fail(400, "Dossier introuvable.");
    const moved = shared !== (doc.visibility === "shared") || (shared && folderId !== doc.folder_id);
    if (moved && doc.storage_id) {
      const { data: owner } = await service.from("fief_members").select("first_name, last_name").eq("user_id", doc.owner_id).maybeSingle();
      await storage
        .move(doc.storage_id, documentFolder({ shared, folderName: fName, ownerName: owner ? `${owner.last_name} ${owner.first_name}` : "Équipe FIEF" }))
        .catch((e) => console.warn("[fief.documents.move]", e));
    }
    const { error } = await service
      .from("fief_documents")
      .update({
        visibility: shared ? "shared" : "private",
        ...(audience ?? {}),
        folder_id: folderId,
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
      })
      .eq("id", doc.id);
    return error ? fail(500, "Modification impossible.") : done();
  }

  // delete
  const { data: doc } = await service.from("fief_documents").select("id, owner_id, storage_id").eq("id", input.id).maybeSingle();
  if (!doc || (doc.owner_id !== actor.userId && !actor.manager)) return fail(403, "Vous ne pouvez supprimer que vos documents.");
  const { error } = await service.from("fief_documents").delete().eq("id", doc.id);
  if (error) return fail(500, "Suppression impossible.");
  if (doc.storage_id) await storage.remove(doc.storage_id).catch(() => {});
  return done();
}
