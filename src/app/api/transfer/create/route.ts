import { NextResponse } from "next/server";
import { createTransfer, verifyToken } from "@/lib/transfer/core";
import { getTransferMember } from "@/lib/transfer/session";

export const maxDuration = 60;

type Body = {
  senderEmail?: string;
  senderName?: string;
  senderToken?: string;
  fromBoard?: boolean;
  title?: string;
  message?: string;
  recipients?: string[];
  days?: number | null;
  archived?: boolean;
  notifyOnDownload?: boolean;
  files?: { name: string; mimeType: string; size: number }[];
  boardFileIds?: string[];
};

/**
 * LGEF Transfer : crée le transfert et ses sessions d'envoi (le navigateur envoie ensuite les octets
 * vers le Drive du board). Compte du board connecté → pas de code ; sinon jeton d'expéditeur vérifié.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const member = await getTransferMember();
  const senderEmail = member?.email ?? (body.senderEmail ?? "").trim().toLowerCase();
  if (!member && !verifyToken("sender", senderEmail, body.senderToken)) {
    return NextResponse.json({ ok: false, error: "Adresse non vérifiée — saisissez le code reçu par e-mail.", reason: "verify" }, { status: 401 });
  }
  try {
    const res = await createTransfer({
      senderEmail,
      senderName: body.senderName?.trim() || member?.name || "",
      senderUserId: member?.id ?? null,
      source: member && body.fromBoard ? "board" : "public",
      title: body.title ?? "",
      message: body.message ?? "",
      recipients: Array.isArray(body.recipients) ? body.recipients : [],
      days: body.days === null ? null : Number(body.days ?? 7),
      archived: !!body.archived,
      notifyOnDownload: body.notifyOnDownload !== false,
      files: (Array.isArray(body.files) ? body.files : []).map((f) => ({ name: String(f.name ?? ""), mimeType: String(f.mimeType ?? ""), size: Math.max(0, Number(f.size) || 0) })),
      boardFileIds: Array.isArray(body.boardFileIds) ? body.boardFileIds.map(String) : [],
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error("[api/transfer/create]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Création impossible." }, { status: 400 });
  }
}
