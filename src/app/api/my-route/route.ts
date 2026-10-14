import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { routeFromHome } from "@/lib/board/travel";

/**
 * Itinéraire domicile → adresse pour la mini-carte de la fiche événement — route GET plutôt que
 * server action : Next.js exécute les server actions d'un même navigateur une par une, si bien que
 * l'itinéraire attendait derrière les autres appels lancés à l'ouverture de la fiche.
 */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const data = await routeFromHome(userId, address);
  // Le navigateur peut réutiliser la réponse (même adresse) pendant 10 min.
  return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=600" } });
}
