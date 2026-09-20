import { NextResponse } from "next/server";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import { listConnectedAccounts } from "@/lib/google/accounts";
import { findOrCreateFolder, uploadFile } from "@/lib/google/drive";

const MEDIA_FOLDER_NAME = "Médias";

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  }

  const accounts = await listConnectedAccounts(user.id);
  const account = accounts.find((a) => a.provider === "google");
  if (!account) {
    return NextResponse.json({ ok: false, reason: "no_drive" }, { status: 200 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Fichier manquant" }, { status: 400 });
  }

  const [{ data: event }, { data: profile }] = await Promise.all([
    supabase.from("events").select("title, start_date").eq("id", eventId).single(),
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
  ]);

  const eventTitle = event?.title ?? "Événement";
  const eventDate = event?.start_date ? format(new Date(event.start_date), "d MMMM yyyy", { locale: fr }) : "—";
  const uploaderName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || user.email || "—";
  const uploadDate = format(new Date(), "d MMMM yyyy 'à' HH:mm", { locale: fr });

  try {
    const mediaFolder = await findOrCreateFolder(account, { name: MEDIA_FOLDER_NAME });
    const buffer = Buffer.from(await file.arrayBuffer());
    const description = [
      `Événement : ${eventTitle}`,
      `Date de l'événement : ${eventDate}`,
      `Uploadé par : ${uploaderName}`,
      `Date d'upload : ${uploadDate}`,
    ].join("\n");

    const driveFile = await uploadFile(account, {
      name: `${eventTitle} — ${file.name}`,
      parentId: mediaFolder.id,
      mimeType: file.type || "application/octet-stream",
      data: buffer,
      description,
    });

    const { error: insertError } = await supabase.from("event_files").insert({
      event_id: eventId,
      filename: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
      storage_provider: "drive",
      drive_file_id: driveFile.id,
      drive_web_view_link: driveFile.webViewLink,
    });
    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/events/attachments/drive]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Échec de l'upload vers Drive." },
      { status: 500 }
    );
  }
}
