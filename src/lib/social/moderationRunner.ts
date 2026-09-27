import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { listNetworkComments, setNetworkCommentHidden } from "@/lib/social/publisher";
import { classifyComments, MODERATION_BATCH_SIZE, type CommentToClassify } from "@/lib/social/moderation";
import { sendModerationAlerts, type FlaggedComment } from "@/lib/social/moderationAlerts";
import { getNetworkEntry, publishedNetworks, type NetworkKey, type PublishInfo, type SocialComment } from "@/lib/social/targets";

type Client = SupabaseClient<Database>;

/**
 * Toutes les publications du board sont surveillées : les récentes (moins de 30 jours, là où
 * arrivent presque tous les commentaires) à chaque passage, les plus anciennes une fois par heure
 * (au passage de la minute 0) pour ne pas solliciter inutilement les API Meta/YouTube.
 */
const RECENT_DAYS = 30;
/** Plafond de commentaires analysés par passage (le cron repasse toutes les 5 minutes, le reste suit au prochain). */
const MAX_COMMENTS_PER_RUN = 100;

type Found = { pub: PubRow; key: NetworkKey; comment: SocialComment };
type PubRow = {
  id: string;
  title: string | null;
  caption: string | null;
  publish_info: PublishInfo | null;
  published_by: string | null;
  created_by: string | null;
  events: { title: string } | null;
};

export type ModerationReport = { scanned: number; analysed: number; hateful: number; review: number; notified: number; errors: string[] };

/**
 * Un passage de modération : lit les commentaires des publications récentes sur chaque réseau,
 * fait classer par Claude ceux jamais vus, masque les haineux, puis prévient les personnes concernées.
 * L'unicité (network, comment_id) en base garantit qu'un commentaire n'est traité qu'une fois, même
 * si deux passages se chevauchent : seules les lignes réellement insérées déclenchent masquage et alerte.
 */
export async function runCommentModeration(client: Client): Promise<ModerationReport> {
  const report: ModerationReport = { scanned: 0, analysed: 0, hateful: 0, review: 0, notified: 0, errors: [] };
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
  const includeOlder = new Date().getUTCMinutes() === 0;

  let query = client
    .from("media_publications")
    .select("id, title, caption, publish_info, published_by, created_by, events(title)")
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (!includeOlder) query = query.gte("published_at", since);
  const { data: pubs } = await query;

  const found: Found[] = [];
  await Promise.all(
    ((pubs as unknown as PubRow[] | null) ?? []).map(async (pub) => {
      for (const key of publishedNetworks(pub.publish_info)) {
        try {
          const comments = await listNetworkComments(client, key, getNetworkEntry(pub.publish_info, key));
          for (const comment of comments) if (comment.text.trim()) found.push({ pub, key, comment });
        } catch (e) {
          // YouTube sans les bons droits, post supprimé… : on n'empêche pas les autres réseaux.
          report.errors.push(`${pub.id}/${key} : ${e instanceof Error ? e.message : "lecture impossible"}`);
        }
      }
    })
  );
  report.scanned = found.length;
  if (found.length === 0) return report;

  // Déjà analysés → ignorés.
  const { data: known } = await client
    .from("comment_moderation")
    .select("network, comment_id")
    .in("comment_id", found.map((f) => f.comment.id));
  const knownKeys = new Set((known ?? []).map((k) => `${k.network}:${k.comment_id}`));
  const fresh = found.filter((f) => !knownKeys.has(`${f.key}:${f.comment.id}`)).slice(0, MAX_COMMENTS_PER_RUN);
  if (fresh.length === 0) return report;

  const flagged: FlaggedComment[] = [];
  for (let i = 0; i < fresh.length; i += MODERATION_BATCH_SIZE) {
    const batch = fresh.slice(i, i + MODERATION_BATCH_SIZE);
    const toClassify: CommentToClassify[] = batch.map((f) => ({
      id: `${f.key}:${f.comment.id}`,
      network: f.key,
      author: f.comment.author,
      text: f.comment.text,
      postCaption: f.pub.caption,
    }));
    const verdicts = await classifyComments(toClassify);
    report.analysed += batch.length;

    const rows = batch.map((f) => {
      const v = verdicts.get(`${f.key}:${f.comment.id}`);
      return {
        publication_id: f.pub.id,
        network: f.key,
        comment_id: f.comment.id,
        author: f.comment.author,
        text: f.comment.text,
        commented_at: f.comment.createdAt || null,
        // Un commentaire que le modèle a oublié dans sa réponse passe en « review » plutôt qu'en « ok ».
        verdict: v?.verdict ?? "review",
        severity: v?.severity ?? "medium",
        categories: v?.categories ?? [],
        reason: v?.reason ?? (v ? null : "Non analysé — à vérifier."),
      };
    });

    const { data: inserted, error } = await client
      .from("comment_moderation")
      .upsert(rows, { onConflict: "network,comment_id", ignoreDuplicates: true })
      .select("id, publication_id, network, comment_id, author, text, verdict, severity, reason");
    if (error) {
      report.errors.push(`enregistrement : ${error.message}`);
      continue;
    }

    for (const row of inserted ?? []) {
      if (row.verdict === "ok") continue;
      const f = batch.find((b) => b.key === row.network && b.comment.id === row.comment_id)!;
      let action: FlaggedComment["action"] = "none";
      if (row.verdict === "hateful") {
        report.hateful += 1;
        try {
          await setNetworkCommentHidden(client, f.key, f.comment.id, true);
          action = "hidden";
        } catch (e) {
          action = "hide_failed";
          await client
            .from("comment_moderation")
            .update({ action_error: e instanceof Error ? e.message : "échec" })
            .eq("id", row.id);
        }
        await client.from("comment_moderation").update({ action }).eq("id", row.id);
      } else {
        report.review += 1;
      }

      flagged.push({
        moderationId: row.id,
        publicationId: f.pub.id,
        publicationTitle: f.pub.events?.title ?? f.pub.title ?? "Publication",
        network: f.key,
        author: row.author ?? "Anonyme",
        text: row.text ?? "",
        verdict: row.verdict as "hateful" | "review",
        severity: row.severity,
        reason: row.reason,
        action,
        permalink: getNetworkEntry(f.pub.publish_info, f.key)?.permalink,
        ownerIds: [f.pub.published_by, f.pub.created_by].filter((id): id is string => !!id),
      });
    }
  }

  if (flagged.length > 0) {
    const alerts = await sendModerationAlerts(client, flagged);
    report.notified = alerts.notified.length;
    report.errors.push(...alerts.errors);
    await client
      .from("comment_moderation")
      .update({ notified_at: new Date().toISOString() })
      .in("id", flagged.map((f) => f.moderationId));
  }

  return report;
}
