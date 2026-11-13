"use server";

import { z } from "zod";
import { toResult, type ActionResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { sendFiefEmail, sendFiefEmails } from "@/lib/fief/email";
import { sendFiefPush } from "@/lib/fief/push";
import { DEFAULT_CHARTER, fiefUrl, type FiefSettings } from "@/lib/fief/shared";

// FIEF — actions de l'onglet FIEF du board (module « fief », Claire et les administrateurs) :
// demandes d'adhésion, membres, réglages. Le contrôle passe par fief_is_manager() (règle du module).
//
// Validation d'une demande :
//  - nouvelle adresse → compte créé avec app_metadata.realm = 'fief' (cloisonné du board,
//    sql/2026-11-13_fief_cloison.sql) et lien « choisir mon mot de passe » sur fief.lgef.fr ;
//  - adresse déjà connue (compte du board ou d'un autre outil LGEF) → le compte reste tel quel
//    (pas de marqueur, qui le couperait de ses autres outils) ; e-mail « connectez-vous ».

export interface FiefApplicationRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  birthDate: string;
  clubNumber: string | null;
  clubName: string | null;
  clubNotListed: boolean;
  functions: string[];
  message: string | null;
  status: "awaiting_parent" | "pending" | "approved" | "refused" | "withdrawn";
  parentName: string | null;
  parentEmail: string | null;
  parentConsentAt: string | null;
  refusalReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface FiefMemberRow {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  birthDate: string | null;
  clubNumber: string | null;
  clubName: string | null;
  functions: string[];
  status: "active" | "suspended" | "left";
  statusReason: string | null;
  joinedAt: string;
  lastSeenAt: string | null;
}

export interface FiefOverview {
  counts: { pending: number; awaitingParent: number; members: number; suspended: number };
  pending: FiefApplicationRow[];
  settings: FiefSettings;
  functions: { slug: string; label: string; active: boolean; position: number }[];
  /** Destinataires des alertes « nouvelle demande » (vide : les super admins). */
  recipients: string[];
  /** Personnes qui voient l'onglet FIEF (choix possibles des destinataires). */
  candidates: { userId: string; name: string; role: string }[];
}

async function requireManager() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const { data: ok, error } = await supabase.rpc("fief_is_manager");
  if (error || ok !== true) throw new Error("Réservé à l'équipe FIEF.");
  return userId;
}

const APP_COLUMNS =
  "id, first_name, last_name, email, phone, birth_date, club_number, club_name, club_not_listed, functions, message, status, parent_name, parent_email, parent_consent_at, refusal_reason, reviewed_at, created_at";

async function loadApplications(statuses: FiefApplicationRow["status"][], limit = 200) {
  const { data, error } = await createServiceClient()
    .from("fief_applications")
    .select(APP_COLUMNS)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

type AppDb = Awaited<ReturnType<typeof loadApplications>>[number];

const toApp = (r: AppDb): FiefApplicationRow => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  email: r.email,
  phone: r.phone,
  birthDate: r.birth_date,
  clubNumber: r.club_number,
  clubName: r.club_name,
  clubNotListed: r.club_not_listed,
  functions: r.functions,
  message: r.message,
  status: r.status,
  parentName: r.parent_name,
  parentEmail: r.parent_email,
  parentConsentAt: r.parent_consent_at,
  refusalReason: r.refusal_reason,
  reviewedAt: r.reviewed_at,
  createdAt: r.created_at,
});

