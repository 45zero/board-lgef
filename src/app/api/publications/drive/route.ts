import { NextResponse } from "next/server";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import { getGoogleAccountById } from "@/lib/google/accounts";
import { getBoardDriveAccountId } from "@/app/actions/board-settings";
import { findOrCreateFolder, createResumableUploadSession } from "@/lib/google/drive";

const ROOT_FOLDER_NAME = "LGEF Drive";
const PUBLICATIONS_FOLDER_NAME = "Publications";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Initialise l'upload Drive d'un média de publication autonome (créée depuis le centre de
 * publication, sans événement du planning) — même mécanique que
 * /api/events/[eventId]/attachments/drive, rangé sous « LGEF Drive / Publications / AAAA / MM - Mois ».
 */
export async function POST(request: Request) {
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

  const { data: profile } = await supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single();
  const uploaderName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || user.email || "—";
  const now = new Date();

  try {
    const rootFolder = await findOrCreateFolder(account, { name: ROOT_FOLDER_NAME });
    const pubFolder = await findOrCreateFolder(account, { name: PUBLICATIONS_FOLDER_NAME, parentId: rootFolder.id });
    const yearFolder = await findOrCreateFolder(account, { name: format(now, "yyyy"), parentId: pubFolder.id });
    const monthFolder = await findOrCreateFolder(account, {
      name: `${format(now, "MM")} - ${capitalize(format(now, "MMMM", { locale: fr }))}`,
      parentId: yearFolder.id,
    });

    const { uploadUrl } = await createResumableUploadSession(account, {
      name: filename,
      parentId: monthFolder.id,
      mimeType: mimeType || "application/octet-stream",
      description: [
        "Publication du centre de publication (sans événement)",
        `Uploadé par : ${uploaderName}`,
        `Date d'upload : ${format(now, "d MMMM yyyy 'à' HH:mm", { locale: fr })}`,
      ].join("\n"),
    });

    return NextResponse.json({ ok: true, uploadUrl });
  } catch (err) {
    console.error("[api/publications/drive]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Échec de l'initialisation de l'upload Drive." },
      { status: 500 }
    );
  }
}
