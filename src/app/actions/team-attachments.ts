"use server";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import type { Json } from "@/lib/supabase/database.types";
import { getOwnedGoogleAccount } from "@/lib/google/accounts";
import {
  createResumableUploadSession,
  ensurePublicViewAccess,
  getFile,
  listFilesByAppProperty,
  listFolderTagged,
  readFileContent,
  searchFiles,
  shareFileWithEmail,
  trashFile,
  uploadTaggedFile,
} from "@/lib/google/drive";
import { CARD_FOLDER_KEY, cardFileInfo, ensureCardFolder, eventFilesFolder, findCardFolder, getBoardDriveAccount, isTeamMedia, type CardForDrive } from "@/lib/board/teamDrive";

// Pièces jointes des cartes de l'Espace Team, archivées dans le Drive du board (voir teamDrive.ts).
// Le type de fichier décide de sa destination, sans question à l'utilisateur :
//  - carte liée à un événement : le fichier devient un fichier de l'événement (event_files) —
//    document → « Documents » ; photo/vidéo → « Médias », mise en file « À publier » par le trigger
//    d'event_files ;
//  - carte sans événement : dossier de la carte ; une photo/vidéo crée en plus une publication
//    autonome « À publier » dans le centre.
// Voir une carte (RLS de team_cards) suffit pour lister, voir, télécharger et partager ; déposer ou
// retirer demande le droit de la modifier (team_can_edit_card).

export type TeamAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  createdAt: string;
  uploadedBy: string;
  fromGed: boolean;
  /** card : dossier de la carte ; event : fichier de l'événement lié (retiré depuis l'événement). */
  place: "card" | "event";
  /** Proposé au centre de publication (« À publier »). */
  toCenter: boolean;
};

const MAX_GED_BYTES = 50 * 1024 * 1024;

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return { supabase, userId };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;
type CardWithEvent = CardForDrive & { eventId: string | null };

/** Carte visible par l'utilisateur (sinon erreur), avec de quoi la ranger dans le Drive. */
async function visibleCard(supabase: Supabase, cardId: string): Promise<CardWithEvent> {
  const { data: card } = await supabase.from("team_cards").select("id, title, created_at, event_id").eq("id", cardId).maybeSingle();
  if (!card) throw new Error("Carte introuvable ou non accessible.");
  const { data: event } = card.event_id
    ? await createServiceClient().from("events").select("title, start_date").eq("id", card.event_id).maybeSingle()
    : { data: null };
  return {
    id: card.id,
    title: card.title,
    createdAt: card.created_at,
    eventId: event ? card.event_id : null,
    event: event ? { title: event.title, startDate: event.start_date } : null,
  };
}