/** Ouverture de l'onglet : chiffres, demandes à traiter, réglages, fonctions — en un appel. */
export async function getFiefOverview(): Promise<ActionResult<FiefOverview>> {
  return toResult(async () => {
    await requireManager();
    const service = createServiceClient();
    const countApps = (status: FiefApplicationRow["status"]) =>
      service.from("fief_applications").select("*", { count: "exact", head: true }).eq("status", status).then((r) => r.count ?? 0);
    const countMembers = (status: FiefMemberRow["status"]) =>
      service.from("fief_members").select("*", { count: "exact", head: true }).eq("status", status).then((r) => r.count ?? 0);
    const [pending, awaitingParent, members, suspended, rows, { data: s }, { data: fns }, { data: cands }] = await Promise.all([
      countApps("pending"),
      countApps("awaiting_parent"),
      countMembers("active"),
      countMembers("suspended"),
      loadApplications(["pending"], 100),
      service.from("fief_settings").select("*").eq("id", true).maybeSingle(),
      service.from("fief_member_functions").select("slug, label, active, position").order("position"),
      service.rpc("fief_manager_candidates"),
    ]);
    return {
      counts: { pending, awaitingParent, members, suspended },
      pending: rows.map(toApp),
      settings: {
        minorsAllowed: s?.minors_allowed ?? false,
        minAge: s?.min_age ?? 13,
        parentalConsentUnder: s?.parental_consent_under ?? 18,
        charterText: s?.charter_text ?? null,
      },
      functions: fns ?? [],
      recipients: s?.request_recipient_ids ?? [],
      candidates: ((cands ?? []) as { user_id: string; first_name: string | null; last_name: string | null; role: string }[]).map((c) => ({
        userId: c.user_id,
        name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sans nom",
        role: c.role,
      })),
    };
  });
}

/** Qui reçoit les alertes « nouvelle demande d'adhésion » (parmi les personnes qui voient l'onglet FIEF). */
export async function saveFiefRequestRecipients(userIds: string[]): Promise<ActionResult<null>> {
  return toResult(async () => {
    const me = await requireManager();
    const ids = [...new Set(userIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const service = createServiceClient();
    const { data: cands, error: candError } = await service.rpc("fief_manager_candidates");
    if (candError) throw new Error(candError.message);
    const allowed = new Set(((cands ?? []) as { user_id: string }[]).map((c) => c.user_id));
    const unknown = ids.filter((id) => !allowed.has(id));
    if (unknown.length) throw new Error("Une personne choisie ne voit pas l'onglet FIEF : donnez-lui d'abord l'accès au module.");
    const { error } = await service.from("fief_settings").update({ request_recipient_ids: ids, updated_by: me }).eq("id", true);
    if (error) throw new Error(error.message);
    return null;
  });
}

/** Demandes par état : à traiter, en attente du parent, ou déjà traitées (historique). */
export async function listFiefApplications(scope: "pending" | "awaiting_parent" | "processed"): Promise<ActionResult<FiefApplicationRow[]>> {
  return toResult(async () => {
    await requireManager();
    const statuses: FiefApplicationRow["status"][] = scope === "processed" ? ["approved", "refused", "withdrawn"] : [scope];
    return (await loadApplications(statuses)).map(toApp);
  });
}

/** Accepte une demande : compte FIEF (ou compte existant), fiche membre, e-mail d'accueil. */
export async function approveFiefApplication(id: string): Promise<ActionResult<{ emailed: boolean; existingAccount: boolean }>> {
  return toResult(async () => {
    const reviewerId = await requireManager();
    const service = createServiceClient();
    const { data: app } = await service.from("fief_applications").select("*").eq("id", id).eq("status", "pending").maybeSingle();
    if (!app) throw new Error("Demande introuvable ou déjà traitée.");

    // Nouvelle adresse : l'invitation crée le compte. Adresse connue : l'invitation échoue, on retrouve le compte.
    const meta = { data: { first_name: app.first_name, last_name: app.last_name } };
    const invite = await service.auth.admin.generateLink({ type: "invite", email: app.email, options: meta });
    let userId: string;
    let existingAccount = false;
    let passwordLink: string | null = null;
    if (!invite.error && invite.data.user) {
      userId = invite.data.user.id;
      const { error } = await service.auth.admin.updateUserById(userId, { app_metadata: { realm: "fief" } });
      if (error) {
        // Jamais de compte FIEF sans marqueur : il ne serait pas cloisonné du board.
        await service.auth.admin.deleteUser(userId);
        throw new Error(`Compte non créé (cloison impossible) : ${error.message}`);
      }
      passwordLink = fiefUrl(`/mot-de-passe?token_hash=${encodeURIComponent(invite.data.properties.hashed_token)}&type=invite`);
    } else {
      // generateLink « recovery » ne fait que retrouver le compte : aucun e-mail n'est envoyé, le mot de passe ne change pas.
      const found = await service.auth.admin.generateLink({ type: "recovery", email: app.email });
      if (found.error || !found.data.user) throw new Error(invite.error?.message ?? "Création du compte impossible.");
      userId = found.data.user.id;
      existingAccount = true;
    }

    const { error: memberError } = await service.from("fief_members").upsert(
      {
        user_id: userId,
        application_id: app.id,
        email: app.email,
        first_name: app.first_name,
        last_name: app.last_name,
        birth_date: app.birth_date,
        phone: app.phone,
        club_number: app.club_number,
        club_name: app.club_name,
        functions: app.functions,
        status: "active",
        status_reason: null,
        approved_by: reviewerId,
      },
      { onConflict: "user_id" }
    );
    if (memberError) throw new Error(`Compte prêt mais fiche membre non enregistrée : ${memberError.message}`);

    const { error: updateError } = await service
      .from("fief_applications")
      .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), user_id: userId })
      .eq("id", app.id);
    if (updateError) throw new Error(updateError.message);

    const welcome = "Votre demande d'adhésion a été acceptée : vous faites maintenant partie du réseau des femmes engagées dans le football du Grand Est.";
    const emailed = await sendFiefEmail({
      to: app.email,
      firstName: app.first_name,
      subject: "Bienvenue sur FIEF !",
      paragraphs: passwordLink
        ? [welcome, "Choisissez votre mot de passe pour vous connecter. Le lien est personnel et valable 24 heures."]
        : [welcome, "Votre adresse est déjà liée à un compte de la Ligue : connectez-vous sur FIEF avec vos identifiants habituels (ou « Mot de passe oublié »)."],
      link: passwordLink ? { href: passwordLink, label: "Choisir mon mot de passe" } : { href: fiefUrl("/connexion"), label: "Me connecter à FIEF" },
    });
    return { emailed, existingAccount };
  });
}

