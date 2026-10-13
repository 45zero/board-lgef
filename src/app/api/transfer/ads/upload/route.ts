import { NextResponse } from "next/server";
import { requireTransferStorage, signToken, UPLOAD_TOKEN_TTL } from "@/lib/transfer/core";
import { getTransferMember } from "@/lib/transfer/session";

/** LGEF Transfer : envoi du visuel d'une pub (admins) dans « LGEF Transfer / Publicités » du Drive du board. */
export async function POST(request: Request) {
  const member = await getTransferMember();
  if (!member?.isAdmin) return NextResponse.json({ ok: false, error: "Réservé aux administrateurs." }, { status: 403 });
  const { name, mimeType, size } = (await request.json().catch(() => ({}))) as { name?: string; mimeType?: string; size?: number };
  if (!name || !/^(image|video)\//.test(mimeType ?? "")) return NextResponse.json({ ok: false, error: "Choisissez une image ou une vidéo." }, { status: 400 });
  try {
    const storage = await requireTransferStorage();
    const folderId = await storage.namedFolder("Publicités");
    const target = await storage.createUpload(folderId, { name, mimeType: mimeType!, size: Number(size) || 0 });
    return NextResponse.json({ ok: true, ...target, token: signToken("upload", "ads", UPLOAD_TOKEN_TTL) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Envoi impossible." }, { status: 500 });
  }
}
