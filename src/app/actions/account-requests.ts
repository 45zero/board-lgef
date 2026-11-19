"use server";

import { toResult } from "@/lib/board/actionResult";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { isTransactionalEmailConfigured, sendTransactionalBatch } from "@/lib/email/transactional";
import { button, emailLayout, esc } from "@/lib/email/notificationEmails";
import { canApproveForService, firstApproversForService, teamOf } from "@/lib/board/hierarchy";
import { reviewableServices } from "@/lib/board/accessRequestsCore";
import { buildPoles } from "@/lib/board/poles";
import { ACCESS_KIND_IDS, STATUS_SLUG, accessKindLabel, type AccessStatus, type GrantableRole } from "@/lib/board/accessRequests";

// Demandes de compte (table account_requests, partagée avec calendrier-lgef). Formulaire public
// /demande-acces, ouvert à tous : la personne dit qui elle est et, si elle le sait, le service concerné.
// La demande va au responsable de ce service et à ses délégataires « comptes » (hierarchy.ts), sinon
// aux administrateurs ; le N+2 et les administrateurs peuvent aussi la traiter. À l'acceptation : compte
// créé, service de rattachement, rôle, pôles, statut, Couverture match au besoin, N+1 éventuel, puis
// e-mail pour choisir le mot de passe (/mot-de-passe). Un responsable qui n'est pas administrateur
// n'affecte qu'aux services dont il a la charge, ne donne pas de rôle élevé et ne touche pas à un
// compte qui existe déjà. Sans réponse sous 7 jours, le N+2 est relancé (escalateAccessRequests).

export interface AccessRequest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  organization: string | null;
  kind: string | null;
  reason: string | null;
  serviceKey: string | null;
  createdAt: string;
}

const requestSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom obligatoire.").max(80),
  lastName: z.string().trim().min(1, "Nom obligatoire.").max(80),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
  phone: z.string().trim().max(30).optional().default(""),
  organization: z.string().trim().max(120).optional().default(""),
  kind: z.enum(ACCESS_KIND_IDS),
  serviceKey: z.string().trim().max(40).optional().default(""),
  reason: z.string().trim().min(10, "Expliquez en quelques mots pourquoi vous souhaitez un accès.").max(2000),
});

/** Services proposés dans le formulaire public (clé, libellé) — sans les responsables. */
export async function listPublicServices(): Promise<{ key: string; label: string }[]> {
  const { data } = await createServiceClient().from("org_services").select("key, label").order("sort");
  return data ?? [];
}

/** Formulaire public : enregistre la demande et prévient le responsable du service (ou les administrateurs). */
export async function submitAccessRequest(input: z.input<typeof requestSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire incomplet." };
  const r = parsed.data;
  const service = createServiceClient();

  const { data: pending } = await service.from("account_requests").select("id").eq("email", r.email).eq("status", "pending").limit(1);
  if (pending?.length) return { ok: false, error: "Une demande est déjà en cours pour cette adresse. Vous recevrez un e-mail dès qu'elle sera traitée." };

  let serviceKey: string | null = null;
  if (r.serviceKey) {
    const { data: known } = await service.from("org_services").select("key").eq("key", r.serviceKey).maybeSingle();
    serviceKey = known?.key ?? null;
  }

  const { error } = await service.from("account_requests").insert({
    first_name: r.firstName,
    last_name: r.lastName,
    email: r.email,
    phone: r.phone || null,
    organization: r.organization || null,
    role_requested: r.kind,
    service_key: serviceKey,
    reason: r.reason,
    status: "pending",
  });
  if (error) {
    console.error("[account-requests.submit]", error);
    return { ok: false, error: "La demande n'a pas pu être enregistrée. Réessayez plus tard." };
  }

  const recipients = serviceKey ? await firstApproversForService(service, "comptes", serviceKey).catch(() => []) : await adminIds();
  const serviceLabel = serviceKey ? ` · ${await serviceLabelOf(serviceKey)}` : "";
  if (recipients.length) {
    await service.from("notifications").insert(
      recipients.map((id) => ({
        user_id: id,
        type: "account_request" as const,
        title: "Demande de compte",
        message: `${r.firstName} ${r.lastName} (${accessKindLabel(r.kind).toLowerCase()}${serviceLabel}) demande un accès au board — Accueil → Mes actions.`,
        data: { kind: "account_request" },
      }))
    );
  }
  return { ok: true };
}

async function adminIds() {
  const { data } = await createServiceClient().from("profiles").select("id").in("role", ["admin", "super_user"]);
  return (data ?? []).map((a) => a.id);
}

