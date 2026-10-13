import { NextResponse } from "next/server";
import { completeTransfer, verifyToken } from "@/lib/transfer/core";

export const maxDuration = 120;

/** LGEF Transfer : tous les fichiers sont arrivés → vérification dans le Drive, lien activé, e-mails envoyés. */
export async function POST(request: Request) {
  const { transferId, token, uploaded } = (await request.json().catch(() => ({}))) as {
    transferId?: string;
    token?: string;
    uploaded?: { fileRowId: string; driveFileId: string }[];
  };
  if (!transferId || !verifyToken("upload", transferId, token)) return NextResponse.json({ ok: false, error: "Envoi expiré — recommencez." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await completeTransfer(transferId, Array.isArray(uploaded) ? uploaded : [])) });
  } catch (e) {
    console.error("[api/transfer/complete]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Finalisation impossible." }, { status: 400 });
  }
}