/** Refuse une demande ; le motif (facultatif) est repris dans l'e-mail. */
export async function refuseFiefApplication(id: string, reason: string, notify: boolean): Promise<ActionResult<{ emailed: boolean }>> {
  return toResult(async () => {
    const reviewerId = await requireManager();
    const motive = reason.trim().slice(0, 2000);
    const { data: app, error } = await createServiceClient()
      .from("fief_applications")
      .update({ status: "refused", refusal_reason: motive || null, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["pending", "awaiting_parent"])
      .select("email, first_name")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!app) throw new Error("Demande introuvable ou déjà traitée.");
    if (!notify) return { emailed: false };
    const emailed = await sendFiefEmail({
      to: app.email,
      firstName: app.first_name,
      subject: "Votre demande d'adhésion à FIEF",
      paragraphs: [
        "Merci pour votre intérêt pour FIEF. Votre demande d'adhésion n'a pas été retenue.",
        ...(motive ? [`Motif : ${motive}`] : []),
        "Pour toute question, vous pouvez contacter l'équipe FIEF de la Ligue du Grand Est de Football.",
      ],
    });
    return { emailed };
  });
}

/** Annuaire complet pour l'équipe FIEF (toutes les fiches, y compris suspendues). */
export async function listFiefMembers(): Promise<ActionResult<FiefMemberRow[]>> {
  return toResult(async () => {
    await requireManager();
    const { data, error } = await createServiceClient()
      .from("fief_members")
      .select("user_id, first_name, last_name, email, phone, birth_date, club_number, club_name, functions, status, status_reason, joined_at, last_seen_at")
      .order("last_name")
      .order("first_name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((m) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
      email: m.email,
      phone: m.phone,
      birthDate: m.birth_date,
      clubNumber: m.club_number,
      clubName: m.club_name,
      functions: m.functions,
      status: m.status,
      statusReason: m.status_reason,
      joinedAt: m.joined_at,
      lastSeenAt: m.last_seen_at,
    }));
  });
}

