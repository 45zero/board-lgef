import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { declarationPdf, loadDeclaration } from "@/lib/tournois/core";
import { recipientByToken } from "@/lib/tournois/reply";

// Tournois : récapitulatif PDF d'une déclaration (mis en page comme la fiche papier du district).
// ?d=<dossier> (board, onglet Tournois) ou ?t=<jeton du bouton « Répondre »> ; &dl=1 pour télécharger.

const fail = (status: number, error: string) => new NextResponse(error, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  let declarationId: string | null = null;
  if (token) {
    const ctx = await recipientByToken(token);
    if (ctx?.pdf) declarationId = ctx.message.declaration_id;
  } else {
    const id = url.searchParams.get("d") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Dossier invalide.");
    const supabase = await createClient();
    const { data: ok } = await supabase.rpc("tournois_is_manager");
    if (ok !== true) return fail(403, "Réservé à l'onglet Tournois du board.");
    declarationId = id;
  }
  if (!declarationId) return fail(404, "Récapitulatif indisponible.");

  const full = await loadDeclaration(createServiceClient(), declarationId);
  if (!full) return fail(404, "Dossier introuvable.");
  const bytes = await declarationPdf(full);
  const name = `Declaration ${full.declaration.ref ?? ""} ${full.declaration.club_name}`.replace(/[^\w\- ]+/g, "").trim() + ".pdf";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.get("dl") ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
