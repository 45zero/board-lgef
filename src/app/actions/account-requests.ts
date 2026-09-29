"use server";

import { toResult } from "@/lib/board/actionResult";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { isResendConfigured, sendResendBatch } from "@/lib/email/resend";

// Demandes d'accès au board (table account_requests, partagée avec calendrier-lgef — même logique
// que son Edge Function approve-account-request). Formulaire public /demande-acces ; validation par
// un administrateur (Paramètres → Utilisateurs, ou Week-end → Couverture match), qui crée le compte,
// l'ajoute au besoin au réseau Couverture match (photographe / vidéaste) et
// envoie par e-mail un lien pour choisir son mot de passe (/mot-de-passe).

export type AccessKind = "salarie" | "arbitre" | "photographe" | "videaste" | "partenaire" | "media" | "autre";
export type PaymentMode = "reseau" | "prestataire" | "benevole";

export interface AccessRequest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  organization: string | null;
  kind: string | null;
  reason: string | null;
  createdAt: string;
}

const PAYMENT_SLUG: Record<PaymentMode, string> = { reseau: "tech-reseau", prestataire: "tech-prestataire", benevole: "tech-benevole" };

const requestSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom obligatoire.").max(80),
  lastName: z.string().trim().min(1, "Nom obligatoire.").max(80),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
  phone: z.string().trim().max(30).optional().default(""),
  organization: z.string().trim().max(120).optional().default(""),
  kind: z.enum(["salarie", "arbitre", "photographe", "videaste", "partenaire", "media", "autre"]),
  reason: z.string().trim().min(10, "Expliquez en quelques mots pourquoi vous souhaitez un accès.").max(2000),
});

/** Formulaire public : enregistre la demande et prévient les administrateurs. */
export async function submitAccessRequest(input: z.input<typeof requestSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire incomplet." };
  const r = parsed.data;
  const service = createServiceClient();

  const { data: pending } = await service.from("account_requests").select("id").eq("email", r.email).eq("status", "pending").limit(1);
  if (pending?.length) return { ok: false, error: "Une demande est déjà en cours pour cette adresse. Vous recevrez un e-mail dès qu'elle sera traitée." };

  const { error } = await service.from("account_requests").insert({
    first_name: r.firstName,
    last_name: r.lastName,
    email: r.email,
    phone: r.phone || null,
    organization: r.organization || null,
    role_requested: r.kind,
    reason: r.reason,
    status: "pending",
  });
  if (error) {
    console.error("[account-requests.submit]", error);
    return { ok: false, error: "La demande n'a pas pu être enregistrée. Réessayez plus tard." };
  }

  const { data: admins } = await service.from("profiles").select("id").in("role", ["admin", "super_user"]);
  if (admins?.length) {
    await service.from("notifications").insert(
      admins.map((a) => ({
        user_id: a.id,
        type: "account_request" as const,
        title: "Demande d'accès",
        message: `${r.firstName} ${r.lastName} (${KIND_LABELS[r.kind]}) demande un accès au board — Paramètres → Utilisateurs.`,
        data: { app: "weekend" },
      }))
    );
  }
  return { ok: true };
}

const KIND_LABELS: Record<AccessKind, string> = {
  salarie: "salarié",
  arbitre: "arbitre",
  photographe: "photographe",
  videaste: "vidéaste",
  partenaire: "partenaire",
  media: "média",
  autre: "autre",
};

async function requireAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (profile?.role !== "admin" && profile?.role !== "super_user") throw new Error("Réservé aux administrateurs.");
  return userId;
}