/** Suspendre / réactiver une membre (une membre suspendue ne voit plus le réseau). */
export async function setFiefMemberStatus(userId: string, status: "active" | "suspended", reason: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    await requireManager();
    const { error } = await createServiceClient()
      .from("fief_members")
      .update({ status, status_reason: status === "suspended" ? reason.trim().slice(0, 500) || null : null })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return null;
  });
}

const settingsSchema = z
  .object({
    minorsAllowed: z.boolean(),
    minAge: z.number().int().min(10).max(18),
    parentalConsentUnder: z.number().int().min(15).max(18),
    charterText: z.string().trim().max(5000).nullable(),
  })
  .refine((s) => !s.minorsAllowed || s.parentalConsentUnder >= s.minAge, {
    message: "L'âge de l'accord parental doit être au moins égal à l'âge minimum.",
  });

export async function updateFiefSettings(input: FiefSettings): Promise<ActionResult<null>> {
  return toResult(async () => {
    const userId = await requireManager();
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Réglages invalides.");
    const s = parsed.data;
    const { error } = await createServiceClient()
      .from("fief_settings")
      .update({
        minors_allowed: s.minorsAllowed,
        min_age: s.minAge,
        parental_consent_under: s.parentalConsentUnder,
        charter_text: s.charterText && s.charterText !== DEFAULT_CHARTER ? s.charterText : null,
        updated_by: userId,
      })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return null;
  });
}

const slugify = (label: string) =>
  label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Ajoute une fonction proposée à l'inscription, ou en change le libellé / l'affichage. */
export async function saveFiefFunction(input: { slug?: string; label: string; active: boolean }): Promise<ActionResult<null>> {
  return toResult(async () => {
    await requireManager();
    const label = input.label.trim().slice(0, 80);
    if (label.length < 2) throw new Error("Libellé trop court.");
    const service = createServiceClient();
    if (input.slug) {
      const { error } = await service.from("fief_member_functions").update({ label, active: input.active }).eq("slug", input.slug);
      if (error) throw new Error(error.message);
      return null;
    }
    const slug = slugify(label);
    if (!slug) throw new Error("Libellé invalide.");
    const { data: last } = await service.from("fief_member_functions").select("position").neq("slug", "autre").order("position", { ascending: false }).limit(1);
    const { error } = await service.from("fief_member_functions").insert({ slug, label, active: input.active, position: (last?.[0]?.position ?? 0) + 10 });
    if (error) throw new Error(error.code === "23505" ? "Cette fonction existe déjà." : error.message);
    return null;
  });
}

// ── Événements « Visible sur FIEF » (lot 2, sql/2026-11-13_fief_evenements.sql) ──────────────────────

export type FiefAudience = "all" | "clubs" | "functions" | "members";

export interface FiefShareInput {
  audience: FiefAudience;
  clubNumbers: string[];
  functions: string[];
  memberIds: string[];
}

export interface FiefEventShareState {
  share: (FiefShareInput & { sharedAt: string; notifiedAt: string | null }) | null;
  options: {
    clubs: { clubNumber: string; clubName: string; count: number }[];
    functions: { slug: string; label: string }[];
    members: { userId: string; name: string; clubName: string | null }[];
  };
}