async function serviceLabelOf(key: string) {
  const { data } = await createServiceClient().from("org_services").select("label").eq("key", key).maybeSingle();
  return data?.label ?? key;
}

async function reviewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("role").eq("id", userId).single();
  return { userId, service, isAdmin: profile?.role === "admin" || profile?.role === "super_user" };
}

/** Demandes en attente que je peux traiter (toutes pour un administrateur). */
async function listAccessRequestsImpl(): Promise<AccessRequest[]> {
  const { userId, service, isAdmin } = await reviewer();
  const { data, error } = await service
    .from("account_requests")
    .select("id, first_name, last_name, email, phone, organization, role_requested, reason, service_key, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  let rows = data ?? [];
  if (!isAdmin) {
    const mine = await reviewableServices(service, userId);
    rows = rows.filter((r) => r.service_key && mine.has(r.service_key));
  }
  return rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    organization: r.organization,
    kind: r.role_requested,
    reason: r.reason,
    serviceKey: r.service_key,
    createdAt: r.created_at,
  }));
}

/** E-mail au demandeur, à la mise en page des autres e-mails du board (en-tête LGEF, bouton). */
async function sendMail(
  to: string,
  firstName: string | null,
  subject: string,
  paragraphs: string[],
  link?: { href: string; label: string }
) {
  if (!isTransactionalEmailConfigured()) {
    console.warn("[account-requests] envoi d'e-mails non configuré (Brevo / Resend) — e-mail non envoyé à", to);
    return false;
  }
  const html = emailLayout({
    firstName,
    title: subject,
    body: paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 10px;color:#1e293b">${esc(p)}</p>`).join(""),
    buttons: link ? button(link.label, link.href, "navy") : "",
    footer: `Vous recevez cet e-mail suite à votre demande d'accès au board de la Ligue Grand Est de Football.`,
  });
  const text = [`Bonjour${firstName ? ` ${firstName}` : ""},`, subject, ...paragraphs, link ? `${link.label} : ${link.href}` : "", "— Board LGEF"]
    .filter(Boolean)
    .join("\n\n");
  const { sent } = await sendTransactionalBatch([{ to: [to], subject, html, text }], async () => {});
  return sent > 0;
}

export type ApprovalInput = {
  /** Service de rattachement : son responsable devient le N+1 par défaut. */
  serviceKey: string | null;
  role: GrantableRole;
  /** Pôles ouverts (clés de buildPoles) : accès aux événements de ces types. */
  poles: string[];
  status: AccessStatus | null;
  photo: boolean;
  video: boolean;
  /** N+1 choisi pour cette personne ; null : le responsable de son service. */
  managerId: string | null;
};

/**
 * Accepte une demande : crée le compte (ou, pour un administrateur, retrouve celui qui existe déjà —
 * l'authentification est partagée avec les autres outils LGEF), l'affecte (service, rôle, pôles,
 * statut, Couverture match, N+1) et envoie le lien pour choisir son mot de passe.
 */