async function requireEditable(supabase: Supabase, cardId: string, userId: string) {
  // Fonction SQL de sql/2026-10-02_team_space.sql (absente des types générés). bind : rpc lit this.rest.
  const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, string>) => PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
  const { data, error } = await rpc("team_can_edit_card", { p_card: cardId, p_uid: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Vous ne pouvez pas modifier cette carte.");
}

async function requireDrive() {
  const account = await getBoardDriveAccount();
  if (!account) throw new Error("Aucun Drive de board configuré (Paramètres du board → Drive du board).");
  return account;
}

async function uploaderTags(supabase: Supabase, cardId: string, userId: string, opts: { fromGed: boolean; toCenter: boolean }) {
  const { data: p } = await supabase.from("profiles").select("first_name, last_name, email").eq("id", userId).single();
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.email || "—";
  return {
    name,
    appProperties: {
      [CARD_FOLDER_KEY]: cardId,
      uploadedById: userId,
      uploadedByName: name.slice(0, 100),
      source: opts.fromGed ? "ged" : "upload",
      ...(opts.toCenter && { toCenter: "1" }),
    },
  };
}

function describe(card: CardForDrive, uploader: string) {
  return [
    `Pièce jointe de la carte « ${card.title} » (Espace Team)`,
    card.event ? `Événement : ${card.event.title} (${format(new Date(card.event.startDate), "d MMMM yyyy", { locale: fr })})` : "Hors événement",
    `Ajoutée par : ${uploader} · ${format(new Date(), "d MMMM yyyy 'à' HH:mm", { locale: fr })}`,
  ].join("\n");
}

/** Publication autonome « À publier » (carte sans événement) pour une photo/vidéo de la carte. */
async function queueStandalone(card: CardForDrive, userId: string, media: { drive_file_id: string; filename: string; content_type: string; web_view_link: string | null }) {
  // Service : déposer dans une carte ne demande pas d'être publieur ; la file est ensuite traitée par le centre.
  const { error } = await createServiceClient()
    .from("media_publications")
    .insert({
      event_id: null,
      file_ids: [],
      media: [media] as unknown as Json,
      title: card.title,
      caption: "",
      kind: media.content_type.startsWith("video") ? "video" : "photo",
      status: "to_publish",
      created_by: userId,
    });
  if (error) throw new Error(`Fichier enregistré, mais pas envoyé au centre de publication : ${error.message}`);
}

export const listTeamCardAttachments = async (cardId: string) =>
  toResult(async (): Promise<{ driveReady: boolean; files: TeamAttachment[] }> => {
    const { supabase } = await session();
    await visibleCard(supabase, cardId);
    const account = await getBoardDriveAccount();
    if (!account) return { driveReady: false, files: [] };
    const folder = await findCardFolder(account, cardId);
    const [inFolder, tagged] = await Promise.all([folder ? listFolderTagged(account, folder.id) : [], listFilesByAppProperty(account, CARD_FOLDER_KEY, cardId)]);
    const folderIds = new Set(inFolder.map((f) => f.id));
    // Fichiers d'événement : seulement ceux encore joints à l'événement (une suppression depuis la
    // fiche retire la ligne event_files mais laisse le fichier dans l'archive du Drive).
    const eventTagged = tagged.filter((f) => !folderIds.has(f.id));
    const stillAttached = eventTagged.length
      ? new Set(
          ((await supabase.from("event_files").select("drive_file_id").in("drive_file_id", eventTagged.map((f) => f.id))).data ?? []).map((r) => r.drive_file_id)
        )
      : new Set<string | null>();
    const files = [
      ...inFolder.filter((f) => !f.isFolder).map((f) => ({ f, place: "card" as const })),
      ...eventTagged.filter((f) => stillAttached.has(f.id)).map((f) => ({ f, place: "event" as const })),
    ].sort((a, b) => b.f.createdTime.localeCompare(a.f.createdTime));
    return {
      driveReady: true,
      files: files.map(({ f, place }) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size ? Number(f.size) : null,
        createdAt: f.createdTime,
        uploadedBy: f.appProperties.uploadedByName ?? f.ownerName,
        fromGed: f.appProperties.source === "ged",
        place,
        toCenter: place === "event" ? isTeamMedia(f.mimeType) : f.appProperties.toCenter === "1",
      })),
    };
  });

/**
 * Prépare l'envoi d'un fichier. Carte liée à un événement : renvoie l'événement, le navigateur
 * envoie alors le fichier comme un fichier de l'événement (uploadEventFiles). Sinon : session
 * d'envoi vers le dossier de la carte.
 */
export const startTeamAttachmentUpload = async (cardId: string, filename: string, mimeType: string) =>
  toResult(async (): Promise<{ mode: "event"; eventId: string } | { mode: "card"; uploadUrl: string }> => {
    const { supabase, userId } = await session();
    const card = await visibleCard(supabase, cardId);
    await requireEditable(supabase, cardId, userId);
    if (card.eventId) return { mode: "event", eventId: card.eventId };
    const account = await requireDrive();
    const folder = await ensureCardFolder(account, card);
    const tags = await uploaderTags(supabase, cardId, userId, { fromGed: false, toCenter: isTeamMedia(mimeType) });
    const { uploadUrl } = await createResumableUploadSession(account, {
      name: filename,
      parentId: folder.id,
      mimeType: mimeType || "application/octet-stream",
      description: describe(card, tags.name),
      appProperties: tags.appProperties,
    });
    return { mode: "card", uploadUrl };
  });

