"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { DETAILS_COLUMNS, detailsFromRow, saveProfile } from "@/lib/board/profileCore";
import type { MyProfile, ProfileInput } from "@/lib/board/profile";

// Mon profil : chacun modifie son nom, sa photo, son adresse et son véhicule (repris de l'ancien
// calendrier, où ces réglages étaient éclatés entre « Profil » et « Préférences »). Le rôle, le statut
// et le N+1 sont seulement affichés : ils se règlent dans Paramètres → Utilisateurs.

const STATUS_LABELS: Record<string, string> = {
  "tech-salarie": "Salarié",
  "tech-reseau": "Réseau",
  "tech-prestataire": "Prestataire",
  "tech-benevole": "Bénévole",
};
const AVATAR_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return userId;
}

export async function getMyProfile() {
  return toResult(async (): Promise<MyProfile> => {
    const userId = await requireUser();
    const service = createServiceClient();
    const [{ data: p, error }, { data: links }] = await Promise.all([
      service.from("profiles").select(`id, email, first_name, last_name, avatar_url, expense_validator_id, ${DETAILS_COLUMNS}`).eq("id", userId).single(),
      service.from("profile_specialties").select("specialties(slug)").eq("user_id", userId),
    ]);
    if (error || !p) throw new Error("Profil introuvable.");
    const { data: manager } = p.expense_validator_id
      ? await service.from("profiles").select("first_name, last_name, email").eq("id", p.expense_validator_id).maybeSingle()
      : { data: null };
    const slugs = ((links ?? []) as unknown as { specialties: { slug: string } | null }[]).map((l) => l.specialties?.slug);
    const status = slugs.map((s) => (s ? STATUS_LABELS[s] : undefined)).find(Boolean) ?? null;
    return {
      id: p.id,
      email: p.email ?? "",
      firstName: p.first_name ?? "",
      lastName: p.last_name ?? "",
      avatarUrl: p.avatar_url,
      status,
      managerName: manager ? [manager.first_name, manager.last_name].filter(Boolean).join(" ") || manager.email : null,
      ...detailsFromRow(p),
    };
  });
}

export async function updateMyProfile(input: ProfileInput) {
  return toResult(async () => {
    const userId = await requireUser();
    await saveProfile(createServiceClient(), userId, input);
  });
}

/** URL signée pour déposer sa photo ; un nom unique par dépôt évite l'ancienne photo restée en cache. */
export async function createAvatarUpload(contentType: string) {
  return toResult(async () => {
    const userId = await requireUser();
    const ext = AVATAR_TYPES[contentType];
    if (!ext) throw new Error("La photo doit être une image JPEG, PNG ou WebP.");
    const path = `avatars/${userId}-${Date.now()}.${ext}`;
    const { data, error } = await createServiceClient().storage.from("avatars").createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "Dépôt impossible.");
    return { path, token: data.token };
  });
}

/** Enregistre la photo déposée (chemin rendu par createAvatarUpload) et renvoie son URL publique. */
export async function setMyAvatar(path: string | null) {
  return toResult(async () => {
    const userId = await requireUser();
    const service = createServiceClient();
    if (path !== null && !new RegExp(`^avatars/${userId}-\\d+\\.(jpg|png|webp)$`).test(path)) throw new Error("Photo invalide.");
    const avatarUrl = path ? service.storage.from("avatars").getPublicUrl(path).data.publicUrl : null;
    const { error } = await service.from("profiles").update({ avatar_url: avatarUrl }).eq("id", userId);
    if (error) throw new Error(error.message);
    return avatarUrl;
  });
}
