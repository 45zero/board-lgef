"use server";

import { createClient } from "@/lib/supabase/server";
import { listConnectedAccounts, getGoogleAccountById } from "@/lib/google/accounts";
import { getBoardDriveAccountId } from "@/app/actions/board-settings";
import { sendMessage } from "@/lib/google/gmail";
import { findOrCreateFolder, createResumableUploadSession, ensurePublicViewAccess } from "@/lib/google/drive";
import {
  buildRegistrationEmailHtml,
  renderCampaignCardHtml,
  formatEventDateLabel,
  greetingFor,
  type EmailBlock,
} from "@/lib/board/registrationEmail";
import { personName, normalizeFrPhone, type ClubContact } from "@/lib/board/clubContacts";
import { isResendConfigured, sendResendBatch } from "@/lib/email/resend";
import { isWhatsAppConfigured, sendWhatsAppEventInvite } from "@/lib/whatsapp";
import type { Json } from "@/lib/supabase/database.types";

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
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
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

export async function updateCampaign(campaignId: string, patch: { subject?: string }) {
  const { supabase } = await requireStaff();
  const { error } = await supabase
    .from("event_registration_campaigns")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (error) throw new Error(error.message);
}

async function updateBlocks(campaignId: string, updater: (blocks: EmailBlock[]) => EmailBlock[]) {
  const { supabase } = await requireStaff();
  const { data: current } = await supabase.from("event_registration_campaigns").select("blocks").eq("id", campaignId).single();
  const blocks = ((current?.blocks as unknown as EmailBlock[]) ?? []).slice();
  const next = updater(blocks);
  const { error } = await supabase
    .from("event_registration_campaigns")
    .update({ blocks: next as unknown as Json, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (error) throw new Error(error.message);
  return next;
}

export async function addCampaignBlock(campaignId: string, block: EmailBlock) {
  return updateBlocks(campaignId, (blocks) => [...blocks, block]);
}

export async function removeCampaignBlock(campaignId: string, blockId: string) {
  return updateBlocks(campaignId, (blocks) => blocks.filter((b) => b.id !== blockId));
}

export async function moveCampaignBlock(campaignId: string, blockId: string, direction: "up" | "down") {
  return updateBlocks(campaignId, (blocks) => {
    const idx = blocks.findIndex((b) => b.id === blockId);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapWith < 0 || swapWith >= blocks.length) return blocks;
    const next = [...blocks];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    return next;
  });
}

export async function updateCampaignBlockContent(campaignId: string, blockId: string, patch: Record<string, unknown>) {
  return updateBlocks(campaignId, (blocks) => blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch } as EmailBlock) : b)));
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

/** Ajout manuel : un email ou un mobile suffit (mobile seul = invitation WhatsApp uniquement). */
export async function addManualRecipient(
  campaignId: string,
  params: { name: string; email?: string; phone?: string; club?: string }
) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("event_registration_recipients").insert({
    campaign_id: campaignId,
    name: params.name,
    email: params.email?.toLowerCase() || null,
    phone: normalizeFrPhone(params.phone),
    club: params.club || null,
    source: "invited",
  });
  if (error) throw new Error(error.message);
}

/** Annuaires réutilisables — créés une fois, réimportables dans n'importe quelle campagne. */
export async function listContactLists() {
  const { supabase } = await requireStaff();
  const { data: lists, error } = await supabase
    .from("registration_contact_lists")
    .select("id, name, created_at")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  if (!lists || lists.length === 0) return [];

  const { data: members } = await supabase
    .from("registration_contact_list_members")
    .select("list_id")
    .in(
      "list_id",
      lists.map((l) => l.id)
    );
  const counts = new Map<string, number>();
  for (const m of members ?? []) counts.set(m.list_id, (counts.get(m.list_id) ?? 0) + 1);

  return lists.map((l) => ({ ...l, memberCount: counts.get(l.id) ?? 0 }));
}

