"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Paramètres → Utilisateurs : rôle et spécialités de chaque compte (profiles.role +
// profile_specialties, partagés avec calendrier-lgef). Réservé aux administrateurs et super users ;
// seul un administrateur peut donner ou retirer les rôles administrateur / super user.

export type UserRole = "user" | "technician" | "organizer" | "comite_directeur" | "comite_directeur_bad" | "super_user" | "admin";

export interface AdminUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  slugs: string[];
  createdAt: string | null;
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

export async function listUsers(): Promise<{ users: AdminUser[]; specialties: SpecialtyOption[]; me: { id: string; isAdmin: boolean } }> {
  const { userId, isAdmin } = await requireManager();
  const service = createServiceClient();
  const [{ data: profiles, error }, { data: links }, { data: specialties }] = await Promise.all([
    service.from("profiles").select("id, first_name, last_name, email, role, created_at").order("last_name"),
    service.from("profile_specialties").select("user_id, specialties(slug)"),
    service.from("specialties").select("slug, label, domain").order("label"),
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
    })),
    specialties: (specialties ?? []) as SpecialtyOption[],
    me: { id: userId, isAdmin },
  };
}

/** Enregistre nom, rôle et spécialités (l'ensemble remplace les spécialités actuelles). */
export async function updateUser(id: string, input: { firstName: string; lastName: string; role: UserRole; slugs: string[] }) {
  const { userId, isAdmin } = await requireManager();
  const service = createServiceClient();
  const { data: current } = await service.from("profiles").select("role").eq("id", id).single();
  if (!current) throw new Error("Compte introuvable.");
  const currentRole = current.role as UserRole;

  if (input.role !== currentRole) {
    if (id === userId) throw new Error("Vous ne pouvez pas modifier votre propre rôle.");
    if (!isAdmin && (ELEVATED.includes(input.role) || ELEVATED.includes(currentRole))) {
      throw new Error("Seul un administrateur peut donner ou retirer les rôles administrateur et super user.");
    }
  }

  const { error: profileError } = await service
    .from("profiles")
    .update({ first_name: input.firstName.trim() || null, last_name: input.lastName.trim() || null, role: input.role })
    .eq("id", id);
  if (profileError) throw new Error(profileError.message);

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