/** Partage FIEF d'un événement + choix possibles (clubs des membres, fonctions, membres). */
export async function getFiefEventShare(eventId: string): Promise<ActionResult<FiefEventShareState>> {
  return toResult(async () => {
    await requireManager();
    const service = createServiceClient();
    const [{ data: share }, { data: members }, { data: fns }] = await Promise.all([
      service.from("fief_event_shares").select("*").eq("event_id", eventId).maybeSingle(),
      service.from("fief_members").select("user_id, first_name, last_name, club_number, club_name").eq("status", "active").order("last_name"),
      service.from("fief_member_functions").select("slug, label").order("position"),
    ]);
    const clubs = new Map<string, { clubNumber: string; clubName: string; count: number }>();
    for (const m of members ?? []) {
      if (!m.club_number) continue;
      const c = clubs.get(m.club_number) ?? { clubNumber: m.club_number, clubName: m.club_name ?? m.club_number, count: 0 };
      c.count += 1;
      clubs.set(m.club_number, c);
    }
    return {
      share: share
        ? {
            audience: share.audience,
            clubNumbers: share.club_numbers,
            functions: share.functions,
            memberIds: share.member_ids,
            sharedAt: share.shared_at,
            notifiedAt: share.notified_at,
          }
        : null,
      options: {
        clubs: [...clubs.values()].sort((a, b) => a.clubName.localeCompare(b.clubName, "fr")),
        functions: fns ?? [],
        members: (members ?? []).map((m) => ({ userId: m.user_id, name: `${m.first_name} ${m.last_name}`, clubName: m.club_name })),
      },
    };
  });
}

const shareSchema = z.object({
  enabled: z.boolean(),
  audience: z.enum(["all", "clubs", "functions", "members"]),
  clubNumbers: z.array(z.string().max(20)).max(200),
  functions: z.array(z.string().max(40)).max(50),
  memberIds: z.array(z.string().uuid()).max(2000),
  notify: z.boolean(),
});

const whenFr = (start: string, end: string | null) => {
  const opts = { timeZone: "Europe/Paris" } as const;
  const day = new Date(start).toLocaleDateString("fr-FR", { ...opts, weekday: "long", day: "numeric", month: "long" });
  const from = new Date(start).toLocaleTimeString("fr-FR", { ...opts, hour: "2-digit", minute: "2-digit" });
  const to = end ? new Date(end).toLocaleTimeString("fr-FR", { ...opts, hour: "2-digit", minute: "2-digit" }) : null;
  return `${day} · ${from}${to && to !== from ? ` – ${to}` : ""}`;
};

/**
 * Active / met à jour / retire le partage FIEF d'un événement. Avec `notify`, le public reçoit une
 * notification FIEF, un push (appareils abonnés) et un e-mail.
 */
export async function saveFiefEventShare(
  eventId: string,
  input: z.input<typeof shareSchema>
): Promise<ActionResult<{ shared: boolean; notified: number; pushed: number; emailed: number }>> {
  return toResult(async () => {
    const userId = await requireManager();
    const parsed = shareSchema.safeParse(input);
    if (!parsed.success) throw new Error("Réglage de partage invalide.");
    const s = parsed.data;
    const service = createServiceClient();

    if (!s.enabled) {
      const { error } = await service.from("fief_event_shares").delete().eq("event_id", eventId);
      if (error) throw new Error(error.message);
      return { shared: false, notified: 0, pushed: 0, emailed: 0 };
    }
    if (s.audience === "clubs" && !s.clubNumbers.length) throw new Error("Choisissez au moins un club.");
    if (s.audience === "functions" && !s.functions.length) throw new Error("Choisissez au moins une fonction.");
    if (s.audience === "members" && !s.memberIds.length) throw new Error("Choisissez au moins une personne.");

    const { data: event } = await service.from("events").select("id, title, start_date, end_date, location, event_address").eq("id", eventId).maybeSingle();
    if (!event) throw new Error("Événement introuvable.");

    const { error } = await service.from("fief_event_shares").upsert(
      {
        event_id: eventId,
        audience: s.audience,
        club_numbers: s.audience === "clubs" ? s.clubNumbers : [],
        functions: s.audience === "functions" ? s.functions : [],
        member_ids: s.audience === "members" ? s.memberIds : [],
        shared_by: userId,
      },
      { onConflict: "event_id" }
    );
    if (error) throw new Error(error.message);
    if (!s.notify) return { shared: true, notified: 0, pushed: 0, emailed: 0 };

    const { data: audience, error: audError } = await service.rpc("fief_event_audience", { p_event_id: eventId });
    if (audError) throw new Error(audError.message);
    const people = (audience ?? []) as { user_id: string; email: string; first_name: string }[];
    if (!people.length) return { shared: true, notified: 0, pushed: 0, emailed: 0 };

    const when = whenFr(event.start_date, event.end_date);
    const place = event.event_address || event.location;
    const body = `${when}${place ? ` · ${place}` : ""}`;
    const route = `/calendrier?event=${eventId}`;
    const { error: notifError } = await service
      .from("fief_notifications")
      .insert(people.map((p) => ({ user_id: p.user_id, kind: "event" as const, title: `Nouvel événement : ${event.title}`, body, route, event_id: eventId })));
    if (notifError) throw new Error(`Partage enregistré mais notifications non créées : ${notifError.message}`);

    const ids = people.map((p) => p.user_id);
    const [pushed, emailed] = await Promise.all([
      sendFiefPush(ids, { title: `FIEF · ${event.title}`, body, route, tag: `fief-event-${eventId}` }),
      sendFiefEmails(
        people.map((p) => ({
          to: p.email,
          firstName: p.first_name,
          subject: `Nouvel événement FIEF : ${event.title}`,
          paragraphs: [`Vous êtes invitée à « ${event.title} ».`, `Quand : ${when}`, ...(place ? [`Où : ${place}`] : []), "Retrouvez-le dans votre calendrier FIEF."],
          link: { href: fiefUrl(route), label: "Voir dans mon calendrier" },
        }))
      ),
    ]);
    await service.from("fief_event_shares").update({ notified_at: new Date().toISOString() }).eq("event_id", eventId);
    return { shared: true, notified: people.length, pushed: pushed.size, emailed };
  });
}

