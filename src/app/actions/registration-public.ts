"use server";

import { createServiceClient } from "@/lib/supabase/serviceClient";
import { renderCampaignCardHtml, formatEventDateLabel, greetingFor, type EmailBlock } from "@/lib/board/registrationEmail";
import { greetingName } from "@/lib/board/clubContacts";

/** Nombre de personnes saisi sur la page publique — borné 1–99 (contrainte en base), 1 par défaut. */
function cleanAttendees(n: number | null | undefined) {
  return Number.isInteger(n) && n! >= 1 && n! <= 99 ? n! : 1;
}

type ClubRef = { club: string | null; club_number: string | null };

function normalizeClub(name: string | null | undefined) {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Même club = même numéro d'affiliation, sinon même nom (accents/casse/ponctuation ignorés). */
function sameClub(a: ClubRef, b: ClubRef) {
  if (a.club_number && b.club_number) return a.club_number === b.club_number;
  const na = normalizeClub(a.club);
  return !!na && na === normalizeClub(b.club);
}

/**
 * Places encore disponibles pour un club quand la campagne a un plafond par club
 * (`max_attendees_per_club`, ex. AG : 2) — somme des « oui » des autres destinataires du même club.
 * `null` = campagne sans plafond.
 */
async function remainingForClub(campaignId: string, club: ClubRef, excludeRecipientId?: string) {
  const supabase = createServiceClient();
  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("max_attendees_per_club")
    .eq("id", campaignId)
    .maybeSingle();
  const cap = campaign?.max_attendees_per_club ?? null;
  if (!cap) return null;
  if (!club.club && !club.club_number) return { cap, remaining: cap };

  const { data: yes } = await supabase
    .from("event_registration_recipients")
    .select("id, club, club_number, attendees")
    .eq("campaign_id", campaignId)
    .eq("response", "yes");
  const used = (yes ?? [])
    .filter((r) => r.id !== excludeRecipientId && sameClub(r, club))
    .reduce((sum, r) => sum + (r.attendees ?? 1), 0);
  return { cap, remaining: Math.max(0, cap - used) };
}

function capError(cap: number, remaining: number) {
  const max = `${cap} personne${cap > 1 ? "s" : ""} maximum par club`;
  return remaining === 0
    ? `Inscriptions limitées à ${max} : votre club a déjà atteint ce nombre.`
    : `Inscriptions limitées à ${max} : il reste ${remaining} place${remaining > 1 ? "s" : ""} pour votre club.`;
}

/** Rendu de la carte visuelle de la campagne — même forme que le mail, sans le bloc boutons (remplacé par les vrais boutons interactifs de la page). */
function buildCardHtml(
  campaign: { blocks: unknown },
  event: { title: string; start_date: string; location: string | null },
  greeting?: string | null
) {
  const eventDateLabel = formatEventDateLabel(event.start_date);
  return renderCampaignCardHtml(
    {
      eventTitle: event.title,
      eventDateLabel,
      eventLocation: event.location,
      logoUrl: "/lgef-logo.png",
      blocks: (campaign.blocks as unknown as EmailBlock[]) ?? [],
      mapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null,
      yesUrl: "#",
      noUrl: "#",
      greeting,
    },
    { includeButtons: false }
  );
}

/** Contexte public (aucune session requise) pour la page de réponse — accès par jeton uniquement. */
export async function getRegistrationContext(eventId: string, token: string) {
  const supabase = createServiceClient();

  const { data: recipient } = await supabase
    .from("event_registration_recipients")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (!recipient) return null;

  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("*")
    .eq("id", recipient.campaign_id)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!campaign) return null;

  const { data: event } = await supabase
    .from("events")
    .select("title, start_date, location")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;

  const clubLimit = await remainingForClub(campaign.id, recipient, recipient.id);
  return {
    campaign,
    recipient,
    event,
    clubLimit,
    cardHtml: buildCardHtml(campaign, event, greetingFor(greetingName(recipient))),
  };
}

/** Événement d'un destinataire à partir de son seul jeton (lien court WhatsApp). */
export async function resolveRecipientEventId(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const supabase = createServiceClient();
  const { data: recipient } = await supabase
    .from("event_registration_recipients")
    .select("campaign_id")
    .eq("token", token)
    .maybeSingle();
  if (!recipient) return null;
  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("event_id")
    .eq("id", recipient.campaign_id)
    .maybeSingle();
  return (campaign?.event_id as string | undefined) ?? null;
}

