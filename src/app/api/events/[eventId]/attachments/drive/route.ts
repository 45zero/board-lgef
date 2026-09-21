import { NextResponse } from "next/server";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import { getGoogleAccountById } from "@/lib/google/accounts";
import { getBoardDriveAccountId } from "@/app/actions/board-settings";
import { findOrCreateFolder, createResumableUploadSession } from "@/lib/google/drive";

const ROOT_FOLDER_NAME = "LGEF Drive";
const MEDIA_FOLDER_NAME = "Médias";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** N'accepte que les métadonnées (nom, type) — le fichier lui-même part directement du navigateur vers Google. */
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

  const { filename, mimeType } = (await request.json()) as { filename?: string; mimeType?: string };
  if (!filename) {
    return NextResponse.json({ ok: false, error: "Nom de fichier manquant" }, { status: 400 });
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
    const rootFolder = await findOrCreateFolder(account, { name: ROOT_FOLDER_NAME });
    const yearFolder = await findOrCreateFolder(account, {
      name: format(eventDateObj, "yyyy"),
      parentId: rootFolder.id,
    });
    const monthFolder = await findOrCreateFolder(account, {
      name: `${format(eventDateObj, "MM")} - ${capitalize(format(eventDateObj, "MMMM", { locale: fr }))}`,
      parentId: yearFolder.id,
    });
    const eventFolder = await findOrCreateFolder(account, {
      name: `${format(eventDateObj, "dd")} - ${eventTitle}`,
      parentId: monthFolder.id,
    });
    const mediaFolder = await findOrCreateFolder(account, { name: MEDIA_FOLDER_NAME, parentId: eventFolder.id });

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