export async function createContactList(name: string) {
  const { supabase, userId } = await requireStaff();
  const { data, error } = await supabase
    .from("registration_contact_lists")
    .insert({ name, created_by: userId })
    .select("id, name, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteContactList(listId: string) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("registration_contact_lists").delete().eq("id", listId);
  if (error) throw new Error(error.message);
}

export async function listContactListMembers(listId: string) {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("registration_contact_list_members")
    .select("*")
    .eq("list_id", listId)
    .order("club", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

export async function addContactListMember(
  listId: string,
  params: { name: string; email?: string | null; phone?: string; club?: string }
) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("registration_contact_list_members").insert({
    list_id: listId,
    name: params.name,
    email: params.email?.toLowerCase() || null,
    phone: normalizeFrPhone(params.phone),
    club: params.club || null,
  });
  if (error) throw new Error(error.message);
}

export async function removeContactListMember(memberId: string) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("registration_contact_list_members").delete().eq("id", memberId);
  if (error) throw new Error(error.message);
}

/**
 * Import de l'export clubs (Excel lu côté navigateur, envoyé par lots). Un club déjà présent dans l'annuaire
 * (même numéro de club, à défaut même email) est remplacé par la ligne importée — réimporter l'export met à jour.
 */
export async function importClubContactsIntoList(listId: string, contacts: ClubContact[]) {
  const { supabase } = await requireStaff();
  if (contacts.length === 0) return { added: 0 };
  if (contacts.length > 1000) throw new Error("Lot trop volumineux.");

  const clubNumbers = contacts.map((c) => c.clubNumber).filter((n): n is string => !!n);
  if (clubNumbers.length > 0) {
    const { error } = await supabase
      .from("registration_contact_list_members")
      .delete()
      .eq("list_id", listId)
      .in("club_number", clubNumbers);
    if (error) throw new Error(error.message);
  }
  const emailsWithoutNumber = contacts.filter((c) => !c.clubNumber).map((c) => c.email);
  if (emailsWithoutNumber.length > 0) {
    const { error } = await supabase
      .from("registration_contact_list_members")
      .delete()
      .eq("list_id", listId)
      .in("email", emailsWithoutNumber);
    if (error) throw new Error(error.message);
  }

  const { error } = await supabase.from("registration_contact_list_members").insert(
    contacts.map((c) => ({
      list_id: listId,
      name: personName({ first_name: c.firstName, last_name: c.lastName }) || c.club || c.email,
      email: c.email,
      email_secondary: c.emailSecondary,
      club: c.club,
      club_number: c.clubNumber,
      civility: c.civility,
      first_name: c.firstName,
      last_name: c.lastName,
      phone: c.phone,
    }))
  );
  if (error) throw new Error(error.message);
  return { added: contacts.length };
}

/** Importe tous les membres d'un annuaire comme destinataires de la campagne (copie ponctuelle, pas un lien synchronisé). */
export async function importContactListIntoCampaign(campaignId: string, listId: string) {
  const { supabase } = await requireStaff();
  const { data: members, error: membersError } = await supabase
    .from("registration_contact_list_members")
    .select("name, email, email_secondary, club, club_number, civility, first_name, last_name, phone")
    .eq("list_id", listId);
  if (membersError) throw new Error(membersError.message);
  if (!members || members.length === 0) return { added: 0 };

  const { data: existing } = await supabase
    .from("event_registration_recipients")
    .select("email, phone")
    .eq("campaign_id", campaignId);
  const existingEmails = new Set((existing ?? []).map((e) => e.email).filter(Boolean));
  const existingPhones = new Set((existing ?? []).map((e) => e.phone).filter(Boolean));
  // Membre déjà destinataire = même email, ou même mobile pour un contact sans email.
  const toInsert = members.filter((m) =>
    m.email ? !existingEmails.has(m.email) : !(m.phone && existingPhones.has(m.phone))
  );
  if (toInsert.length === 0) return { added: 0 };

  const { error } = await supabase.from("event_registration_recipients").insert(
    toInsert.map((m) => ({
      campaign_id: campaignId,
      name: m.name,
      email: m.email,
      email_secondary: m.email_secondary,
      club: m.club,
      club_number: m.club_number,
      civility: m.civility,
      first_name: m.first_name,
      last_name: m.last_name,
      phone: m.phone,
      source: "invited" as const,
    }))
  );
  if (error) throw new Error(error.message);
  return { added: toInsert.length };
}

export async function removeRecipient(recipientId: string) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("event_registration_recipients").delete().eq("id", recipientId);
  if (error) throw new Error(error.message);
}

