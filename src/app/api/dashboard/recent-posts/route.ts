import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getRecentPosts } from "@/lib/board/recentPosts";

/** Accueil — derniers médias publiés (voir src/lib/board/recentPosts.ts) ; ?q= : recherche (loupe). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q")?.trim() || undefined;
  return NextResponse.json(await getRecentPosts(createServiceClient(), 24, q));
}
