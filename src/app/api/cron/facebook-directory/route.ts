import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { syncTaggedPages } from "@/lib/social/pagesDirectory";

export const maxDuration = 300;

/**
 * Annuaire des Pages Facebook à mentionner — appelé chaque nuit par pg_cron (job « facebook-directory »,
 * sql/2026-10-18_facebook_pages_directory.sql) avec le secret CRON_SECRET : ajoute les Pages qui ont
 * identifié les Pages LGEF ces derniers jours. `?full=1` : tout l'historique (premier remplissage).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const full = new URL(request.url).searchParams.get("full") === "1";
  try {
    const result = await syncTaggedPages(createServiceClient(), full ? { maxCalls: 150 } : { since: new Date(Date.now() - 3 * 86_400_000), maxCalls: 10 });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[cron/facebook-directory]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
