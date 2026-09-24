"use server";

import { createClient } from "@/lib/supabase/server";
import { listConnectedAccounts, getGoogleAccountById } from "@/lib/google/accounts";
import { getBoardDriveAccountId } from "@/app/actions/board-settings";
import { sendMessage } from "@/lib/google/gmail";
import { buildRegistrationEmailHtml } from "@/lib/board/registrationEmail";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

async function requireStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const [{ data: profile }, { data: specialty }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).single(),
    supabase
      .from("profile_specialties")
      .select("specialties!inner(slug)")
      .eq("user_id", user.id)
      .eq("specialties.slug", "tech-salarie")
      .maybeSingle(),
  ]);
  const role = profile?.role;
  const allowed = role === "admin" || role === "super_user" || !!specialty;
  if (!allowed) throw new Error("Réservé aux administrateurs et au réseau salarié.");
  return { supabase, userId: user.id };
}

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "";
}

export async function listRegistrationEvents() {
  const { supabase } = await requireStaff();
  const { data: events, error } = await supabase
    .from("events")
    .select("id, title, start_date, location")
    .eq("registration_enabled", true)
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  if (!events || events.length === 0) return [];

  const { data: campaigns } = await supabase
    .from("event_registration_campaigns")
    .select("id, event_id, status")
    .in(
      "event_id",
      events.map((e) => e.id)
    );

  const campaignByEvent = new Map((campaigns ?? []).map((c) => [c.event_id, c]));
  const campaignIds = (campaigns ?? []).map((c) => c.id);

  const { data: recipients } = campaignIds.length
    ? await supabase.from("event_registration_recipients").select("campaign_id, response").in("campaign_id", campaignIds)
    : { data: [] as { campaign_id: string; response: string | null }[] };

  return events.map((ev) => {
    const campaign = campaignByEvent.get(ev.id);
    const rows = (recipients ?? []).filter((r) => r.campaign_id === campaign?.id);
    return {
      ...ev,
      campaignId: campaign?.id ?? null,
      campaignStatus: campaign?.status ?? "draft",
      totalRecipients: rows.length,
      yesCount: rows.filter((r) => r.response === "yes").length,
      noCount: rows.filter((r) => r.response === "no").length,
    };
  });
}

export async function getOrCreateCampaign(eventId: string) {
  const { supabase, userId } = await requireStaff();
  const { data: existing } = await supabase
    .from("event_registration_campaigns")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("event_registration_campaigns")
    .insert({ event_id: eventId, created_by: userId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return created;
}

export async function updateCampaign(
  campaignId: string,
  patch: {
    subject?: string;
    message?: string;
    image_url?: string | null;
    video_url?: string | null;
    links?: { label: string; url: string }[];
  }
) {
  const { supabase } = await requireStaff();
  const { error } = await supabase
    .from("event_registration_campaigns")
    .update({ ...patch, links: patch.links as never, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (error) throw new Error(error.message);
}

export async function listCampaignRecipients(campaignId: string) {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("event_registration_recipients")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

export async function searchClubContacts(query: string) {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("quiz_annuaire_contacts")
    .select("id, name, email, club")
    .not("email", "is", null)
    .ilike("club", `%${query}%`)
    .limit(30);
  if (error) throw new Error(error.message);
  return data;
}

export async function addRecipientsFromContacts(
  campaignId: string,
  contacts: { id: string; name: string; email: string; club: string | null }[]
) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("event_registration_recipients").insert(
    contacts.map((c) => ({
      campaign_id: campaignId,
      contact_id: c.id,
      name: c.name,
      email: c.email,
      club: c.club,
      source: "invited" as const,
    }))
  );
  if (error) throw new Error(error.message);
}

export async function addManualRecipient(campaignId: string, params: { name: string; email: string; club?: string }) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("event_registration_recipients").insert({
    campaign_id: campaignId,
    name: params.name,
    email: params.email,
    club: params.club ?? null,
    source: "invited",
  });
  if (error) throw new Error(error.message);
}

export async function removeRecipient(recipientId: string) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("event_registration_recipients").delete().eq("id", recipientId);
  if (error) throw new Error(error.message);
}

/** Envoie l'email d'invitation (via le compte Google du board) à tous les destinataires pas encore envoyés. */
export async function sendCampaign(campaignId: string) {
  const { supabase, userId } = await requireStaff();

  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("*, events(title, start_date, location)")
    .eq("id", campaignId)
    .single();
  if (!campaign) throw new Error("Campagne introuvable.");

  const { data: recipients } = await supabase
    .from("event_registration_recipients")
    .select("*")
    .eq("campaign_id", campaignId)
    .is("sent_at", null);
  if (!recipients || recipients.length === 0) return { sent: 0 };

  const boardAccountId = await getBoardDriveAccountId();
  let account = boardAccountId ? await getGoogleAccountById(boardAccountId) : null;
  if (!account) {
    const accounts = await listConnectedAccounts(userId);
    account = accounts.find((a) => a.provider === "google") ?? null;
  }
  if (!account) throw new Error("Aucun compte Google connecté pour envoyer les emails (Paramètres du board → Drive du board).");

  const event = campaign.events as unknown as { title: string; start_date: string; location: string | null } | null;
  const eventTitle = event?.title ?? "Événement";
  const eventDateLabel = event?.start_date
    ? format(new Date(event.start_date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })
    : "";

  let sent = 0;
  for (const r of recipients) {
    if (!r.email) continue;
    const yesUrl = `${siteUrl()}/inscription/${campaign.event_id}/${r.token}?r=yes`;
    const noUrl = `${siteUrl()}/inscription/${campaign.event_id}/${r.token}?r=no`;
    const html = buildRegistrationEmailHtml({
      eventTitle,
      eventDateLabel,
      eventLocation: event?.location ?? null,
      message: campaign.message || "Vous êtes invité(e) à cet événement.",
      imageUrl: campaign.image_url,
      videoUrl: campaign.video_url,
      links: (campaign.links as unknown as { label: string; url: string }[]) ?? [],
      yesUrl,
      noUrl,
    });
    try {
      await sendMessage(account, {
        to: r.email,
        subject: campaign.subject || `Invitation — ${eventTitle}`,
        body: `${campaign.message || "Vous êtes invité(e) à cet événement."}\n\nJe participe : ${yesUrl}\nJe n'y participerai pas : ${noUrl}`,
        html,
      });
      await supabase.from("event_registration_recipients").update({ sent_at: new Date().toISOString() }).eq("id", r.id);
      sent += 1;
    } catch (e) {
      console.error("[sendCampaign] échec envoi à", r.email, e);
    }
  }

  await supabase.from("event_registration_campaigns").update({ status: "sent" }).eq("id", campaignId);
  return { sent };
}
