"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { ALL_MODULE_IDS, type DirectoryPerson, type ModuleRule } from "@/lib/board/modules";
import type { SpecialtyLite } from "@/lib/board/poles";

// Accès aux modules (sql/2026-09-29_module_access.sql). Lecture de ses propres modules pour tout
// le monde ; règles, annuaire et modifications réservés aux administrateurs et super users.

type Row = {
  module_id: string;
  everyone: boolean;
  roles: string[];
  specialty_slugs: string[];
  include_user_ids: string[];
  exclude_user_ids: string[];
};

const toRule = (r: Row): ModuleRule => ({
  moduleId: r.module_id,
  everyone: r.everyone,
  roles: r.roles,
  specialtySlugs: r.specialty_slugs,
  includeUserIds: r.include_user_ids,
  excludeUserIds: r.exclude_user_ids,
});

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return { supabase, userId };
}

async function requireManager() {
  const { supabase, userId } = await currentUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (profile?.role !== "admin" && profile?.role !== "super_user") throw new Error("Réservé aux administrateurs et super users.");
  return { supabase, userId };
}

async function modulesVisibleTo(userId: string) {
  const { data, error } = await createServiceClient().rpc("modules_visible_to", { uid: userId, p_modules: ALL_MODULE_IDS });
  if (error) throw new Error(error.message);
  return (data as string[] | null) ?? [];
}

async function getMyVisibleModulesImpl(): Promise<string[]> {
  const { userId } = await currentUser();
  const modules = await modulesVisibleTo(userId);
  if (!modules.includes("effectif")) return modules;
  // Effectif : en plus de la règle d'accès, seulement pour les administrateurs et les N+1.
  const service = createServiceClient();
  const [{ data: me }, { count }] = await Promise.all([
    service.from("profiles").select("role").eq("id", userId).single(),
    service.from("profiles").select("id", { count: "exact", head: true }).eq("expense_validator_id", userId).neq("id", userId),
  ]);
  const allowed = me?.role === "admin" || me?.role === "super_user" || (count ?? 0) > 0;
  return allowed ? modules : modules.filter((m) => m !== "effectif");
}

export type ModuleAccessAdmin = {
  rules: Record<string, ModuleRule>;
  directory: DirectoryPerson[];
  specialties: SpecialtyLite[];
};

async function getModuleAccessAdminImpl(): Promise<ModuleAccessAdmin> {
  await requireManager();
  const service = createServiceClient();
  const [{ data: rows, error }, { data: profiles }, { data: links }, { data: specialties }] = await Promise.all([
    service.from("module_access").select("module_id, everyone, roles, specialty_slugs, include_user_ids, exclude_user_ids"),
    service.from("profiles").select("id, first_name, last_name, email, role").order("last_name"),
    service.from("profile_specialties").select("user_id, specialties(slug)"),
    service.from("specialties").select("slug, label, domain"),
  ]);
  if (error) throw new Error(error.message);
  const slugsBy = new Map<string, string[]>();
  for (const l of (links ?? []) as unknown as { user_id: string; specialties: { slug: string } | null }[]) {
    if (l.specialties) slugsBy.set(l.user_id, [...(slugsBy.get(l.user_id) ?? []), l.specialties.slug]);
  }
  return {
    rules: Object.fromEntries(((rows ?? []) as Row[]).map((r) => [r.module_id, toRule(r)])),
    directory: (profiles ?? []).map((p) => ({
      id: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "Utilisateur",
      email: p.email,
      role: p.role ?? "user",
      slugs: slugsBy.get(p.id) ?? [],
    })),
    specialties: (specialties ?? []) as SpecialtyLite[],
  };
}

async function saveModuleRuleImpl(rule: ModuleRule) {
  const { supabase, userId } = await requireManager();
  if (!ALL_MODULE_IDS.includes(rule.moduleId) || rule.moduleId === "accueil") throw new Error("Module inconnu.");
  const uniq = (xs: string[]) => [...new Set(xs)];
  const { error } = await supabase.from("module_access").upsert({
    module_id: rule.moduleId,
    everyone: rule.everyone,
    roles: uniq(rule.roles),
    specialty_slugs: uniq(rule.specialtySlugs),
    include_user_ids: uniq(rule.includeUserIds),
    exclude_user_ids: uniq(rule.excludeUserIds.filter((id) => !rule.includeUserIds.includes(id))),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** Modules visibles par un compte donné (fiche utilisateur). */
async function getUserModulesImpl(userId: string): Promise<string[]> {
  await requireManager();
  return modulesVisibleTo(userId);
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function getMyVisibleModules() {
  return toResult(() => getMyVisibleModulesImpl());
}

export async function getModuleAccessAdmin() {
  return toResult(() => getModuleAccessAdminImpl());
}

export async function saveModuleRule(rule: ModuleRule) {
  return toResult(() => saveModuleRuleImpl(rule));
}

export async function getUserModules(userId: string) {
  return toResult(() => getUserModulesImpl(userId));
}
