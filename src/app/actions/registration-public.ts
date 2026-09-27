"use server";

import { createServiceClient } from "@/lib/supabase/serviceClient";
import { renderCampaignCardHtml, formatEventDateLabel, greetingFor, type EmailBlock } from "@/lib/board/registrationEmail";
import { personName } from "@/lib/board/clubContacts";

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

  return { campaign, recipient, event, cardHtml: buildCardHtml(campaign, event, greetingFor(personName(recipient))) };
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

/** Réponse via le lien générique — crée le destinataire à la volée à partir de ce qu'il renseigne. */
export async function submitPublicResponse(
  campaignId: string,
  params: { firstName: string; lastName: string; club?: string; email?: string; response: "yes" | "no" }
) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("event_registration_recipients").insert({
    campaign_id: campaignId,
    first_name: params.firstName || null,
    last_name: params.lastName || null,
    name: [params.firstName, params.lastName].filter(Boolean).join(" "),
    club: params.club || null,
    email: params.email || null,
    source: "public_link",
    response: params.response,
    responded_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await notifyOrganizer(campaignId, [params.firstName, params.lastName].filter(Boolean).join(" "), params.response);
}

export async function submitRegistrationResponse(token: string, response: "yes" | "no") {
  const supabase = createServiceClient();
  const { data: recipient } = await supabase
    .from("event_registration_recipients")
    .select("id, campaign_id, name, first_name, last_name")
    .eq("token", token)
    .maybeSingle();
  if (!recipient) throw new Error("Lien invalide ou expiré.");

  const { error } = await supabase
    .from("event_registration_recipients")
    .update({ response, responded_at: new Date().toISOString() })
    .eq("id", recipient.id);
  if (error) throw new Error(error.message);
  const who = recipient.name || [recipient.first_name, recipient.last_name].filter(Boolean).join(" ");
  if (recipient.campaign_id) await notifyOrganizer(recipient.campaign_id, who, response);
}
