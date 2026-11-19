"use server";

import { managerMap, managerOf } from "@/lib/board/hierarchy";
import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { DETAILS_COLUMNS, addressHiddenFor, detailsForViewer, saveProfile } from "@/lib/board/profileCore";
import type { ProfileDetails } from "@/lib/board/profile";

// Paramètres → Utilisateurs : rôle et spécialités de chaque compte (profiles.role +
// profile_specialties, partagés avec calendrier-lgef). Réservé aux administrateurs et super users ;
// seul un administrateur peut donner ou retirer les rôles administrateur / super user.

export type UserRole = "user" | "technician" | "organizer" | "comite_directeur" | "comite_directeur_bad" | "super_user" | "admin";

export interface AdminUser extends ProfileDetails {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  slugs: string[];
  createdAt: string | null;
  /** N+1 choisi pour cette personne (profiles.expense_validator_id) ; vide : responsable de son service. */
  managerId: string | null;
  /** Service de rattachement (org_services) : son responsable est le N+1 par défaut. */
  homeService: string | null;
  /** N+1 effectif (individuel, sinon responsable du service) — voir hierarchy.ts. */
  effectiveManagerId: string | null;
  avatarUrl: string | null;
}

export interface SpecialtyOption {
  slug: string;
  label: string;
  domain: "organizer" | "technician";
}

const ELEVATED: UserRole[] = ["admin", "super_user"];

async function requireManager() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
  const role = profile?.role as UserRole | undefined;
  if (role !== "admin" && role !== "super_user") throw new Error("Réservé aux administrateurs.");
  return { userId, isAdmin: role === "admin" };
}

export type UsersList = { users: AdminUser[]; specialties: SpecialtyOption[]; me: { id: string; isAdmin: boolean } };

async function listUsersImpl(): Promise<UsersList> {
  const { userId, isAdmin } = await requireManager();
  const service = createServiceClient();
  const [{ data: profiles, error }, { data: links }, { data: specialties }, managers] = await Promise.all([
    service.from("profiles").select(`id, first_name, last_name, email, role, created_at, expense_validator_id, home_service, avatar_url, ${DETAILS_COLUMNS}`).order("last_name"),
    service.from("profile_specialties").select("user_id, specialties(slug)"),
    service.from("specialties").select("slug, label, domain").order("label"),
    managerMap(service),
  ]);
  if (error) throw new Error(error.message);
  const slugsBy = new Map<string, string[]>();
  for (const l of (links ?? []) as unknown as { user_id: string; specialties: { slug: string } | null }[]) {
    if (!l.specialties) continue;
    slugsBy.set(l.user_id, [...(slugsBy.get(l.user_id) ?? []), l.specialties.slug]);
  }
  return {
    users: (profiles ?? []).map((p) => ({
      id: p.id,
      firstName: p.first_name ?? "",
      lastName: p.last_name ?? "",
      email: p.email ?? "",
      role: (p.role ?? "user") as UserRole,
      slugs: slugsBy.get(p.id) ?? [],
      createdAt: p.created_at,
      managerId: p.expense_validator_id,
      homeService: p.home_service,
      effectiveManagerId: managers.get(p.id) ?? null,
      avatarUrl: p.avatar_url,
      ...detailsForViewer({ ...p, manager_id: managers.get(p.id) ?? null }, userId),
    })),
    specialties: (specialties ?? []) as SpecialtyOption[],
    me: { id: userId, isAdmin },
  };
}

/** Enregistre nom, adresse, véhicule, rôle et spécialités (l'ensemble remplace les spécialités actuelles). */
type UserInput = { firstName: string; lastName: string; role: UserRole; slugs: string[]; details: ProfileDetails };

async function updateUserImpl(id: string, input: UserInput) {
  const { userId, isAdmin } = await requireManager();
  const service = createServiceClient();
  const { data: current } = await service.from("profiles").select("id, role, address_private").eq("id", id).single();
  if (!current) throw new Error("Compte introuvable.");
  const currentRole = current.role as UserRole;

  if (input.role !== currentRole) {
    if (id === userId) throw new Error("Vous ne pouvez pas modifier votre propre rôle.");
    if (!isAdmin && (ELEVATED.includes(input.role) || ELEVATED.includes(currentRole))) {
      throw new Error("Seul un administrateur peut donner ou retirer les rôles administrateur et super user.");
    }
  }

  await saveProfile(service, id, { firstName: input.firstName, lastName: input.lastName, ...input.details }, { keepAddress: addressHiddenFor({ ...current, manager_id: await managerOf(service, id) }, userId) });
  if (input.role !== currentRole) {
    const { error: roleError } = await service.from("profiles").update({ role: input.role }).eq("id", id);
    if (roleError) throw new Error(roleError.message);
  }

  const { data: catalog } = await service.from("specialties").select("id, slug");
  const wanted = new Set(input.slugs);
  const wantedIds = (catalog ?? []).filter((s) => wanted.has(s.slug)).map((s) => s.id);
  const { data: existing } = await service.from("profile_specialties").select("specialty_id").eq("user_id", id);
  const existingIds = new Set((existing ?? []).map((e) => e.specialty_id));
  const toRemove = [...existingIds].filter((sid) => !wantedIds.includes(sid));
  const toAdd = wantedIds.filter((sid) => !existingIds.has(sid));
  if (toRemove.length) {
    const { error } = await service.from("profile_specialties").delete().eq("user_id", id).in("specialty_id", toRemove);
    if (error) throw new Error(error.message);
  }
  if (toAdd.length) {
    const { error } = await service.from("profile_specialties").insert(toAdd.map((specialty_id) => ({ user_id: id, specialty_id })));
    if (error) throw new Error(error.message);
  }
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function listUsers() {
  return toResult(() => listUsersImpl());
}

export async function updateUser(id: string, input: UserInput) {
  return toResult(() => updateUserImpl(id, input));
}

/** N+1 d'un compte (null : aucun) — enregistré dès qu'il est choisi dans la fiche. */
export async function setUserManager(id: string, managerId: string | null) {
  return toResult(async () => {
    await requireManager();
    if (managerId === id) throw new Error("Une personne ne peut pas être son propre N+1.");
    const { error } = await createServiceClient().from("profiles").update({ expense_validator_id: managerId }).eq("id", id);
    if (error) throw new Error(error.message);
  });
}

/** Service de rattachement d'un compte (null : aucun) — son responsable devient le N+1 par défaut. */
export async function setUserService(id: string, serviceKey: string | null) {
  return toResult(async () => {
    await requireManager();
    const { error } = await createServiceClient().from("profiles").update({ home_service: serviceKey }).eq("id", id);
    if (error) throw new Error(error.message);
  });
}
