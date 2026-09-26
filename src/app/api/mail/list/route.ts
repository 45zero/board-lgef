import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOwnedGoogleAccount } from "@/lib/google/accounts";
import { listMessages } from "@/lib/google/gmail";

/** Liste de mails d'un dossier — route GET pour partir en parallèle des autres chargements (voir /api/mail/message). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account");
  if (!accountId) return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const account = await getOwnedGoogleAccount(accountId, userId);
    const result = await listMessages(account, {
      labelIds: searchParams.getAll("label"),
      query: searchParams.get("q") || undefined,
      pageToken: searchParams.get("page") || undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
