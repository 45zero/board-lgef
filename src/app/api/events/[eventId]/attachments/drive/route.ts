import { NextResponse } from "next/server";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import { getGoogleAccountById } from "@/lib/google/accounts";
import { getBoardDriveAccountId } from "@/app/actions/board-settings";
import { createResumableUploadSession } from "@/lib/google/drive";
import { archiveSubFolder, eventArchiveFolder } from "@/lib/google/archiveFolders";

const MEDIA_FOLDER_NAME = "Médias";
/** Pièces jointes qui ne sont ni photo ni vidéo : rangées à part, jamais proposées à la publication. */
const DOCUMENTS_FOLDER_NAME = "Documents";

/**
 * N'accepte que les métadonnées (nom, type) — le fichier lui-même part directement du navigateur vers Google.
 * `teamCardId` : fichier déposé depuis une carte de l'Espace Team liée à l'événement — étiqueté pour
 * que la carte le retrouve (voir src/app/actions/team-attachments.ts).
 */
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  }

  const boardDriveAccountId = await getBoardDriveAccountId();
  const account = boardDriveAccountId ? await getGoogleAccountById(boardDriveAccountId) : null;
  if (!account) {
    return NextResponse.json({ ok: false, reason: "no_drive" }, { status: 200 });
  }

  const { filename, mimeType, teamCardId } = (await request.json()) as { filename?: string; mimeType?: string; teamCardId?: string };
  if (!filename) {
    return NextResponse.json({ ok: false, error: "Nom de fichier manquant" }, { status: 400 });
  }

  // Carte d'où vient le fichier : doit être visible par l'utilisateur et liée à cet événement.
  if (teamCardId) {
    const { data: card } = await supabase.from("team_cards").select("event_id").eq("id", teamCardId).maybeSingle();
    if (card?.event_id !== eventId) return NextResponse.json({ ok: false, error: "Carte non liée à cet événement." }, { status: 403 });
  }

  const [{ data: event }, { data: profile }] = await Promise.all([
    supabase.from("events").select("title, start_date").eq("id", eventId).single(),
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
  ]);

  const eventTitle = event?.title ?? "Événement";
  const eventDateObj = event?.start_date ? new Date(event.start_date) : new Date();
  const eventDate = format(eventDateObj, "d MMMM yyyy", { locale: fr });
  const uploaderName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || user.email || "—";
  const uploadDate = format(new Date(), "d MMMM yyyy 'à' HH:mm", { locale: fr });

  try {
    const cache = new Map();
    const eventFolder = await eventArchiveFolder(account, { title: eventTitle, start: eventDateObj }, cache);
    const isMedia = /^(image|video)\//.test(mimeType ?? "");
    const mediaFolder = await archiveSubFolder(account, eventFolder, isMedia ? MEDIA_FOLDER_NAME : DOCUMENTS_FOLDER_NAME, cache);

    const description = [
      `Événement : ${eventTitle}`,
      `Date de l'événement : ${eventDate}`,
      `Uploadé par : ${uploaderName}`,
      `Date d'upload : ${uploadDate}`,
    ].join("\n");

    const { uploadUrl } = await createResumableUploadSession(account, {
      name: filename,
      parentId: mediaFolder.id,
      mimeType: mimeType || "application/octet-stream",
      description,
      appProperties: teamCardId
        ? { teamCardId, uploadedById: user.id, uploadedByName: uploaderName.slice(0, 100), source: "upload" }
        : undefined,
    });

    return NextResponse.json({ ok: true, uploadUrl });
  } catch (err) {
    console.error("[api/events/attachments/drive]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Échec de l'initialisation de l'upload Drive." },
      { status: 500 }
    );
  }
}