/** Envoie l'email d'invitation (via le compte Google du board) à tous les destinataires pas encore envoyés. */
/** Rendu HTML de la campagne — identique à ce qui part réellement, avec des liens de réponse factices (pour l'aperçu). */
export async function previewCampaignHtml(campaignId: string) {
  const { supabase } = await requireStaff();
  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("*, events(title, start_date, location)")
    .eq("id", campaignId)
    .single();
  if (!campaign) throw new Error("Campagne introuvable.");

  const event = campaign.events as unknown as { title: string; start_date: string; location: string | null } | null;
  const eventTitle = event?.title ?? "Événement";
  const eventDateLabel = formatEventDateLabel(event?.start_date);

  return buildRegistrationEmailHtml({
    eventTitle,
    eventDateLabel,
    eventLocation: event?.location ?? null,
    logoUrl: `${siteUrl()}/lgef-logo.png`,
    blocks: (campaign.blocks as unknown as EmailBlock[]) ?? [],
    mapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null,
    yesUrl: "#",
    noUrl: "#",
    greeting: greetingFor("Prénom Nom"),
  });
}

/** Rendu HTML de la carte de campagne seule (mêmes blocs, même mise en forme que l'aperçu), boutons pointant vers le lien générique — pour la balise à coller dans un autre outil de mail. */
export async function getCampaignEmbedHtml(campaignId: string) {
  const { supabase } = await requireStaff();
  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("*, events(title, start_date, location)")
    .eq("id", campaignId)
    .single();
  if (!campaign) throw new Error("Campagne introuvable.");

  const event = campaign.events as unknown as { title: string; start_date: string; location: string | null } | null;
  const eventTitle = event?.title ?? "Événement";
  const eventDateLabel = formatEventDateLabel(event?.start_date);
  const publicUrl = `${siteUrl()}/inscription/${campaign.event_id}/public/${campaign.public_token}`;

  return renderCampaignCardHtml({
    eventTitle,
    eventDateLabel,
    eventLocation: event?.location ?? null,
    logoUrl: `${siteUrl()}/lgef-logo.png`,
    blocks: (campaign.blocks as unknown as EmailBlock[]) ?? [],
    mapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null,
    yesUrl: `${publicUrl}?r=yes`,
    noUrl: `${publicUrl}?r=no`,
  });
}

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
  if (!recipients || recipients.length === 0) return { sent: 0, error: null as string | null };

  const event = campaign.events as unknown as { title: string; start_date: string; location: string | null } | null;
  const eventTitle = event?.title ?? "Événement";
  const eventDateLabel = formatEventDateLabel(event?.start_date);

  const blocks = (campaign.blocks as unknown as EmailBlock[]) ?? [];
  const firstText = blocks.find((b): b is Extract<EmailBlock, { type: "text" }> => b.type === "text");
  const plainFallback = firstText?.content || "Vous êtes invité(e) à cet événement.";
  const subject = campaign.subject || `Invitation — ${eventTitle}`;

  // Un mail personnalisé par destinataire : « Bonjour Prénom Nom, », liens de réponse propres, email club + email perso.
  const withEmail = recipients.filter((r) => !!r.email);
  const messages = withEmail.map((r) => {
    const yesUrl = `${siteUrl()}/inscription/${campaign.event_id}/${r.token}?r=yes`;
    const noUrl = `${siteUrl()}/inscription/${campaign.event_id}/${r.token}?r=no`;
    const greeting = greetingFor(personName(r));
    const html = buildRegistrationEmailHtml({
      eventTitle,
      eventDateLabel,
      eventLocation: event?.location ?? null,
      logoUrl: `${siteUrl()}/lgef-logo.png`,
      blocks,
      mapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null,
      yesUrl,
      noUrl,
      greeting,
    });
    return {
      to: [r.email!, r.email_secondary].filter((e): e is string => !!e && e !== ""),
      subject,
      html,
      text: `${greeting}\n\n${plainFallback}\n\nJe participe : ${yesUrl}\nJe n'y participerai pas : ${noUrl}`,
    };
  });

  const markSent = async (ids: string[]) => {
    if (ids.length === 0) return;
    await supabase
      .from("event_registration_recipients")
      .update({ sent_at: new Date().toISOString() })
      .in("id", ids);
  };

  let sent = 0;
  if (isResendConfigured()) {
    // Resend (domaine lgef.fr) : envoi par lots, pas de quota Gmail — les réponses « Répondre » arrivent chez l'expéditeur du board.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const result = await sendResendBatch(
      messages.map((m) => ({ ...m, replyTo: user?.email ?? null })),
      (indexes) => markSent(indexes.map((i) => withEmail[i].id))
    );
    sent = result.sent;
    if (sent === 0 && result.errors.length > 0) return { sent, error: `Échec de l'envoi : ${result.errors[0]}` };
  } else {
    const boardAccountId = await getBoardDriveAccountId();
    let account = boardAccountId ? await getGoogleAccountById(boardAccountId) : null;
    if (!account) {
      const accounts = await listConnectedAccounts(userId);
      account = accounts.find((a) => a.provider === "google") ?? null;
    }
    if (!account) return { sent, error: "Aucun compte Google connecté pour envoyer les emails (Paramètres du board → Drive du board)." };

    for (const [i, m] of messages.entries()) {
      try {
        await sendMessage(account, { to: m.to.join(", "), subject: m.subject, body: m.text, html: m.html });
        await markSent([withEmail[i].id]);
        sent += 1;
      } catch (e) {
        console.error("[sendCampaign] échec envoi à", m.to, e);
      }
    }
  }

  await supabase.from("event_registration_campaigns").update({ status: "sent" }).eq("id", campaignId);
  return { sent, error: null };
}

