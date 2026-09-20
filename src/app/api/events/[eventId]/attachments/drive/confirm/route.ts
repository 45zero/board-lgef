import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Enregistre la ligne event_files une fois le fichier effectivement arrivé sur Drive (upload direct navigateur → Google). */
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  }

  const { fileId, webViewLink, filename, contentType, sizeBytes } = (await request.json()) as {
    fileId?: string;
    webViewLink?: string;
    filename?: string;
    contentType?: string;
    sizeBytes?: number;
  };
  if (!fileId || !filename) {
    return NextResponse.json({ ok: false, error: "Données manquantes" }, { status: 400 });
  }

  const { error } = await supabase.from("event_files").insert({
    event_id: eventId,
    filename,
    content_type: contentType || null,
    size_bytes: sizeBytes ?? null,
    storage_provider: "drive",
    drive_file_id: fileId,
    drive_web_view_link: webViewLink ?? null,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
