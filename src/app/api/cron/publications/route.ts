import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import type { Json } from "@/lib/supabase/database.types";
import {
  publishPublicationToSocial,
  publishPublicationToYoutubeServer,
  loadPublication,
  savePublishInfo,
} from "@/lib/social/publisher";
import { FACEBOOK_REGIONS, describeFailures, type SocialPublishResult, type SocialTargetKey } from "@/lib/social/targets";
import type { PublicationTargets } from "@/lib/board/mediaPublications";

// Une publication Instagram vidéo attend le traitement du Reel côté Meta (~50s max).
export const maxDuration = 60;

/**
 * Envoi des publications programmées arrivées à échéance — appelé toutes les 5 minutes par
 * pg_cron (job « publish-scheduled-publications », voir sql/2026-09-26_cron_publications.sql)
 * avec le secret partagé CRON_SECRET. Client service role : aucune session utilisateur ici.
 *
 * Une publication est « réservée » en passant son statut à published AVANT l'envoi (update
 * conditionnel sur status = scheduled) : deux passages simultanés ne peuvent pas la publier deux
 * fois. Si tous les réseaux échouent, elle revient dans « À publier » avec l'erreur.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const client = createServiceClient();
  const { data: due } = await client
    .from("media_publications")
    .select("id, targets, caption, created_by")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(3);

  const report: { id: string; ok: boolean; failures: string | null }[] = [];

  for (const pub of due ?? []) {
    const { data: claimed } = await client
      .from("media_publications")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", pub.id)
      .eq("status", "scheduled")
      .select("id");
    if (!claimed?.length) continue;

    const targets = (pub.targets as PublicationTargets | null) ?? {};
    const caption = pub.caption ?? "";
    const { data: author } = pub.created_by
      ? await client.from("profiles").select("first_name, last_name").eq("id", pub.created_by).single()
      : { data: null };

    const social: { key: SocialTargetKey; caption: string }[] = [
      ...FACEBOOK_REGIONS.filter((r) => targets.facebook?.[r.key]).map((r) => ({ key: r.key as SocialTargetKey, caption })),
      ...(targets.instagram ? [{ key: "instagram" as SocialTargetKey, caption }] : []),
    ];

    const results: SocialPublishResult[] = [];
    try {
      if (social.length > 0) {
        results.push(...(await publishPublicationToSocial(client, pub.id, social, author, { igUserTags: targets.igTags })));
      }
      if (targets.youtube) results.push(await publishPublicationToYoutubeServer(client, pub.id, author));
    } catch (e) {
      results.push({ key: "lorraine", ok: false, error: e instanceof Error ? e.message : "Erreur inattendue." });
    }

    const failures = describeFailures(results);
    const anyOk = results.some((r) => r.ok);
    if (failures) {
      const loaded = await loadPublication(client, pub.id);
      await savePublishInfo(client, loaded, (current) => ({ ...current, lastError: { at: new Date().toISOString(), message: failures } }));
    }
    if (!anyOk) {
      await client
        .from("media_publications")
        .update({ status: "to_publish", published_at: null, scheduled_at: null, targets: targets as unknown as Json })
        .eq("id", pub.id);
    }
    report.push({ id: pub.id, ok: anyOk, failures });
  }

  return NextResponse.json({ processed: report });
}
