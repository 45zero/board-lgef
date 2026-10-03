import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { myOpenCards, type MyCard } from "@/lib/board/myCards";
import type { DbEventType } from "@/lib/board/calendar";

export type RecapEvent = { id: string; title: string; start: string; end: string; location: string | null; eventType: DbEventType | null };
export type Recap = { today: RecapEvent[]; cards: MyCard[] };

/**
 * Récapitulatif (colonne de droite) : les événements du jour que la personne peut voir (lus avec sa
 * session, donc selon ses pôles) et ses cartes de l'Espace Team à traiter. Route GET : chargée en
 * parallèle des server actions de l'accueil.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const [{ data: events }, cards] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, start_date, end_date, location, event_type")
      .lt("start_date", end.toISOString())
      .gte("end_date", start.toISOString())
      .not("event_type", "is", null)
      .order("start_date")
      .limit(12),
    myOpenCards(createServiceClient(), userId).catch(() => [] as MyCard[]),
  ]);
  const body: Recap = {
    today: (events ?? []).map((e) => ({ id: e.id, title: e.title, start: e.start_date, end: e.end_date, location: e.location, eventType: e.event_type as DbEventType | null })),
    cards: cards.slice(0, 8),
  };
  return NextResponse.json(body);
}