/** Invitations WhatsApp (API Meta, modèle approuvé) à tous les destinataires avec un mobile, pas encore invités par WhatsApp. */
export async function sendCampaignWhatsApp(campaignId: string) {
  const { supabase } = await requireStaff();
  // Messages renvoyés plutôt que levés : en production Next masque le texte des erreurs serveur (500 générique).
  if (!isWhatsAppConfigured()) {
    return {
      sent: 0,
      failed: 0,
      firstError: "WhatsApp pas encore activé : le modèle d'invitation doit être validé par Meta (META_WHATSAPP_TEMPLATE_INVITATION).",
    };
  }

  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("event_id, events(title, start_date)")
    .eq("id", campaignId)
    .single();
  if (!campaign) throw new Error("Campagne introuvable.");
  const event = campaign.events as unknown as { title: string; start_date: string } | null;

  const { data: recipients } = await supabase
    .from("event_registration_recipients")
    .select("id, token, first_name, last_name, name, phone")
    .eq("campaign_id", campaignId)
    .like("phone", "+%")
    .is("whatsapp_sent_at", null);
  if (!recipients || recipients.length === 0) return { sent: 0, failed: 0, firstError: null as string | null };

  let sent = 0;
  let failed = 0;
  let firstError: string | null = null;
  const CONCURRENCY = 10;
  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    await Promise.all(
      recipients.slice(i, i + CONCURRENCY).map(async (r) => {
        const result = await sendWhatsAppEventInvite({
          to: r.phone!,
          firstName: personName({ first_name: r.first_name }) || null,
          lastName: personName({ last_name: r.last_name }) || (r.first_name ? null : r.name),
          eventTitle: event?.title ?? "Événement",
          eventDateLabel: formatEventDateLabel(event?.start_date),
          linkSuffix: `${campaign.event_id}/${r.token}`,
        });
        if (result.ok) {
          sent += 1;
          await supabase
            .from("event_registration_recipients")
            .update({ whatsapp_sent_at: new Date().toISOString() })
            .eq("id", r.id);
        } else {
          failed += 1;
          firstError ??= result.error;
        }
      })
    );
  }
  return { sent, failed, firstError };
}

