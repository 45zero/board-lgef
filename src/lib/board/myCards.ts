import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";

// Cartes de l'Espace Team assignées à une personne et pas encore faites (ni archivées, ni dans une
// colonne « terminé ») : « Cartes à traiter » de l'accueil et « Mes cartes » du récapitulatif.

type Service = ReturnType<typeof createServiceClient>;

export type MyCard = {
  id: string;
  title: string;
  boardTitle: string;
  dueAt: string | null;
  eventId: string | null;
  /** Pas encore ouverte depuis son assignation. */
  isNew: boolean;
};

export async function myOpenCards(service: Service, userId: string): Promise<MyCard[]> {
  const { data: links } = await service.from("team_card_members").select("card_id, seen_at").eq("user_id", userId);
  if (!links?.length) return [];
  const seen = new Map(links.map((l) => [l.card_id, l.seen_at]));
  const { data: cards } = await service
    .from("team_cards")
    .select("id, title, due_at, event_id, list_id, board_id")
    .in("id", [...seen.keys()])
    .is("archived_at", null);
  if (!cards?.length) return [];
  const [{ data: lists }, { data: boards }] = await Promise.all([
    service.from("team_lists").select("id, is_done").in("id", [...new Set(cards.map((c) => c.list_id))]),
    service.from("team_boards").select("id, title").in("id", [...new Set(cards.map((c) => c.board_id))]),
  ]);
  const done = new Set((lists ?? []).filter((l) => l.is_done).map((l) => l.id));
  const boardTitle = new Map((boards ?? []).map((b) => [b.id, b.title]));
  return cards
    .filter((c) => !done.has(c.list_id))
    .map((c) => ({ id: c.id, title: c.title, boardTitle: boardTitle.get(c.board_id) ?? "", dueAt: c.due_at, eventId: c.event_id, isNew: !seen.get(c.id) }))
    // Échéance la plus proche d'abord, sans échéance à la fin.
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}
