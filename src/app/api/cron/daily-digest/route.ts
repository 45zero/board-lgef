import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { buildDashboard } from "@/lib/board/dashboardCore";
import { hasContent, parisHour, parisToday, renderDailyDigest } from "@/lib/board/dailyDigest";
import { isResendConfigured, sendResendBatch, type ResendMessage } from "@/lib/email/resend";

export const maxDuration = 60;

/** Heure d'envoi (Paris). La tâche pg_cron tourne toutes les heures ; seule celle de 7 h envoie. */
const SEND_HOUR = 7;

/**
 * Programme de la journée par e-mail — appelé toutes les heures par pg_cron (job « daily-digest »,
 * voir sql/2026-09-28_cron_daily_digest.sql) avec le secret CRON_SECRET. À 7 h (Paris), envoie à
 * chaque abonné (profiles.daily_digest_email) son tableau de bord du jour, une seule fois par jour,
 * et seulement s'il y a quelque chose (action ou événement). `?force=1` : envoi immédiat (test).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && parisHour() !== SEND_HOUR) return NextResponse.json({ skipped: "pas encore l'heure" });
  if (!isResendConfigured()) return NextResponse.json({ error: "Resend non configuré" }, { status: 500 });

  const service = createServiceClient();
  const today = parisToday();
  const { data: subscribers } = await service
    .from("profiles")
    .select("id, email, daily_digest_sent_on")
    .eq("daily_digest_email", true)
    .not("email", "is", null);

  const due = (subscribers ?? []).filter((s) => force || s.daily_digest_sent_on !== today);
  const messages: ResendMessage[] = [];
  const ids: string[] = [];
  let empty = 0;

  // Par lots de 5 : chaque tableau de bord fait une dizaine de requêtes.
  for (let i = 0; i < due.length; i += 5) {
    await Promise.all(
      due.slice(i, i + 5).map(async (s) => {
        try {
          const dashboard = await buildDashboard(service, s.id, "day");
          if (!hasContent(dashboard)) {
            empty += 1;
            return;
          }
          messages.push(renderDailyDigest(dashboard, s.email!));
          ids.push(s.id);
        } catch (e) {
          console.error("[cron/daily-digest]", s.id, e);
        }
      })
    );
  }

  // Marqués « envoyés » lot par lot, au fil des acceptations de Resend.
  const result = messages.length
    ? await sendResendBatch(messages, async (indexes) => {
        await service
          .from("profiles")
          .update({ daily_digest_sent_on: today })
          .in("id", indexes.map((k) => ids[k]));
      })
    : { sent: 0, errors: [] as string[] };
  // Les abonnés sans rien à signaler sont aussi marqués, pour ne pas être recalculés dans la journée.
  if (!force) {
    const emptyIds = due.map((s) => s.id).filter((id) => !ids.includes(id));
    if (emptyIds.length) await service.from("profiles").update({ daily_digest_sent_on: today }).in("id", emptyIds);
  }

  return NextResponse.json({ subscribers: due.length, sent: result.sent, empty, errors: result.errors });
}
