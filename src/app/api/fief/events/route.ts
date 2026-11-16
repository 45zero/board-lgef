import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { done, fail, getFiefActor } from "@/lib/fief/actor";

// Réponse d'une membre à une invitation FIEF (sql/2026-11-16_fief_evolutions.sql) : participe /
// peut-être / ne participe pas. Seulement pour un événement partagé en « invitation » dont elle fait
// partie du public ; les réponses s'affichent dans la fiche de l'événement (board → onglet FIEF).

const schema = z.object({
  eventId: z.string().uuid(),
  response: z.enum(["yes", "maybe", "no"]).nullable(),
});

export async function POST(request: Request) {
  const actor = await getFiefActor();
  if (!actor?.member) return fail(403, "Réservé aux membres FIEF.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Réponse invalide.");
  const { eventId, response } = parsed.data;
  const service = createServiceClient();

  const { data: share } = await service.from("fief_event_shares").select("mode").eq("event_id", eventId).maybeSingle();
  if (!share) return fail(404, "Événement introuvable.");
  if (share.mode !== "invitation") return fail(400, "Cet événement est une simple information : pas de réponse attendue.");
  const { data: audience } = await service.rpc("fief_event_audience", { p_event_id: eventId });
  if (!((audience ?? []) as { user_id: string }[]).some((p) => p.user_id === actor.userId)) return fail(404, "Événement introuvable.");

  const { error } = response
    ? await service.from("fief_event_responses").upsert({ event_id: eventId, user_id: actor.userId, response, responded_at: new Date().toISOString() }, { onConflict: "event_id,user_id" })
    : await service.from("fief_event_responses").delete().eq("event_id", eventId).eq("user_id", actor.userId);
  return error ? fail(500, "Réponse non enregistrée : réessayez.") : done({ response });
}
