import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { isModerationConfigured } from "@/lib/social/moderation";
import { runCommentModeration } from "@/lib/social/moderationRunner";

export const maxDuration = 60;

/**
 * Modération des commentaires — appelée chaque minute par pg_cron (job « moderate-comments »,
 * voir sql/2026-09-27_cron_comments.sql) avec le secret partagé CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!isModerationConfigured()) {
    return NextResponse.json({ skipped: "ANTHROPIC_API_KEY manquante" });
  }
  try {
    return NextResponse.json(await runCommentModeration(createServiceClient()));
  } catch (e) {
    console.error("[cron/comments]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