export interface FiefEventRow {
  id: string;
  title: string;
  startDate: string;
  endDate: string | null;
  location: string | null;
  share: { audience: FiefAudience; count: number; notifiedAt: string | null } | null;
}

/** Événements à venir du board (4 mois), avec leur état de partage FIEF — onglet FIEF → Événements. */
export async function listFiefEvents(): Promise<ActionResult<FiefEventRow[]>> {
  return toResult(async () => {
    await requireManager();
    const service = createServiceClient();
    const now = new Date();
    const until = new Date(now.getTime() + 120 * 86_400_000);
    const [{ data: events, error }, { data: shares }] = await Promise.all([
      service
        .from("events")
        .select("id, title, start_date, end_date, location, event_address")
        .gte("start_date", new Date(now.getTime() - 86_400_000).toISOString())
        .lte("start_date", until.toISOString())
        .order("start_date")
        .limit(300),
      service.from("fief_event_shares").select("event_id, audience, club_numbers, functions, member_ids, notified_at"),
    ]);
    if (error) throw new Error(error.message);
    const byEvent = new Map((shares ?? []).map((s) => [s.event_id, s]));
    return (events ?? []).map((e) => {
      const s = byEvent.get(e.id);
      return {
        id: e.id,
        title: e.title,
        startDate: e.start_date,
        endDate: e.end_date,
        location: e.event_address || e.location,
        share: s
          ? {
              audience: s.audience,
              count: s.audience === "clubs" ? s.club_numbers.length : s.audience === "functions" ? s.functions.length : s.audience === "members" ? s.member_ids.length : 0,
              notifiedAt: s.notified_at,
            }
          : null,
      };
    });
  });
}

// ── Modération du fil (lot 3, sql/2026-11-13_fief_social.sql) ──────────────────────────────────────

