"use server";

import { managerOf } from "@/lib/board/hierarchy";
import { mileageBlock } from "@/lib/board/mileage";
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
      service.from("profiles").select(`id, email, first_name, last_name, avatar_url, role, expense_validator_id, ${DETAILS_COLUMNS}`).eq("id", userId).single(),
      service.from("profile_specialties").select("specialties(slug)").eq("user_id", userId),
    ]);
    if (error || !p) throw new Error("Profil introuvable.");
    const [managerId, block] = await Promise.all([managerOf(service, userId), mileageBlock(service, userId)]);
    const { data: manager } = managerId
      ? await service.from("profiles").select("first_name, last_name, email").eq("id", managerId).maybeSingle()
      : { data: null };
    const slugs = ((links ?? []) as unknown as { specialties: { slug: string } | null }[]).map((l) => l.specialties?.slug);
    const status = slugs.map((s) => (s ? STATUS_LABELS[s] : undefined)).find(Boolean) ?? null;
    // Salarié : organisateur (service) ou coordination médias (statut Salarié).
    const salarie = p.role === "organizer" || slugs.includes("tech-salarie");
    return {
      id: p.id,
      email: p.email ?? "",
      firstName: p.first_name ?? "",
      lastName: p.last_name ?? "",
      avatarUrl: p.avatar_url,
      status,
      managerName: manager ? [manager.first_name, manager.last_name].filter(Boolean).join(" ") || manager.email : null,
      needsManager: salarie && !managerId,
      needsAddress: !block && !p.home_address && !p.home_coordinates,
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

/** Choix proposés pour son N+1 : services (avec leur responsable) et personnes du board. */
export async function getManagerChoices() {
  return toResult(async () => {
    const userId = await requireUser();
    const service = createServiceClient();
    const [{ data: services }, { data: people }] = await Promise.all([
      service.from("org_services").select("key, label, manager_id").order("sort"),
      service.from("profiles").select("id, first_name, last_name, email, role").neq("id", userId).order("last_name"),
    ]);
    const name = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
      [p.first_name?.trim(), p.last_name?.trim()].filter(Boolean).join(" ") || p.email || "—";
    const byId = new Map((people ?? []).map((p) => [p.id, p]));
    return {
      services: (services ?? []).map((s) => ({
        key: s.key,
        label: s.label,
        managerId: s.manager_id && s.manager_id !== userId ? s.manager_id : null,
        managerName: s.manager_id && byId.has(s.manager_id) ? name(byId.get(s.manager_id)!) : null,
      })),
      // Prestataires et bénévoles ne valident pas de frais : on propose les comptes internes.
      people: (people ?? []).filter((p) => p.role !== "user").map((p) => ({ id: p.id, name: name(p) })),
    };
  });
}

/**
 * Mon N+1, choisi par moi-même tant qu'aucun n'est réglé (fenêtre au lancement, Mon profil) : mon
 * service de rattachement et/ou une personne. Ensuite, seul un administrateur le change. Les
 * administrateurs et le N+1 choisi sont prévenus.
 */
export async function setMyManager(input: { serviceKey: string | null; managerId: string | null }) {
  return toResult(async () => {
    const userId = await requireUser();
    const service = createServiceClient();
    if (await managerOf(service, userId)) throw new Error("Votre N+1 est déjà réglé : seul un administrateur peut le changer.");
    const { data: svc } = input.serviceKey
      ? await service.from("org_services").select("key, label, manager_id").eq("key", input.serviceKey).maybeSingle()
      : { data: null };
    if (input.serviceKey && !svc) throw new Error("Service inconnu.");
    if (input.managerId === userId) throw new Error("Vous ne pouvez pas être votre propre N+1.");
    const { data: chosen } = input.managerId
      ? await service.from("profiles").select("id, first_name, last_name, email").eq("id", input.managerId).maybeSingle()
      : { data: null };
    if (input.managerId && !chosen) throw new Error("Personne introuvable.");
    // N+1 retenu : la personne choisie, sinon le responsable du service.
    const managerId = chosen?.id ?? (svc?.manager_id && svc.manager_id !== userId ? svc.manager_id : null);
    if (!managerId) throw new Error("Choisissez votre N+1 (ce service n'a pas encore de responsable).");

    const update: { home_service?: string; expense_validator_id?: string } = {};
    if (svc) update.home_service = svc.key;
    // Personne choisie différente du responsable du service : N+1 individuel.
    if (chosen && chosen.id !== svc?.manager_id) update.expense_validator_id = chosen.id;
    const { error } = await service.from("profiles").update(update).eq("id", userId);
    if (error) throw new Error(error.message);

    const [{ data: me }, { data: manager }, { data: admins }] = await Promise.all([
      service.from("profiles").select("first_name, last_name, email").eq("id", userId).maybeSingle(),
      service.from("profiles").select("first_name, last_name, email").eq("id", managerId).maybeSingle(),
      service.from("profiles").select("id").in("role", ["admin", "super_user"]),
    ]);
    const name = (p: { first_name: string | null; last_name: string | null; email: string | null } | null) =>
      p ? [p.first_name?.trim(), p.last_name?.trim()].filter(Boolean).join(" ") || p.email || "Quelqu'un" : "Quelqu'un";
    const who = name(me);
    const notify = (to: string, title: string, message: string) =>
      service.rpc("create_notification", { p_user_id: to, p_type: "delegation", p_title: title, p_message: message, p_data: { profile_id: userId }, p_actor_name: who });
    await Promise.all([
      managerId !== userId
        ? notify(managerId, `${who} vous a indiqué comme N+1`, "Vous validerez ses frais, factures et pointages. Un administrateur peut corriger ce choix (Paramètres → Utilisateurs).")
        : null,
      ...(admins ?? [])
        .filter((a) => a.id !== userId && a.id !== managerId)
        .map((a) =>
          notify(a.id, `${who} a choisi son N+1 : ${name(manager)}`, `${svc ? `Service : ${svc.label}. ` : ""}À corriger si besoin dans Paramètres → Utilisateurs.`)
        ),
    ]);
  });
}
