"use server";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { toResult, type ActionResult } from "@/lib/board/actionResult";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { sendFiefEmail } from "@/lib/fief/email";
import { DEFAULT_CHARTER, eligibility, fiefUrl, type FiefClub, type FiefFunction, type FiefSettings } from "@/lib/fief/shared";

// FIEF — actions publiques de fief.lgef.fr (sans session) : formulaire de demande d'adhésion,
// recherche de club, accord parental. Écriture à la clé service ; l'accès se limite à ce que chaque
// action expose (jamais les contacts des clubs, jamais les demandes des autres).

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function loadSettings(): Promise<FiefSettings> {
  const { data } = await createServiceClient().from("fief_settings").select("*").eq("id", true).maybeSingle();
  return {
    minorsAllowed: data?.minors_allowed ?? false,
    minAge: data?.min_age ?? 13,
    parentalConsentUnder: data?.parental_consent_under ?? 18,
    charterText: data?.charter_text?.trim() || DEFAULT_CHARTER,
  };
}

/** Réglages utiles au formulaire : âge, charte, fonctions proposées. */
export async function getFiefSignupConfig(): Promise<ActionResult<{ settings: FiefSettings; functions: FiefFunction[] }>> {
  return toResult(async () => {
    const [settings, { data: fns }] = await Promise.all([
      loadSettings(),
      createServiceClient().from("fief_member_functions").select("slug, label").eq("active", true).order("position"),
    ]);
    return { settings, functions: fns ?? [] };
  });
}

/** Recherche de club par nom, ville ou numéro d'affiliation (liste des clubs du board). */
export async function searchFiefClubs(q: string): Promise<ActionResult<FiefClub[]>> {
  return toResult(async () => {
    const query = q.trim().slice(0, 80);
    if (query.length < 2) return [];
    const { data, error } = await createServiceClient().rpc("fief_club_search", { q: query, max_rows: 12 });
    if (error) throw new Error("Recherche de club indisponible.");
    return ((data ?? []) as { club_number: string; club_name: string; city: string | null }[]).map((c) => ({
      clubNumber: c.club_number,
      clubName: c.club_name,
      city: c.city,
    }));
  });
}

const applicationSchema = z
  .object({
    firstName: z.string().trim().min(1, "Prénom obligatoire.").max(80),
    lastName: z.string().trim().min(1, "Nom obligatoire.").max(80),
    email: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
    phone: z.string().trim().max(30).optional().default(""),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de naissance obligatoire."),
    club: z
      .object({ clubNumber: z.string().trim().max(20).nullable(), clubName: z.string().trim().min(2, "Indiquez votre club.").max(160) })
      .nullable(),
    noClub: z.boolean().default(false),
    functions: z.array(z.string().max(40)).min(1, "Choisissez au moins une fonction.").max(8),
    message: z.string().trim().max(2000).optional().default(""),
    parentName: z.string().trim().max(160).optional().default(""),
    parentEmail: z.string().trim().toLowerCase().optional().default(""),
    charter: z.literal(true, { message: "Merci d'accepter la charte FIEF." }),
    // Champ piège invisible : rempli seulement par les robots.
    website: z.string().max(200).optional().default(""),
  })
  .refine((v) => v.noClub || !!v.club, { message: "Indiquez votre club (ou « Je ne suis pas dans un club »).", path: ["club"] });

export type FiefApplicationInput = z.input<typeof applicationSchema>;

/**
 * Destinataires des alertes « nouvelle demande » : réglage de l'onglet FIEF (fief_settings.request_recipient_ids).
 * Liste vide → les super admins, pour qu'aucune demande ne passe inaperçue.
 */
async function managerIds() {
  const service = createServiceClient();
  const { data } = await service.from("fief_settings").select("request_recipient_ids").eq("id", true).maybeSingle();
  if (data?.request_recipient_ids?.length) return data.request_recipient_ids;
  const { data: supers } = await service.from("profiles").select("id").eq("role", "super_user");
  return (supers ?? []).map((p) => p.id);
}

async function notifyManagers(fullName: string) {
  const ids = await managerIds();
  if (!ids.length) return;
  const { error } = await createServiceClient()
    .from("notifications")
    .insert(
      ids.map((id) => ({
        user_id: id,
        type: "account_request" as const,
        title: "Demande d'adhésion FIEF",
        message: `${fullName} demande à rejoindre FIEF — onglet FIEF → Demandes.`,
        data: { app: "fief" },
      }))
    );
  if (error) console.warn("[fief.notifyManagers]", error.message);
}

