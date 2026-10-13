import { NextResponse } from "next/server";
import { registerDownload, transferBaseUrl } from "@/lib/transfer/core";

/**
 * LGEF Transfer : téléchargement d'un fichier depuis la page du transfert — compté, puis redirection
 * vers le fichier (les octets ne transitent pas par nos serveurs). Lien expiré → retour à la page.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string; fileId: string }> }) {
  const { code, fileId } = await params;
  const url = await registerDownload(code, fileId).catch((e) => {
    console.error("[api/transfer/download]", e);
    return null;
  });
  return NextResponse.redirect(url ?? `${transferBaseUrl()}/t/${encodeURIComponent(code)}`, 302);
}
