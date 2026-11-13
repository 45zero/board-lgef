import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { done, fail, getFiefActor } from "@/lib/fief/actor";
import { notifyFief } from "@/lib/fief/notify";

// Messagerie privée FIEF (conversations à deux, sql/2026-11-13_fief_social.sql) — écritures :
// envoyer (à une membre ou dans une conversation), marquer comme lu. Réservé aux membres actives.

const uuid = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), conversationId: uuid.optional(), to: uuid.optional(), body: z.string().trim().min(1, "Message vide.").max(4000) }),
  z.object({ action: z.literal("read"), conversationId: uuid }),
]);

export async function POST(request: Request) {
  const actor = await getFiefActor();
  if (!actor?.member) return fail(403, "Réservé aux membres FIEF.");
  const member = actor.member;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Requête invalide.");
  const input = parsed.data;
  const service = createServiceClient();
  const now = new Date().toISOString();

  if (input.action === "read") {
    await service.from("fief_conversation_members").update({ last_read_at: now }).eq("conversation_id", input.conversationId).eq("user_id", actor.userId);
    return done();
  }

  let conversationId = input.conversationId;
  if (!conversationId) {
    if (!input.to || input.to === actor.userId) return fail(400, "Destinataire invalide.");
    const { data: other } = await service.from("fief_members").select("status").eq("user_id", input.to).maybeSingle();
    if (other?.status !== "active") return fail(404, "Cette membre n'est pas disponible.");
    const { data: conv, error } = await service.rpc("fief_open_conversation", { p_me: actor.userId, p_other: input.to });
    if (error || !conv) return fail(500, "Conversation impossible.");
    conversationId = conv as string;
  }

  const { data: participants } = await service.from("fief_conversation_members").select("user_id").eq("conversation_id", conversationId);
  const ids = (participants ?? []).map((p) => p.user_id);
  if (!ids.includes(actor.userId)) return fail(404, "Conversation introuvable.");
  const others = ids.filter((id) => id !== actor.userId);
  const { data: active } = await service.from("fief_members").select("user_id").in("user_id", others).eq("status", "active");
  if (!active?.length) return fail(409, "Cette membre n'est plus disponible.");

  const { data: message, error } = await service
    .from("fief_messages")
    .insert({ conversation_id: conversationId, sender_id: actor.userId, body: input.body })
    .select("id, created_at")
    .single();
  if (error) return fail(500, "Message non envoyé.");
  await Promise.all([
    service.from("fief_conversations").update({ last_message_at: message.created_at }).eq("id", conversationId),
    service.from("fief_conversation_members").update({ last_read_at: message.created_at }).eq("conversation_id", conversationId).eq("user_id", actor.userId),
  ]);
  await notifyFief(
    active.map((a) => a.user_id),
    {
      kind: "message",
      title: `${member.firstName} ${member.lastName}`,
      body: input.body.length > 120 ? `${input.body.slice(0, 119)}…` : input.body,
      route: `/messages?c=${conversationId}`,
      tag: `fief-conv-${conversationId}`,
      bell: false,
    }
  );
  return done({ conversationId, id: message.id, createdAt: message.created_at });
}