async function listAccessRequestsImpl(): Promise<AccessRequest[]> {
  await requireAdmin();
  const { data, error } = await createServiceClient()
    .from("account_requests")
    .select("id, first_name, last_name, email, phone, organization, role_requested, reason, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    organization: r.organization,
    kind: r.role_requested,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function sendMail(to: string, subject: string, paragraphs: string[], link?: { href: string; label: string }) {
  if (!isResendConfigured()) {
    console.warn("[account-requests] Resend non configuré — e-mail non envoyé à", to);
    return false;
  }
  const html = [
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    link ? `<p><a href="${link.href}" style="display:inline-block;background:#12305F;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(link.label)}</a></p>` : "",
    "<p>La Ligue Grand Est de Football</p>",
  ].join("");
  const text = [...paragraphs, link ? `${link.label} : ${link.href}` : "", "La Ligue Grand Est de Football"].filter(Boolean).join("\n\n");
  const { sent } = await sendResendBatch([{ to: [to], subject, html, text }], async () => {});
  return sent > 0;
}

/**
 * Accepte une demande : crée le compte (ou retrouve celui qui existe déjà — l'authentification est
 * partagée avec les autres outils LGEF), l'ajoute au réseau Couverture match (photographe et/ou
 * vidéaste) avec son mode de paiement et envoie le lien pour choisir son mot de passe.
 * `network: null` : accès simple, hors Couverture match.
 */
async function approveAccessRequestImpl(
  requestId: string,
  network: { photo: boolean; video: boolean; payment: PaymentMode } | null
): Promise<{ emailed: boolean; existingAccount: boolean }> {
  if (network && !network.photo && !network.video) network = null;
  const reviewerId = await requireAdmin();
  const service = createServiceClient();
  const { data: req, error: reqError } = await service.from("account_requests").select("*").eq("id", requestId).eq("status", "pending").single();
  if (reqError || !req) throw new Error("Demande introuvable ou déjà traitée.");

  const meta = { data: { first_name: req.first_name, last_name: req.last_name } };
  let type: "invite" | "recovery" = "invite";
  let { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "invite", email: req.email, options: meta });
  if (linkError) {
    // Adresse déjà inscrite (autre outil LGEF) : lien de réinitialisation à la place.
    type = "recovery";
    ({ data: link, error: linkError } = await service.auth.admin.generateLink({ type: "recovery", email: req.email }));
  }
  if (linkError || !link?.user) throw new Error(linkError?.message ?? "Création du compte impossible.");
  const userId = link.user.id;

  // Un compte existant garde son rôle ; un nouveau compte est un simple utilisateur.
  const { data: existing } = await service.from("profiles").select("id").eq("id", userId).maybeSingle();
  const { error: profileError } = existing
    ? await service.from("profiles").update({ first_name: req.first_name, last_name: req.last_name }).eq("id", userId)
    : await service.from("profiles").insert({ id: userId, role: "user", first_name: req.first_name, last_name: req.last_name, email: req.email });
  if (profileError) throw new Error(`Compte créé mais profil non enregistré : ${profileError.message}`);

  if (network) {
    const slugs = [...(network.photo ? ["tech-photo"] : []), ...(network.video ? ["tech-video"] : []), PAYMENT_SLUG[network.payment]];
    const { data: specs } = await service.from("specialties").select("id, slug").in("slug", slugs);
    if ((specs ?? []).length < slugs.length) throw new Error("Spécialités Couverture match introuvables.");
    const { error } = await service.from("profile_specialties").upsert((specs ?? []).map((s) => ({ user_id: userId, specialty_id: s.id })));
    if (error) throw new Error(error.message);
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
    "Votre accès au board LGEF",
    [
      `Bonjour ${req.first_name},`,
      network?.photo
        ? "Votre demande d'accès est acceptée : vous faites maintenant partie du réseau Couverture match de la Ligue Grand Est. Les matchs à photographier vous seront proposés dans le module Week-end ; le premier qui clique « Je prends » obtient le match."
        : network
          ? "Votre demande d'accès est acceptée : vous faites maintenant partie du réseau Couverture match de la Ligue Grand Est. Les captations vidéo vous seront proposées depuis le calendrier du board."
          : "Votre demande d'accès au board de la Ligue Grand Est est acceptée.",
      `Votre identifiant : ${req.email}. Choisissez votre mot de passe avec le lien ci-dessous (lien à usage unique).`,
    ],
    { href, label: "Choisir mon mot de passe" }
  );
  return { emailed, existingAccount: type === "recovery" };
}

async function rejectAccessRequestImpl(requestId: string) {
  const reviewerId = await requireAdmin();
  const service = createServiceClient();
  const { data: req } = await service
    .from("account_requests")
    .update({ status: "rejected", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("email, first_name")
    .single();
  if (!req) throw new Error("Demande introuvable ou déjà traitée.");
  await sendMail(req.email, "Votre demande d'accès au board LGEF", [
    `Bonjour ${req.first_name},`,
    "Votre demande d'accès au board de la Ligue Grand Est n'a pas été retenue. Pour toute question, répondez à la personne de la Ligue qui vous a orienté vers ce formulaire.",
  ]);
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function listAccessRequests() {
  return toResult(() => listAccessRequestsImpl());
}

export async function approveAccessRequest(requestId: string,
  network: { photo: boolean; video: boolean; payment: PaymentMode } | null) {
  return toResult(() => approveAccessRequestImpl(requestId, network));
}

export async function rejectAccessRequest(requestId: string) {
  return toResult(() => rejectAccessRequestImpl(requestId));
}