/** Formulaire public : enregistre la demande ; si une mineure a besoin d'un accord parental, l'e-mail part au parent d'abord. */
export async function submitFiefApplication(input: FiefApplicationInput): Promise<ActionResult<{ awaitingParent: boolean }>> {
  return toResult(async () => {
    const parsed = applicationSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Formulaire incomplet.");
    const r = parsed.data;
    if (r.website) return { awaitingParent: false };

    const settings = await loadSettings();
    const elig = eligibility(r.birthDate, settings);
    if (!elig.ok) throw new Error(elig.reason);
    if (elig.needsParent) {
      if (r.parentName.length < 3) throw new Error("Indiquez le nom de votre parent ou responsable légal.");
      if (!z.string().email().safeParse(r.parentEmail).success) throw new Error("Adresse e-mail du parent invalide.");
      if (r.parentEmail === r.email) throw new Error("L'adresse du parent doit être différente de la vôtre.");
    }

    const service = createServiceClient();
    const { data: fns } = await service.from("fief_member_functions").select("slug").eq("active", true);
    const allowed = new Set((fns ?? []).map((f) => f.slug));
    const functions = r.functions.filter((f) => allowed.has(f));
    if (!functions.length) throw new Error("Choisissez au moins une fonction.");

    const { data: member } = await service.from("fief_members").select("status").eq("email", r.email).maybeSingle();
    if (member?.status === "active") throw new Error("Vous êtes déjà membre de FIEF : connectez-vous avec cette adresse.");
    const { data: open } = await service.from("fief_applications").select("id").eq("email", r.email).in("status", ["awaiting_parent", "pending"]).limit(1);
    if (open?.length) throw new Error("Une demande est déjà en cours pour cette adresse. Vous recevrez un e-mail dès qu'elle sera traitée.");

    const token = elig.needsParent ? randomBytes(24).toString("base64url") : null;
    const { error } = await service.from("fief_applications").insert({
      email: r.email,
      first_name: r.firstName,
      last_name: r.lastName,
      birth_date: r.birthDate,
      phone: r.phone || null,
      club_number: r.noClub ? null : r.club?.clubNumber || null,
      club_name: r.noClub ? null : r.club?.clubName || null,
      club_not_listed: !r.noClub && !r.club?.clubNumber,
      functions,
      message: r.message || null,
      status: token ? "awaiting_parent" : "pending",
      parent_name: token ? r.parentName : null,
      parent_email: token ? r.parentEmail : null,
      parent_token_hash: token ? sha256(token) : null,
      charter_accepted_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[fief.submit]", error);
      throw new Error("La demande n'a pas pu être enregistrée. Réessayez plus tard.");
    }

    if (token) {
      await sendFiefEmail({
        to: r.parentEmail,
        firstName: r.parentName,
        subject: `${r.firstName} souhaite rejoindre FIEF`,
        paragraphs: [
          `${r.firstName} ${r.lastName} a demandé à rejoindre FIEF, le réseau des femmes engagées dans le football du Grand Est, proposé par la Ligue du Grand Est de Football.`,
          "Comme elle est mineure, votre accord est nécessaire. Sa demande sera ensuite examinée par l'équipe FIEF de la Ligue.",
          "Si vous n'êtes pas à l'origine de cette démarche ou ne souhaitez pas donner votre accord, ignorez simplement cet e-mail.",
        ],
        link: { href: fiefUrl(`/parent?token=${token}`), label: "Donner mon accord" },
        footer: "Vous recevez cet e-mail car votre adresse a été indiquée comme celle du parent ou responsable légal lors d'une demande d'adhésion à FIEF.",
      });
      return { awaitingParent: true };
    }
    await notifyManagers(`${r.firstName} ${r.lastName}`);
    return { awaitingParent: false };
  });
}

/**
 * « Mot de passe oublié » : lien FIEF par e-mail, seulement pour une membre active. La réponse est
 * la même dans tous les cas (on ne révèle pas qui est inscrite).
 */
export async function requestFiefPasswordReset(email: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    const address = email.trim().toLowerCase();
    if (!z.string().email().safeParse(address).success) throw new Error("Adresse e-mail invalide.");
    const service = createServiceClient();
    const { data: member } = await service.from("fief_members").select("first_name, status").eq("email", address).maybeSingle();
    if (member?.status !== "active") return null;
    const { data: link, error } = await service.auth.admin.generateLink({ type: "recovery", email: address });
    if (error || !link?.properties?.hashed_token) {
      console.warn("[fief.reset]", error?.message);
      return null;
    }
    await sendFiefEmail({
      to: address,
      firstName: member.first_name,
      subject: "Nouveau mot de passe FIEF",
      paragraphs: [
        "Vous avez demandé à changer votre mot de passe FIEF. Le lien ci-dessous est personnel et valable 1 heure.",
        "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste valable.",
      ],
      link: { href: fiefUrl(`/mot-de-passe?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`), label: "Choisir un nouveau mot de passe" },
    });
    return null;
  });
}

/** Lien reçu par le parent : la demande passe à l'équipe FIEF. */
export async function confirmFiefParentConsent(token: string): Promise<ActionResult<{ firstName: string; alreadyDone: boolean }>> {
  return toResult(async () => {
    if (!token || token.length < 20) throw new Error("Lien invalide.");
    const service = createServiceClient();
    const { data: app } = await service
      .from("fief_applications")
      .select("id, first_name, last_name, status, parent_consent_at")
      .eq("parent_token_hash", sha256(token))
      .maybeSingle();
    if (!app) throw new Error("Ce lien n'est plus valable.");
    if (app.parent_consent_at || app.status !== "awaiting_parent") return { firstName: app.first_name, alreadyDone: true };
    const { error } = await service
      .from("fief_applications")
      .update({ status: "pending", parent_consent_at: new Date().toISOString() })
      .eq("id", app.id)
      .eq("status", "awaiting_parent");
    if (error) throw new Error("L'accord n'a pas pu être enregistré. Réessayez plus tard.");
    await notifyManagers(`${app.first_name} ${app.last_name}`);
    return { firstName: app.first_name, alreadyDone: false };
  });
}
