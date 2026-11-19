import type { createServiceClient } from "@/lib/supabase/serviceClient";

// Hiérarchie N+1 / N+2 et délégations (sql/2026-11-19_hierarchie_n1.sql, 2026-11-19_hierarchie_equipe.sql).
// Toute la règle vit en base ; ce module n'est qu'un accès typé, à utiliser partout au lieu de lire
// profiles.expense_validator_id (qui n'est plus que le N+1 choisi individuellement).
//
// N+1 d'une personne = son N+1 individuel, sinon le responsable de son service (org_services).
// N+2… = N+1 du N+1. Peut valider une action pour une personne : toute sa chaîne au-dessus d'elle, les
// délégataires actifs de cette chaîne pour l'action, les administrateurs. Jamais soi-même.

type Service = ReturnType<typeof createServiceClient>;

export type ApprovalAction = "comptes" | "frais" | "pointages" | "factures";

export const APPROVAL_ACTION_LABELS: Record<ApprovalAction, string> = {
  comptes: "Demandes de compte",
  frais: "Notes de frais",
  pointages: "Pointages",
  factures: "Factures",
};

/** setof uuid → string[] (PostgREST renvoie des chaînes ou des objets d'une colonne selon la fonction). */
const ids = (data: unknown): string[] =>
  Array.isArray(data)
    ? data.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? Object.values(x)[0] : null)).filter((x): x is string => typeof x === "string")
    : [];

async function rpc(service: Service, fn: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(fn as never, args as never);
  if (error) throw new Error(`[${fn}] ${error.message}`);
  return data as unknown;
}

/** N+1 calculé d'une personne. */
export async function managerOf(service: Service, userId: string): Promise<string | null> {
  const data = await rpc(service, "manager_of", { p_user: userId });
  return typeof data === "string" ? data : null;
}

/** Chaîne au-dessus d'une personne : [N+1, N+2, …]. */
export async function managerChain(service: Service, userId: string): Promise<string[]> {
  const data = (await rpc(service, "manager_chain", { p_user: userId })) as { level: number; user_id: string }[] | null;
  return (data ?? []).sort((a, b) => a.level - b.level).map((r) => r.user_id);
}

/** Personnes dont `uid` est N+1, N+2… ou délégataire pour l'action (sans le passe-droit admin). `null` : hiérarchie seule. */
export async function teamOf(service: Service, action: ApprovalAction | null, uid: string): Promise<string[]> {
  return ids(await rpc(service, "team_of", { p_action: action, p_uid: uid }));
}

/** `uid` peut-il valider l'action pour `userId` ? (administrateurs compris) */
export async function canApprove(service: Service, action: ApprovalAction, uid: string, userId: string): Promise<boolean> {
  return (await rpc(service, "can_approve", { p_action: action, p_uid: uid, p_user: userId })) === true;
}

/** Même question pour un service (demande de compte : la personne n'a pas encore de compte). */
export async function canApproveForService(service: Service, action: ApprovalAction, uid: string, serviceKey: string): Promise<boolean> {
  return (await rpc(service, "can_approve_for_service", { p_action: action, p_uid: uid, p_service: serviceKey })) === true;
}

/**
 * Qui prévenir en premier : le N+1 et ses délégataires pour l'action. Sans N+1 : les administrateurs
 * si `orAdmins`, sinon personne (frais : comme avant, les admins voient tout sans être notifiés).
 */
export async function firstApprovers(service: Service, action: ApprovalAction, userId: string, { orAdmins = false } = {}): Promise<string[]> {
  if (!orAdmins && !(await managerOf(service, userId))) return [];
  return ids(await rpc(service, "first_approvers", { p_action: action, p_user: userId }));
}

/** Idem pour un service : son responsable et ses délégataires ; sans responsable, les administrateurs. */
export async function firstApproversForService(service: Service, action: ApprovalAction, serviceKey: string): Promise<string[]> {
  return ids(await rpc(service, "first_approvers_for_service", { p_action: action, p_service: serviceKey }));
}

/** N+1 calculé de chaque compte demandé (tous si `userIds` absent). */
export async function managerMap(service: Service, userIds?: string[]): Promise<Map<string, string | null>> {
  if (userIds && userIds.length === 0) return new Map();
  let q = service.from("profile_managers").select("user_id, manager_id");
  if (userIds) q = q.in("user_id", userIds);
  const { data, error } = await q;
  if (error) throw new Error(`[profile_managers] ${error.message}`);
  return new Map((data ?? []).map((r) => [r.user_id, r.manager_id]));
}
