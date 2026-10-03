import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { purgePublishedMedia } from "@/lib/board/driveCleanup";

export const maxDuration = 60;

/**
 * Nettoyage quotidien du Drive du board (pg_cron « drive-cleanup », sql/2026-10-03_drive_cleanup.sql) :
 * photos et vidéos publiées sur les réseaux depuis 7 jours mises à la corbeille. `?dry=1` : aperçu
 * de ce qui serait retiré, sans rien toucher.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  return NextResponse.json(await purgePublishedMedia(createServiceClient(), { dryRun }));
}
