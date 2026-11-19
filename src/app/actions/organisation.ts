"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { managerMap, teamOf, type ApprovalAction } from "@/lib/board/hierarchy";

// Organisation (sql/2026-11-19_hierarchie_n1.sql) : services et leur responsable, délégations.
// Lecture pour tout compte connecté (organigramme, mes délégations). Responsables : administrateurs.
// Délégations : chacun pour soi (s'il a quelqu'un sous lui ou dirige un service), tout le monde pour
// un administrateur.

export type OrgService = { key: string; label: string; managerId: string | null };
export type OrgPerson = { id: string; name: string; managerId: string | null; homeService: string | null; avatarUrl: string | null };
export type OrgAction = { key: ApprovalAction; label: string; description: string | null };
export type Delegation = {
  id: string;
  delegatorId: string;
  delegateId: string;
  action: ApprovalAction;
  serviceKey: string | null;
  startsOn: string | null;
  endsOn: string | null;
  note: string | null;
};
export type Organisation = {
  services: OrgService[];
  people: OrgPerson[];
  actions: OrgAction[];
  delegations: Delegation[];
  me: { id: string; isAdmin: boolean; teamSize: number; managedServices: string[] };
};

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "Sans nom";

async function viewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const service = createServiceClient();
  const { data: me } = await service.from("profiles").select("role").eq("id", userId).single();
  return { userId, service, isAdmin: me?.role === "admin" || me?.role === "super_user" };
}

async function getOrganisationImpl(): Promise<Organisation> {
  const { userId, service, isAdmin } = await viewer();
  const delegationsQuery = isAdmin
    ? service.from("approval_delegations").select("*")
    : service.from("approval_delegations").select("*").or(`delegator_id.eq.${userId},delegate_id.eq.${userId}`);
  const [{ data: services, error }, { data: profiles }, { data: actions }, { data: delegations }, managers, team] = await Promise.all([
    service.from("org_services").select("key, label, manager_id").order("sort"),
    service.from("profiles").select("id, first_name, last_name, email, home_service, avatar_url").order("last_name"),
    service.from("approval_actions").select("key, label, description").order("sort"),
    delegationsQuery.order("created_at"),
    managerMap(service),
    teamOf(service, null, userId),
  ]);
  if (error) throw new Error(error.message);
  return {
    services: (services ?? []).map((s) => ({ key: s.key, label: s.label, managerId: s.manager_id })),
    people: (profiles ?? []).map((p) => ({ id: p.id, name: personName(p), managerId: managers.get(p.id) ?? null, homeService: p.home_service, avatarUrl: p.avatar_url })),
    actions: (actions ?? []) as OrgAction[],
    delegations: (delegations ?? []).map((d) => ({
      id: d.id,
      delegatorId: d.delegator_id,
      delegateId: d.delegate_id,
      action: d.action as ApprovalAction,
      serviceKey: d.service_key,
      startsOn: d.starts_on,
      endsOn: d.ends_on,
      note: d.note,
    })),
    me: { id: userId, isAdmin, teamSize: team.length, managedServices: (services ?? []).filter((s) => s.manager_id === userId).map((s) => s.key) },
  };
}

/** Services (clé, libellé, responsable) pour les listes déroulantes : tout compte connecté. */
async function listServicesImpl(): Promise<OrgService[]> {
  const { service } = await viewer();
  const { data, error } = await service.from("org_services").select("key, label, manager_id").order("sort");
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({ key: s.key, label: s.label, managerId: s.manager_id }));
}

async function setServiceManagerImpl(serviceKey: string, managerId: string | null) {
  const { userId, service, isAdmin } = await viewer();
  if (!isAdmin) throw new Error("Seul un administrateur choisit les responsables de service.");
  const { error } = await service
    .from("org_services")
    .update({ manager_id: managerId, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("key", serviceKey);
  if (error) throw new Error(error.message);
}

type DelegationInput = {
  delegatorId: string;
  delegateId: string;
  action: ApprovalAction;
  serviceKey: string | null;
  startsOn: string | null;
  endsOn: string | null;
  note: string | null;
};

const isDate = (v: string | null) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);
const frDate = (d: string) => d.split("-").reverse().join("/");

async function addDelegationImpl(input: DelegationInput) {
  const { userId, service, isAdmin } = await viewer();
  if (!isAdmin && input.delegatorId !== userId) throw new Error("Vous ne pouvez déléguer que vos propres validations.");
  if (input.delegatorId === input.delegateId) throw new Error("On ne peut pas se déléguer à soi-même.");
  if (!isDate(input.startsOn) || !isDate(input.endsOn)) throw new Error("Dates invalides.");
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) throw new Error("La fin est avant le début.");
  if (!isAdmin) {
    // Il faut avoir quelque chose à déléguer : une équipe, ou un service dont on est responsable.
    const [team, { data: managed }] = await Promise.all([
      teamOf(service, null, userId),
      service.from("org_services").select("key").eq("manager_id", userId),
    ]);
    if (!team.length && !(managed ?? []).length) throw new Error("Vous n'avez personne sous votre responsabilité : rien à déléguer.");
  }
  const { error } = await service.from("approval_delegations").insert({
    delegator_id: input.delegatorId,
    delegate_id: input.delegateId,
    action: input.action,
    service_key: input.serviceKey,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    note: input.note?.trim() || null,
    created_by: userId,
  });
  if (error) throw new Error(error.message);

  const [{ data: from }, { data: action }] = await Promise.all([
    service.from("profiles").select("first_name, last_name, email").eq("id", input.delegatorId).single(),
    service.from("approval_actions").select("label").eq("key", input.action).single(),
  ]);
  const period =
    input.startsOn || input.endsOn ? ` (${input.startsOn ? `du ${frDate(input.startsOn)} ` : ""}${input.endsOn ? `au ${frDate(input.endsOn)}` : "sans date de fin"})` : "";
  await service.from("notifications").insert({
    user_id: input.delegateId,
    type: "delegation" as const,
    title: "Délégation reçue",
    message: `${from ? personName(from) : "Quelqu'un"} vous confie : ${action?.label ?? input.action}${period}. Les demandes à traiter apparaîtront dans Accueil → Mes actions.`,
    data: { kind: "delegation" },
  });
}

async function removeDelegationImpl(id: string) {
  const { userId, service, isAdmin } = await viewer();
  const { data: d } = await service.from("approval_delegations").select("delegator_id, delegate_id").eq("id", id).single();
  if (!d) throw new Error("Délégation introuvable.");
  // Le délégant la retire, le délégataire peut y renoncer, l'administrateur fait les deux.
  if (!isAdmin && d.delegator_id !== userId && d.delegate_id !== userId) throw new Error("Cette délégation ne vous concerne pas.");
  const { error } = await service.from("approval_delegations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function getOrganisation() {
  return toResult(() => getOrganisationImpl());
}
export async function listServices() {
  return toResult(() => listServicesImpl());
}
export async function setServiceManager(serviceKey: string, managerId: string | null) {
  return toResult(() => setServiceManagerImpl(serviceKey, managerId));
}
export async function addDelegation(input: DelegationInput) {
  return toResult(() => addDelegationImpl(input));
}
export async function removeDelegation(id: string) {
  return toResult(() => removeDelegationImpl(id));
}