async function approveAccessRequestImpl(requestId: string, input: ApprovalInput): Promise<{ emailed: boolean; existingAccount: boolean }> {
  const { userId: reviewerId, service, isAdmin } = await reviewer();
  const { data: req, error: reqError } = await service.from("account_requests").select("*").eq("id", requestId).eq("status", "pending").single();
  if (reqError || !req) throw new Error("Demande introuvable ou déjà traitée.");

  // Droits d'un responsable non administrateur : la demande et l'affectation dans son périmètre.
  if (!isAdmin) {
    if (!req.service_key || !(await canApproveForService(service, "comptes", reviewerId, req.service_key))) {
      throw new Error("Cette demande ne relève pas d'un service dont vous avez la charge.");
    }
    if (!input.serviceKey || !(await canApproveForService(service, "comptes", reviewerId, input.serviceKey))) {
      throw new Error("Vous ne pouvez rattacher la personne qu'à un service dont vous avez la charge.");
    }
    if (input.role === "comite_directeur") throw new Error("Seul un administrateur donne le rôle Comité directeur.");
    const mine = await reviewableServices(service, reviewerId);
    if (input.poles.some((k) => !mine.has(k))) throw new Error("Vous ne pouvez ouvrir que les pôles des services dont vous avez la charge.");
    if (input.managerId) {
      // Le N+1 choisi doit être dans le périmètre : soi-même ou quelqu'un de son équipe.
      const team = await teamOf(service, null, reviewerId);
      if (input.managerId !== reviewerId && !team.includes(input.managerId)) throw new Error("Le N+1 choisi doit être vous ou quelqu'un de votre équipe.");
    }
  }
  if (!["user", "technician", "organizer", "comite_directeur"].includes(input.role)) throw new Error("Rôle invalide.");

  const meta = { data: { first_name: req.first_name, last_name: req.last_name } };
  let type: "invite" | "recovery" = "invite";
  let { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "invite", email: req.email, options: meta });
  if (linkError) {
    // Adresse déjà inscrite (autre outil LGEF) : réservé aux administrateurs, qui voient le compte entier.
    if (!isAdmin) throw new Error("Cette adresse a déjà un compte LGEF : un administrateur doit traiter la demande.");
    type = "recovery";
    ({ data: link, error: linkError } = await service.auth.admin.generateLink({ type: "recovery", email: req.email }));
  }
  if (linkError || !link?.user) throw new Error(linkError?.message ?? "Création du compte impossible.");
  const userId = link.user.id;

  // Un compte existant garde son rôle ; un nouveau compte reçoit le rôle choisi.
  const { data: existing } = await service.from("profiles").select("id").eq("id", userId).maybeSingle();
  const profile = {
    first_name: req.first_name,
    last_name: req.last_name,
    home_service: input.serviceKey,
    ...(input.managerId && input.managerId !== userId ? { expense_validator_id: input.managerId } : {}),
  };
  const { error: profileError } = existing
    ? await service.from("profiles").update(profile).eq("id", userId)
    : await service.from("profiles").insert({ id: userId, email: req.email, role: input.role, ...profile });
  if (profileError) throw new Error(`Compte créé mais profil non enregistré : ${profileError.message}`);

  // Spécialités : pôles (les deux spécialités org-/tech- de chaque pôle), statut, Couverture match.
  const { data: catalog } = await service.from("specialties").select("id, slug, label, domain");
  const poleSlugs = buildPoles(catalog ?? [])
    .filter((p) => input.poles.includes(p.key))
    .flatMap((p) => p.slugs);
  const slugs = [
    ...poleSlugs,
    ...(input.status ? [STATUS_SLUG[input.status]] : []),
    ...(input.photo ? ["tech-photo"] : []),
    ...(input.video ? ["tech-video"] : []),
  ];
  const specs = (catalog ?? []).filter((c) => slugs.includes(c.slug));
  if (specs.length) {
    const { error } = await service.from("profile_specialties").upsert(specs.map((s) => ({ user_id: userId, specialty_id: s.id })));
    if (error) throw new Error(`Compte créé mais accès non enregistrés : ${error.message}`);
  }

  const { error: updateError } = await service
    .from("account_requests")
    .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);
  if (updateError) throw new Error(updateError.message);

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const href = `${site}/mot-de-passe?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=${type}`;
  const emailed = await sendMail(
    req.email,
    req.first_name,
    "Votre accès au board LGEF",
    [
      input.photo
        ? "Votre demande d'accès est acceptée : vous faites maintenant partie du réseau Couverture match de la Ligue Grand Est. Les matchs à photographier vous seront proposés dans le module Week-end ; le premier qui clique « Je prends » obtient le match."
        : input.video
          ? "Votre demande d'accès est acceptée : vous faites maintenant partie du réseau Couverture match de la Ligue Grand Est. Les captations vidéo vous seront proposées depuis le calendrier du board."
          : "Votre demande d'accès au board de la Ligue Grand Est est acceptée.",
      `Votre identifiant : ${req.email}. Choisissez votre mot de passe avec le lien ci-dessous (lien à usage unique).`,
    ],
    { href, label: "Choisir mon mot de passe" }
  );
  return { emailed, existingAccount: type === "recovery" };
}

/** Comptes du board pouvant être choisis comme N+1 à l'acceptation : tous (admin), soi et son équipe sinon. */
async function listManagerOptionsImpl(): Promise<{ id: string; name: string }[]> {
  const { userId, service, isAdmin } = await reviewer();
  const { data, error } = await service.from("profiles").select("id, first_name, last_name").order("last_name").order("first_name");
  if (error) throw new Error(error.message);
  let allowed: Set<string> | null = null;
  if (!isAdmin) {
    allowed = new Set([userId, ...(await teamOf(service, null, userId))]);
  }
  return (data ?? [])
    .filter((p) => !allowed || allowed.has(p.id))
    .map((p) => ({ id: p.id, name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() }))
    .filter((p) => p.name);
}