/** Drive du board, sinon le compte Google de l'utilisateur (même repli que l'envoi) — le Drive du board est désaffecté quand son compte est déconnecté. */
async function requireBoardAccount(userId: string) {
  const boardAccountId = await getBoardDriveAccountId();
  let account = boardAccountId ? await getGoogleAccountById(boardAccountId) : null;
  if (!account) {
    const accounts = await listConnectedAccounts(userId);
    account = accounts.find((a) => a.provider === "google") ?? null;
  }
  if (!account) throw new Error("Aucun compte Google connecté pour stocker le fichier (Paramètres du board → Drive du board).");
  return account;
}

/** Session d'upload direct-navigateur pour un asset de campagne (carton, bannière, PDF, vidéo, signature) — dossier LGEF Drive/Inscriptions. */
export async function initCampaignAssetUpload(campaignId: string, filename: string, mimeType: string) {
  const { supabase, userId } = await requireStaff();
  const { data: campaign } = await supabase
    .from("event_registration_campaigns")
    .select("event_id")
    .eq("id", campaignId)
    .single();
  if (!campaign) throw new Error("Campagne introuvable.");

  const account = await requireBoardAccount(userId);
  const root = await findOrCreateFolder(account, { name: "LGEF Drive" });
  const folder = await findOrCreateFolder(account, { name: "Inscriptions", parentId: root.id });
  const { uploadUrl } = await createResumableUploadSession(account, {
    name: filename,
    parentId: folder.id,
    mimeType,
  });
  return { uploadUrl, eventId: campaign.event_id as string };
}

/**
 * Rend le fichier public (lien) puis met à jour le bloc correspondant dans
 * `blocks` avec l'URL exploitable dans un email — image directe pour
 * image/banner/signature, lien de lecture pour vidéo, lien de téléchargement
 * + nom pour un PDF (aucun embarquement inline possible dans un email).
 */
export async function finalizeCampaignBlockAsset(
  campaignId: string,
  blockId: string,
  kind: "image" | "banner" | "video" | "pdf" | "signature",
  driveFileId: string,
  extra?: { webViewLink?: string; filename?: string }
) {
  const { userId } = await requireStaff();
  const account = await requireBoardAccount(userId);
  await ensurePublicViewAccess(account, driveFileId);

  // thumbnail?id=...&sz=wNNNN est le lien le plus fiable pour un <img src> direct
  // (uc?export=view renvoie souvent une page d'interstice plutôt que l'image brute
  // selon le contexte — c'est ce qui cassait l'aperçu en iframe).
  const directImageUrl = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1000`;

  let patch: Record<string, unknown>;
  if (kind === "video") {
    patch = { url: extra?.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view` };
  } else if (kind === "pdf") {
    patch = { url: `https://drive.google.com/uc?export=download&id=${driveFileId}`, filename: extra?.filename || "Document" };
  } else if (kind === "signature") {
    patch = { imageUrl: directImageUrl };
  } else {
    patch = { url: directImageUrl };
  }
  return updateCampaignBlockContent(campaignId, blockId, patch);
}
