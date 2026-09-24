"use server";

import { createServiceClient } from "@/lib/supabase/serviceClient";

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

  return { campaign, recipient, event };
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

  return { campaign, event };
}

/** Réponse via le lien générique — crée le destinataire à la volée à partir de ce qu'il renseigne. */
export async function submitPublicResponse(
  campaignId: string,
  params: { name: string; club?: string; email?: string; response: "yes" | "no" }
) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("event_registration_recipients").insert({
    campaign_id: campaignId,
    name: params.name,
    club: params.club || null,
    email: params.email || null,
    source: "public_link",
    response: params.response,
    responded_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function submitRegistrationResponse(token: string, response: "yes" | "no") {
  const supabase = createServiceClient();
  const { data: recipient } = await supabase
    .from("event_registration_recipients")
    .select("id")
    .eq("token", token)
    .maybeSingle();
  if (!recipient) throw new Error("Lien invalide ou expiré.");

  const { error } = await supabase
    .from("event_registration_recipients")
    .update({ response, responded_at: new Date().toISOString() })
    .eq("id", recipient.id);
  if (error) throw new Error(error.message);
}