async function rejectAccessRequestImpl(requestId: string) {
  const { userId: reviewerId, service, isAdmin } = await reviewer();
  if (!isAdmin) {
    const { data: r } = await service.from("account_requests").select("service_key").eq("id", requestId).single();
    if (!r?.service_key || !(await canApproveForService(service, "comptes", reviewerId, r.service_key))) {
      throw new Error("Cette demande ne relève pas d'un service dont vous avez la charge.");
    }
  }
  const { data: req } = await service
    .from("account_requests")
    .update({ status: "rejected", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("email, first_name")
    .single();
  if (!req) throw new Error("Demande introuvable ou déjà traitée.");
  await sendMail(req.email, req.first_name, "Votre demande d'accès au board LGEF", [
    "Votre demande d'accès au board de la Ligue Grand Est n'a pas été retenue. Pour toute question, répondez à la personne de la Ligue qui vous a orienté vers ce formulaire.",
  ]);
}

/** Change le service d'une demande (mauvais service choisi par le demandeur) et prévient le nouveau responsable. */
async function forwardAccessRequestImpl(requestId: string, serviceKey: string | null) {
  const { userId: reviewerId, service, isAdmin } = await reviewer();
  const { data: r } = await service.from("account_requests").select("first_name, last_name, role_requested, service_key").eq("id", requestId).eq("status", "pending").single();
  if (!r) throw new Error("Demande introuvable ou déjà traitée.");
  if (!isAdmin && (!r.service_key || !(await canApproveForService(service, "comptes", reviewerId, r.service_key)))) {
    throw new Error("Cette demande ne relève pas d'un service dont vous avez la charge.");
  }
  const { error } = await service.from("account_requests").update({ service_key: serviceKey, escalated_at: null }).eq("id", requestId);
  if (error) throw new Error(error.message);
  const recipients = (serviceKey ? await firstApproversForService(service, "comptes", serviceKey) : await adminIds()).filter((id) => id !== reviewerId);
  if (recipients.length) {
    const target = serviceKey ? ` au service ${await serviceLabelOf(serviceKey)}` : " aux administrateurs";
    await service.from("notifications").insert(
      recipients.map((id) => ({
        user_id: id,
        type: "account_request" as const,
        title: "Demande de compte transmise",
        message: `${r.first_name} ${r.last_name} (${accessKindLabel(r.role_requested).toLowerCase()}) — demande transmise${target}. Accueil → Mes actions.`,
        data: { kind: "account_request" },
      }))
    );
  }
}

/** Ce que je peux faire sur les demandes : tout (admin) ou les services dont j'ai la charge, et la liste des services. */
async function getAccessReviewScopeImpl(): Promise<{ isAdmin: boolean; reviewable: string[]; services: { key: string; label: string; managerId: string | null; managerName: string | null }[] }> {
  const { userId, service, isAdmin } = await reviewer();
  const [{ data: services }, reviewable] = await Promise.all([
    service.from("org_services").select("key, label, manager_id").order("sort"),
    isAdmin ? Promise.resolve(null) : reviewableServices(service, userId),
  ]);
  const managerIds = [...new Set((services ?? []).map((s) => s.manager_id).filter((id): id is string => !!id))];
  const { data: managers } = managerIds.length ? await service.from("profiles").select("id, first_name, last_name").in("id", managerIds) : { data: [] };
  const nameOf = new Map((managers ?? []).map((m) => [m.id, `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim()]));
  return {
    isAdmin,
    reviewable: reviewable ? [...reviewable] : (services ?? []).map((s) => s.key),
    services: (services ?? []).map((s) => ({ key: s.key, label: s.label, managerId: s.manager_id, managerName: s.manager_id ? (nameOf.get(s.manager_id) ?? null) : null })),
  };
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function listAccessRequests() {
  return toResult(() => listAccessRequestsImpl());
}

export async function approveAccessRequest(requestId: string, input: ApprovalInput) {
  return toResult(() => approveAccessRequestImpl(requestId, input));
}

export async function forwardAccessRequest(requestId: string, serviceKey: string | null) {
  return toResult(() => forwardAccessRequestImpl(requestId, serviceKey));
}

export async function listManagerOptions() {
  return toResult(() => listManagerOptionsImpl());
}

export async function rejectAccessRequest(requestId: string) {
  return toResult(() => rejectAccessRequestImpl(requestId));
}

export async function getAccessReviewScope() {
  return toResult(() => getAccessReviewScopeImpl());
}