/** Après l'envoi d'une photo/vidéo dans une carte sans événement : la propose au centre de publication. */
export const queueTeamMediaForPublication = async (cardId: string, driveFileId: string) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    const card = await visibleCard(supabase, cardId);
    await requireEditable(supabase, cardId, userId);
    const account = await requireDrive();
    const info = await cardFileInfo(account, cardId, driveFileId);
    if (!info || info.place !== "card" || !isTeamMedia(info.mimeType)) return;
    const file = await getFile(account, driveFileId);
    await queueStandalone(card, userId, { drive_file_id: driveFileId, filename: info.name, content_type: info.mimeType, web_view_link: file.webViewLink || null });
  });

/** Fichiers de la GED (Drive personnel connecté) : recherche dans un compte de l'utilisateur. */
export const searchMyGedFiles = async (accountId: string, query: string) =>
  toResult(async () => {
    const { userId } = await session();
    const account = await getOwnedGoogleAccount(accountId, userId);
    return (await searchFiles(account, query)).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size ? Number(f.size) : null, modifiedTime: f.modifiedTime }));
  });

/** Copie un fichier de la GED dans l'archive du board (même destination qu'un dépôt) ; l'original ne bouge pas. */
export const attachTeamFileFromGed = async (cardId: string, accountId: string, fileId: string) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    const card = await visibleCard(supabase, cardId);
    await requireEditable(supabase, cardId, userId);
    const [source, account] = await Promise.all([getOwnedGoogleAccount(accountId, userId), requireDrive()]);
    const content = await readFileContent(source, fileId, MAX_GED_BYTES);
    const media = isTeamMedia(content.mimeType);
    const tags = await uploaderTags(supabase, cardId, userId, { fromGed: true, toCenter: media && !card.event });
    const parent = card.event ? await eventFilesFolder(account, card.event, content.mimeType) : await ensureCardFolder(account, card);
    const uploaded = await uploadTaggedFile(account, {
      name: content.name,
      parentId: parent.id,
      mimeType: content.mimeType,
      data: content.data,
      description: describe(card, tags.name),
      appProperties: tags.appProperties,
    });
    if (card.eventId) {
      // Fichier de l'événement, comme un envoi depuis sa fiche (photo/vidéo : mise en file par trigger).
      const { error } = await supabase.from("event_files").insert({
        event_id: card.eventId,
        filename: content.name,
        content_type: content.mimeType,
        size_bytes: content.data.length,
        storage_provider: "drive",
        drive_file_id: uploaded.id,
        drive_web_view_link: uploaded.webViewLink || null,
      });
      if (error) throw new Error(error.message);
    } else if (media) {
      await queueStandalone(card, userId, { drive_file_id: uploaded.id, filename: content.name, content_type: content.mimeType, web_view_link: uploaded.webViewLink || null });
    }
  });

/** Retire une pièce jointe du dossier de la carte (corbeille du Drive, récupérable 30 jours). */
export const deleteTeamAttachment = async (cardId: string, fileId: string) =>
  toResult(async () => {
    const { supabase, userId } = await session();
    await visibleCard(supabase, cardId);
    await requireEditable(supabase, cardId, userId);
    const account = await requireDrive();
    const info = await cardFileInfo(account, cardId, fileId);
    if (!info) throw new Error("Ce fichier n'appartient pas à cette carte.");
    if (info.place === "event") throw new Error("Ce fichier appartient à l'événement : retirez-le depuis la fiche de l'événement.");
    await trashFile(account, fileId);
  });

/**
 * Partage d'une pièce jointe (à qui voit la carte) : avec une adresse e-mail (invitation Google,
 * lecture seule), ou par lien (lisible par toute personne qui a le lien). Renvoie le lien Drive.
 */
export const shareTeamAttachment = async (cardId: string, fileId: string, to: { email: string; message?: string } | { publicLink: true }) =>
  toResult(async () => {
    const { supabase } = await session();
    await visibleCard(supabase, cardId);
    const account = await requireDrive();
    if (!(await cardFileInfo(account, cardId, fileId))) throw new Error("Ce fichier n'appartient pas à cette carte.");
    if ("email" in to) {
      const email = to.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Adresse e-mail invalide.");
      await shareFileWithEmail(account, fileId, email, to.message?.trim());
    } else {
      await ensurePublicViewAccess(account, fileId);
    }
    return (await getFile(account, fileId)).webViewLink;
  });