/** Épingler / masquer une publication (masquée : visible de son autrice et de l'équipe seulement). */
export async function moderateFiefPost(postId: string, change: { pinned?: boolean; hidden?: boolean; reason?: string }): Promise<ActionResult<null>> {
  return toResult(async () => {
    const userId = await requireManager();
    const patch: { pinned?: boolean; hidden_at?: string | null; hidden_by?: string | null; hidden_reason?: string | null } = {};
    if (change.pinned !== undefined) patch.pinned = change.pinned;
    if (change.hidden !== undefined) {
      patch.hidden_at = change.hidden ? new Date().toISOString() : null;
      patch.hidden_by = change.hidden ? userId : null;
      patch.hidden_reason = change.hidden ? change.reason?.trim().slice(0, 500) || null : null;
    }
    const { error } = await createServiceClient().from("fief_posts").update(patch).eq("id", postId);
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function moderateFiefComment(commentId: string, hidden: boolean): Promise<ActionResult<null>> {
  return toResult(async () => {
    const userId = await requireManager();
    const { error } = await createServiceClient()
      .from("fief_comments")
      .update({ hidden_at: hidden ? new Date().toISOString() : null, hidden_by: hidden ? userId : null })
      .eq("id", commentId);
    if (error) throw new Error(error.message);
    return null;
  });
}

export interface FiefReportRow {
  id: string;
  createdAt: string;
  reporter: string;
  reason: string | null;
  kind: "post" | "comment" | "message";
  targetId: string;
  /** Texte signalé (le message privé signalé n'est montré qu'ici). */
  excerpt: string;
  author: string;
  postId: string | null;
  hidden: boolean;
}

/** Signalements ouverts, avec le contenu signalé. */
export async function listFiefReports(): Promise<ActionResult<FiefReportRow[]>> {
  return toResult(async () => {
    await requireManager();
    const service = createServiceClient();
    const { data: reports, error } = await service.from("fief_reports").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const rows = reports ?? [];
    const postIds = rows.map((r) => r.post_id).filter((x): x is string => !!x);
    const commentIds = rows.map((r) => r.comment_id).filter((x): x is string => !!x);
    const messageIds = rows.map((r) => r.message_id).filter((x): x is string => !!x);
    const [{ data: posts }, { data: comments }, { data: messages }] = await Promise.all([
      postIds.length ? service.from("fief_posts").select("id, author_id, as_team, body, hidden_at").in("id", postIds) : Promise.resolve({ data: [] }),
      commentIds.length ? service.from("fief_comments").select("id, post_id, author_id, as_team, body, hidden_at").in("id", commentIds) : Promise.resolve({ data: [] }),
      messageIds.length ? service.from("fief_messages").select("id, sender_id, body").in("id", messageIds) : Promise.resolve({ data: [] }),
    ]);
    const people = new Set<string>(rows.map((r) => r.reporter_id));
    for (const p of posts ?? []) people.add(p.author_id);
    for (const c of comments ?? []) people.add(c.author_id);
    for (const m of messages ?? []) people.add(m.sender_id);
    const { data: members } = await service.from("fief_members").select("user_id, first_name, last_name").in("user_id", [...people]);
    const name = (id: string, team = false) => {
      if (team) return "Équipe FIEF";
      const m = (members ?? []).find((x) => x.user_id === id);
      return m ? `${m.first_name} ${m.last_name}` : "Équipe FIEF";
    };
    return rows.map((r) => {
      const post = (posts ?? []).find((p) => p.id === r.post_id);
      const comment = (comments ?? []).find((c) => c.id === r.comment_id);
      const message = (messages ?? []).find((m) => m.id === r.message_id);
      const kind: FiefReportRow["kind"] = r.post_id ? "post" : r.comment_id ? "comment" : "message";
      return {
        id: r.id,
        createdAt: r.created_at,
        reporter: name(r.reporter_id),
        reason: r.reason,
        kind,
        targetId: (r.post_id ?? r.comment_id ?? r.message_id)!,
        excerpt: (post?.body ?? comment?.body ?? message?.body ?? "(contenu supprimé)").slice(0, 600),
        author: post ? name(post.author_id, post.as_team) : comment ? name(comment.author_id, comment.as_team) : message ? name(message.sender_id) : "—",
        postId: post?.id ?? comment?.post_id ?? null,
        hidden: !!(post?.hidden_at ?? comment?.hidden_at),
      };
    });
  });
}

export async function resolveFiefReport(reportId: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    const userId = await requireManager();
    const { error } = await createServiceClient()
      .from("fief_reports")
      .update({ status: "resolved", resolved_by: userId, resolved_at: new Date().toISOString() })
      .eq("id", reportId);
    if (error) throw new Error(error.message);
    return null;
  });
}
