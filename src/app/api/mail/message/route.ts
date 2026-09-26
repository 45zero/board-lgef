import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOwnedGoogleAccount } from "@/lib/google/accounts";
import { getMessage } from "@/lib/google/gmail";

/**
 * Contenu d'un mail — route GET plutôt que server action : Next.js exécute les server actions
 * d'un même navigateur une par une, si bien que le préchargement des mails bloquait l'ouverture du
 * mail cliqué. Ici les requêtes partent en parallèle, et le navigateur peut les garder en cache.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account");
  const messageId = searchParams.get("id");
  if (!accountId || !messageId) return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });

  const supabase = await createClient();
  // getClaims vérifie le jeton de session localement (pas d'aller-retour au serveur d'auth).
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const account = await getOwnedGoogleAccount(accountId, userId);
    const message = await getMessage(account, messageId);
    return NextResponse.json(message, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
