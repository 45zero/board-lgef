import { NextResponse } from "next/server";
import { isPublisher } from "@/lib/board/publishers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getInboxUnreadCount } from "@/lib/google/gmail";
import { getMyExpenses, getMyValidatorScope } from "@/app/actions/expenses";

export type AppBadges = {
  /** Mails non lus (boîtes de réception de tous les comptes connectés). */
  mails: number;
  /** Événements du jour. */
  calendrier: number;
  /** Inscriptions des événements à venir : invitations envoyées / pas encore envoyées. */
  inscription: { sent: number; pending: number };
  /** Centre de publication : publications à publier. */
  audiovisuel: number;
  /** Frais : mes événements à déclarer / déclarations de mon équipe à valider (N+1). */
  frais: { toDeclare: number; toValidate: number };
  /** Espace Team : cartes qui m'ont été assignées et que je n'ai pas encore ouvertes. */
  trello: number;
};

/**
 * Compteurs réels affichés sur les icônes du rail, du dock et de la barre mobile. Chaque compteur
 * est calculé indépendamment : un échec (Gmail indisponible…) le met à 0 sans bloquer les autres.
 *
 * `?scope=db` : uniquement les compteurs issus de la base (recalculés en direct à chaque
 * changement) ; `?scope=mails` : uniquement Gmail (interrogé périodiquement) ; sinon tout.
 */
export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get("scope");
  const withMails = scope !== "db";
  const withDb = scope !== "mails";

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      console.error("[api/badges]", e);
      return fallback;
    }
  };

  const [mails, calendrier, inscription, audiovisuel, frais, trello] = await Promise.all([
    withMails
      ? safe(async () => {
          const accounts = await prisma.connectedAccount.findMany({ where: { user_id: userId, provider: "google" } });
          const counts = await Promise.all(accounts.map((a) => getInboxUnreadCount(a).catch(() => 0)));
          return counts.reduce((n, c) => n + c, 0);
        }, 0)
      : undefined,
    withDb
      ? safe(async () => {
          const { count } = await supabase
            .from("events")
            .select("id", { count: "exact", head: true })
            .lt("start_date", dayEnd)
            .gte("end_date", dayStart)
            .not("event_type", "is", null);
          return count ?? 0;
        }, 0)
      : undefined,
    withDb
      ? safe(
          async () => {
            const { data: campaigns } = await supabase
              .from("event_registration_campaigns")
              .select("id, events!inner(start_date)")
              .gte("events.start_date", dayStart);
            const ids = (campaigns ?? []).map((c) => c.id);
            if (ids.length === 0) return { sent: 0, pending: 0 };
            const { data: recipients } = await supabase
              .from("event_registration_recipients")
              .select("sent_at, whatsapp_sent_at")
              .in("campaign_id", ids);
            const sent = (recipients ?? []).filter((r) => r.sent_at || r.whatsapp_sent_at).length;
            return { sent, pending: (recipients ?? []).length - sent };
          },
          { sent: 0, pending: 0 }
        )
      : undefined,
    withDb
      ? safe(async () => {
          if (!(await isPublisher(supabase, userId))) return 0;
          const { count } = await supabase.from("media_publications").select("id", { count: "exact", head: true }).eq("status", "to_publish");
          return count ?? 0;
        }, 0)
      : undefined,
    withDb
      ? safe(
          async () => {
            const [mine, validator] = await Promise.all([getMyExpenses(), getMyValidatorScope()]);
            return { toDeclare: mine.filter((m) => (m.status === "a_declarer" && !m.upcoming) || m.status === "rejected").length, toValidate: validator.pending };
          },
          { toDeclare: 0, toValidate: 0 }
        )
      : undefined,
    withDb
      ? safe(async () => {
          const { count } = await supabase
            .from("team_card_members")
            .select("card_id, team_cards!inner(archived_at)", { count: "exact", head: true })
            .eq("user_id", userId)
            .is("seen_at", null)
            .neq("assigned_by", userId)
            .is("team_cards.archived_at", null);
          return count ?? 0;
        }, 0)
      : undefined,
  ]);

  const body: Partial<AppBadges> = { mails, calendrier, inscription, audiovisuel, frais, trello };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