/** Contexte pour le lien générique (QR code / copié-collé) — pas de destinataire connu à l'avance. */
export async function getPublicCampaignContext(eventId: string, publicToken: string) {
  const supabase = createServiceClient();
  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("*")
    .eq("event_id", eventId)
    .eq("public_token", publicToken)
    .maybeSingle();
  if (!campaign) return null;

  const { data: event } = await supabase
    .from("events")
    .select("title, start_date, location")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;

  return { campaign, event, cardHtml: buildCardHtml(campaign, event) };
}

/**
 * Lien personnel devenu invalide (destinataire retiré de la liste) : lien générique de la
 * campagne de l'événement, pour que la personne puisse quand même répondre.
 */
export async function getPublicLinkForEvent(eventId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const supabase = createServiceClient();
  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("public_token")
    .eq("event_id", eventId)
    .maybeSingle();
  return campaign?.public_token ? `/inscription/${eventId}/public/${campaign.public_token}` : null;
}

/**
 * Notification in-app (cloche du board, en direct) à l'organisateur de la campagne quand
 * quelqu'un répond. Au mieux : un échec ne doit jamais empêcher la réponse d'être enregistrée.
 */
async function notifyOrganizer(campaignId: string, who: string, response: "yes" | "no") {
  try {
    const supabase = createServiceClient();
    const { data: campaign } = await supabase.from("event_registration_campaigns").select("created_by, event_id").eq("id", campaignId).maybeSingle();
    if (!campaign?.created_by) return;
    const { data: event } = await supabase.from("events").select("title").eq("id", campaign.event_id).maybeSingle();
    await supabase.from("notifications").insert({
      user_id: campaign.created_by,
      type: "registration_response",
      title: response === "yes" ? "Nouvelle inscription" : "Réponse négative",
      message: `${who || "Un invité"} ${response === "yes" ? "participera" : "ne participera pas"} à « ${event?.title ?? "l'événement"} ».`,
      event_id: campaign.event_id,
      data: { event_id: campaign.event_id, campaign_id: campaignId, response },
    });
  } catch (e) {
    console.error("[notifyOrganizer]", e);
  }
}

/**
 * Réponse via le lien générique — crée le destinataire à la volée à partir de ce qu'il renseigne.
 * Renvoie `{ error }` plutôt que de lever (Next masque le texte des erreurs serveur en production).
 */
export async function submitPublicResponse(
  campaignId: string,
  params: { firstName: string; lastName: string; club?: string; email?: string; response: "yes" | "no"; attendees?: number | null }
): Promise<{ error: string | null }> {
  const supabase = createServiceClient();
  if (params.response === "yes") {
    const limit = await remainingForClub(campaignId, { club: params.club || null, club_number: null });
    if (limit && cleanAttendees(params.attendees) > limit.remaining) return { error: capError(limit.cap, limit.remaining) };
  }
  const { error } = await supabase.from("event_registration_recipients").insert({
    campaign_id: campaignId,
    first_name: params.firstName || null,
    last_name: params.lastName || null,
    name: [params.firstName, params.lastName].filter(Boolean).join(" "),
    club: params.club || null,
    email: params.email || null,
    source: "public_link",
    response: params.response,
    attendees: params.response === "yes" ? cleanAttendees(params.attendees) : null,
    responded_at: new Date().toISOString(),
  });
  if (error) return { error: "Échec de l'enregistrement, merci de réessayer." };
  await notifyOrganizer(campaignId, [params.firstName, params.lastName].filter(Boolean).join(" "), params.response);
  return { error: null };
}

export async function submitRegistrationResponse(
  token: string,
  response: "yes" | "no",
  attendees?: number | null
): Promise<{ error: string | null }> {
  const supabase = createServiceClient();
  const { data: recipient } = await supabase
    .from("event_registration_recipients")
    .select("id, campaign_id, name, first_name, last_name, club, club_number")
    .eq("token", token)
    .maybeSingle();
  if (!recipient) return { error: "Lien invalide ou expiré." };

  if (response === "yes" && recipient.campaign_id) {
    const limit = await remainingForClub(recipient.campaign_id, recipient, recipient.id);
    if (limit && cleanAttendees(attendees) > limit.remaining) return { error: capError(limit.cap, limit.remaining) };
  }

  const { error } = await supabase
    .from("event_registration_recipients")
    .update({
      response,
      attendees: response === "yes" ? cleanAttendees(attendees) : null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", recipient.id);
  if (error) return { error: "Échec de l'enregistrement, merci de réessayer." };
  const who = recipient.name || [recipient.first_name, recipient.last_name].filter(Boolean).join(" ");
  if (recipient.campaign_id) await notifyOrganizer(recipient.campaign_id, who, response);
  return { error: null };
}
