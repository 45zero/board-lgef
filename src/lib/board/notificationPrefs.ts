import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Préférences de notification par application (profiles.notification_prefs,
// sql/2026-11-05_notification_prefs.sql), réglées par chacun dans Paramètres → Notifications :
// pour chaque catégorie, e-mail et/ou push. La notification du board est toujours créée ; seuls
// l'e-mail (cron notification-emails) et le push (notificationPush.ts) suivent ces choix, sous les
// interrupteurs généraux « Notifications par e-mail » / « push » (profiles.notify_email / notify_push).
// Les rappels d'événements gardent leur choix e-mail / push par rappel, la modération ses réglages.

export type NotificationCategory =
  | "discussions"
  | "team"
  | "publication"
  | "calendrier"
  | "couverture"
  | "comite"
  | "frais_a_valider"
  | "frais_decision"
  | "frais_refus"
  | "admin";

export type Channel = "email" | "push";
type Channels = { email: boolean; push: boolean };

export type NotificationPrefs = {
  channels?: Partial<Record<NotificationCategory, Partial<Channels>>>;
  /** « À valider » : au plus un e-mail / push toutes les 12 h (les suivants restent dans le board). */
  frais_a_valider_grouped?: boolean;
  frais_a_valider_last_push?: string;
  // Première version (5/11, quelques heures) : « instant » | « half_day » | « board » par catégorie Frais.
  frais_decision?: string;
  frais_refus?: string;
  frais_a_valider?: string;
};

/** Catégories affichées dans les Paramètres, dans l'ordre, avec les canaux par défaut (= comportement d'avant). */
export const NOTIFICATION_CATEGORIES: { key: NotificationCategory; title: string; subtitle: string; defaults: Channels; adminOnly?: boolean }[] = [
  { key: "discussions", title: "Discussions", subtitle: "Messages, mentions et messages directs", defaults: { email: true, push: true } },
  { key: "team", title: "Espace Team", subtitle: "Cartes assignées, commentaires, échéances", defaults: { email: true, push: true } },
  { key: "publication", title: "Publication", subtitle: "Médias à publier", defaults: { email: true, push: true } },
  { key: "calendrier", title: "Calendrier", subtitle: "Équipes, affectations, événements supprimés, inscriptions", defaults: { email: true, push: false } },
  { key: "couverture", title: "Captations", subtitle: "Demandes de couverture et réponses", defaults: { email: true, push: false } },
  { key: "comite", title: "Comité directeur", subtitle: "Invitations et présences", defaults: { email: true, push: false } },
  { key: "frais_a_valider", title: "Frais et factures à valider", subtitle: "Si vous validez pour votre équipe ou la GED", defaults: { email: true, push: true } },
  { key: "frais_decision", title: "Frais et factures validés, payés", subtitle: "Bonnes nouvelles, rien à faire", defaults: { email: true, push: false } },
  { key: "frais_refus", title: "Frais et factures refusés", subtitle: "À corriger et renvoyer", defaults: { email: true, push: false } },
  { key: "admin", title: "Administration", subtitle: "Demandes d'accès, signalements", defaults: { email: true, push: false }, adminOnly: true },
];

const TYPE_CATEGORY: Record<string, NotificationCategory> = {
  event_mentioned: "discussions",
  event_commented: "discussions",
  direct_message: "discussions",
  card_assigned: "team",
  card_commented: "team",
  card_mentioned: "team",
  card_due_soon: "team",
  board_shared: "team",
  publication_to_publish: "publication",
  event_deleted: "calendrier",
  event_team_added: "calendrier",
  assignment_created: "calendrier",
  assignment_updated: "calendrier",
  registration_response: "calendrier",
  coverage_request: "couverture",
  coverage_request_created: "couverture",
  coverage_approved: "couverture",
  coverage_denied: "couverture",
  coverage_assignment: "couverture",
  coverage_rejected: "couverture",
  coverage_accepted: "couverture",
  coverage_accepted_admin: "couverture",
  director_assignment: "comite",
  director_request: "comite",
  director_approved: "comite",
  director_denied: "comite",
  director_reassigned: "comite",
  director_invitation: "comite",
  director_accepted: "comite",
  director_declined: "comite",
  expense_submitted: "frais_a_valider",
  expense_approved: "frais_decision",
  expense_rejected: "frais_refus",
  account_request: "admin",
  account_request_approved: "admin",
  account_request_denied: "admin",
  support_ticket: "admin",
  support_resolved: "admin",
};

/**
 * Catégorie d'une notification. Les frais passent tous par le type « expense_to_validate »
 * (expenses.ts) : `data.kind` / `data.decision` disent s'il s'agit d'une validation à faire, d'une
 * décision ou d'un import de factures par e-mail.
 */
export function categoryOf(n: { type: string; data?: unknown }): NotificationCategory | null {
  const data = (n.data ?? {}) as { kind?: string; decision?: string };
  if (data.kind === "expense_mail_import") return "frais_decision";
  if (data.kind === "invoice_submitted") return "frais_a_valider";
  if (n.type === "expense_to_validate") {
    if (data.kind === "expense_reviewed") return data.decision === "rejected" ? "frais_refus" : "frais_decision";
    return "frais_a_valider";
  }
  return TYPE_CATEGORY[n.type] ?? null;
}

/** Canaux choisis pour une catégorie (défaut, puis première version des réglages Frais, puis choix explicite). */
export function channelsFor(prefs: NotificationPrefs | null | undefined, category: NotificationCategory): Channels {
  const def = NOTIFICATION_CATEGORIES.find((c) => c.key === category)?.defaults ?? { email: true, push: true };
  const legacy = category === "frais_decision" || category === "frais_refus" || category === "frais_a_valider" ? prefs?.[category] : undefined;
  const base = legacy === "board" ? { email: false, push: false } : def;
  return { ...base, ...(prefs?.channels?.[category] ?? {}) };
}

/** Faut-il envoyer par ce canal ? Hors catégorie (rappels, modération…) : oui, les réglages propres s'appliquent ailleurs. */
export function wantsChannel(prefs: NotificationPrefs | null | undefined, n: { type: string; data?: unknown }, channel: Channel): boolean {
  if ((n.data as { quiet?: boolean } | null)?.quiet) return false;
  const category = categoryOf(n);
  return category ? channelsFor(prefs, category)[channel] : true;
}

export const isGrouped = (prefs: NotificationPrefs | null | undefined) => prefs?.frais_a_valider_grouped ?? prefs?.frais_a_valider === "half_day";

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * « À valider » regroupé : la notification doit-elle rester discrète (board seulement) ? Oui si un
 * rappel est déjà parti il y a moins de 12 h ; sinon celui-ci part et on note l'heure.
 */
export async function quietAValider(service: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data } = await service.from("profiles").select("notification_prefs").eq("id", userId).maybeSingle();
  const prefs = (data?.notification_prefs ?? {}) as NotificationPrefs;
  if (!isGrouped(prefs)) return false;
  const last = prefs.frais_a_valider_last_push ? new Date(prefs.frais_a_valider_last_push).getTime() : 0;
  if (Date.now() - last < HALF_DAY_MS) return true;
  await service
    .from("profiles")
    .update({ notification_prefs: { ...prefs, frais_a_valider_last_push: new Date().toISOString() } })
    .eq("id", userId);
  return false;
}

/** Choix d'une personne pour un canal (e-mail détaillé envoyé directement, hors cron). */
export async function userWants(service: SupabaseClient<Database>, userId: string, n: { type: string; data?: unknown }, channel: Channel): Promise<boolean> {
  const { data } = await service.from("profiles").select("notification_prefs, notify_email, notify_push").eq("id", userId).maybeSingle();
  if (channel === "email" && data?.notify_email === false) return false;
  if (channel === "push" && data?.notify_push === false) return false;
  return wantsChannel((data?.notification_prefs ?? {}) as NotificationPrefs, n, channel);
}
