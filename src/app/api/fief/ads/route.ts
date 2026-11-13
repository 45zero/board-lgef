import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { done, fail, getFiefActor } from "@/lib/fief/actor";
import { getFiefStorage } from "@/lib/fief/storage";

// Publicités « Sponsorisé » de FIEF (sql/2026-11-13_fief_ads.sql) — gérées par l'équipe FIEF depuis le board
// (onglet FIEF → Publicités). POST (formulaire) : créer / modifier, avec image facultative (Drive du board,
// FIEF / Publicités) ; DELETE ?id= : supprimer.

export const maxDuration = 60;

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const schema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Titre obligatoire.").max(120),
  body: optionalText(500),
  link_url: optionalText(500).refine((v) => !v || /^https?:\/\//i.test(v), "Le lien doit commencer par https://"),
  link_label: optionalText(40),
  advertiser: optionalText(80),
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
  starts_on: optionalText(10),
  ends_on: optionalText(10),
  position: z.coerce.number().int().min(0).max(999).default(0),
  remove_image: z.enum(["true", "false"]).default("false"),
});

export async function POST(request: Request) {
  const actor = await getFiefActor();
  if (!actor?.manager) return fail(403, "Réservé à l'équipe FIEF.");
  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Formulaire illisible.");
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = schema.safeParse(fields);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Formulaire incomplet.");
  const v = parsed.data;
  if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) return fail(400, "La date de fin précède la date de début.");

  const service = createServiceClient();
  const existing = v.id ? (await service.from("fief_ads").select("image_storage_id").eq("id", v.id).maybeSingle()).data : null;
  if (v.id && !existing) return fail(404, "Publicité introuvable.");

  const image = form.get("image");
  let imagePatch: { image_storage_id: string | null; image_mime: string | null } | null = null;
  const storage = await getFiefStorage();
  if (image instanceof File && image.size > 0) {
    const ext = IMAGE_TYPES[image.type];
    if (!ext) return fail(415, "Image JPEG, PNG, WebP ou GIF attendue.");
    if (image.size > 4 * 1024 * 1024) return fail(413, "Image trop lourde (4 Mo maximum).");
    if (!storage) return fail(503, "Le stockage FIEF n'est pas configuré (Drive du board).");
    const storageId = await storage.put(["Publicités"], { name: `${v.title.slice(0, 60)} ${randomUUID().slice(0, 6)}.${ext}`, mimeType: image.type, data: Buffer.from(await image.arrayBuffer()) });
    imagePatch = { image_storage_id: storageId, image_mime: image.type };
  } else if (v.remove_image === "true") {
    imagePatch = { image_storage_id: null, image_mime: null };
  }

  const row = {
    title: v.title,
    body: v.body,
    link_url: v.link_url,
    link_label: v.link_label,
    advertiser: v.advertiser,
    active: v.active,
    starts_on: v.starts_on,
    ends_on: v.ends_on,
    position: v.position,
    ...(imagePatch ?? {}),
  };
  const { error } = v.id ? await service.from("fief_ads").update(row).eq("id", v.id) : await service.from("fief_ads").insert({ ...row, created_by: actor.userId });
  if (error) {
    if (imagePatch?.image_storage_id && storage) await storage.remove(imagePatch.image_storage_id).catch(() => {});
    return fail(500, "Publicité non enregistrée.");
  }
  if (imagePatch && existing?.image_storage_id && storage) await storage.remove(existing.image_storage_id).catch(() => {});
  return done();
}

export async function DELETE(request: Request) {
  const actor = await getFiefActor();
  if (!actor?.manager) return fail(403, "Réservé à l'équipe FIEF.");
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Publicité inconnue.");
  const service = createServiceClient();
  const { data: ad } = await service.from("fief_ads").select("image_storage_id").eq("id", id).maybeSingle();
  const { error } = await service.from("fief_ads").delete().eq("id", id);
  if (error) return fail(500, "Suppression impossible.");
  const storage = await getFiefStorage();
  if (ad?.image_storage_id && storage) await storage.remove(ad.image_storage_id).catch(() => {});
  return done();
}
