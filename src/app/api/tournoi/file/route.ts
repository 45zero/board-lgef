import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getTournamentStorage } from "@/lib/tournois/storage";
import { recipientByToken } from "@/lib/tournois/reply";

// Tournois : ouvre / télécharge une pièce d'un dossier. Accès : personne du board qui voit l'onglet
// Tournois, ou destinataire d'un message (?t=<jeton du bouton « Répondre »), pour les pièces de ce message.
// ?f=<pièce>  [&t=<jeton>]  [&dl=1 : téléchargement]

export const maxDuration = 60;

const fail = (status: number, error: string) => new NextResponse(error, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fileId = url.searchParams.get("f") ?? "";
  const token = url.searchParams.get("t");
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return fail(400, "Pièce invalide.");

  let file: { file_name: string; mime_type: string | null; storage_key: string | null } | null = null;
  if (token) {
    const ctx = await recipientByToken(token);
    const f = ctx?.files.find((x) => x.id === fileId);
    if (f) file = f;
  } else {
    const supabase = await createClient();
    const { data: ok } = await supabase.rpc("tournois_is_manager");
    if (ok !== true) return fail(403, "Réservé à l'onglet Tournois du board.");
    const { data } = await createServiceClient().from("tournament_files").select("file_name, mime_type, storage_key").eq("id", fileId).eq("status", "ready").maybeSingle();
    file = data;
  }
  if (!file?.storage_key) return fail(404, "Pièce introuvable.");

  const storage = await getTournamentStorage();
  if (!storage) return fail(503, "Stockage indisponible.");
  const upstream = await storage.fetch(file.storage_key);
  if (!upstream.ok || !upstream.body) return fail(502, "Pièce momentanément indisponible.");

  const name = encodeURIComponent(file.file_name);
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": file.mime_type || upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": `${url.searchParams.get("dl") ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
