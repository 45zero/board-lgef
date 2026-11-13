import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { done, fail, getFiefActor, type FiefActor } from "@/lib/fief/actor";
import { notifyFief } from "@/lib/fief/notify";
import { getFiefStorage } from "@/lib/fief/storage";

// Fil d'actualités FIEF — écritures (sql/2026-11-13_fief_social.sql) : publier, modifier, supprimer,
// aimer, commenter, signaler. Lectures : fonctions fief_feed / fief_post_comments (côté navigateur).

const uuid = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("post"), body: z.string().max(5000), mediaIds: z.array(uuid).max(6).default([]), asTeam: z.boolean().default(false) }),
  z.object({ action: z.literal("edit"), postId: uuid, body: z.string().max(5000) }),
  z.object({ action: z.literal("delete"), postId: uuid }),
  z.object({ action: z.literal("like"), postId: uuid }),
  z.object({ action: z.literal("comment"), postId: uuid, body: z.string().trim().min(1, "Commentaire vide.").max(2000), asTeam: z.boolean().default(false) }),
  z.object({ action: z.literal("deleteComment"), commentId: uuid }),
  z.object({ action: z.literal("report"), postId: uuid.optional(), commentId: uuid.optional(), messageId: uuid.optional(), reason: z.string().max(1000).default("") }),
]);

const excerpt = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const nameOf = (a: FiefActor) => (a.member ? `${a.member.firstName} ${a.member.lastName}` : "L'équipe FIEF");

/** Publication visible par la personne (masquée : autrice et équipe seulement). */
async function visiblePost(actor: FiefActor, postId: string) {
  const { data } = await createServiceClient().from("fief_posts").select("id, author_id, as_team, body, hidden_at").eq("id", postId).maybeSingle();
  if (!data) return null;
  if (data.hidden_at && !actor.manager && data.author_id !== actor.userId) return null;
  return data;
}

/** Destinataires des signalements : les mêmes que pour les demandes d'adhésion (réglage FIEF, à défaut super admins). */
async function moderatorIds() {
  const service = createServiceClient();
  const { data } = await service.from("fief_settings").select("*").eq("id", true).maybeSingle();
  const ids = data?.request_recipient_ids ?? [];
  if (ids.length) return ids;
  const { data: supers } = await service.from("profiles").select("id").eq("role", "super_user");
  return (supers ?? []).map((p) => p.id);
}

export async function POST(request: Request) {
  const actor = await getFiefActor();
  if (!actor || (!actor.member && !actor.manager)) return fail(403, "Réservé aux membres FIEF.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Requête invalide.");
  const input = parsed.data;
  const service = createServiceClient();

  switch (input.action) {
    case "post": {
      const body = input.body.trim();
      if (!body && !input.mediaIds.length) return fail(400, "Écrivez un message ou ajoutez une photo.");
      if (input.asTeam && !actor.manager) return fail(403, "Réservé à l'équipe FIEF.");
      // Une personne du board sans fiche membre publie forcément au nom de l'équipe.
      const asTeam = actor.manager && (input.asTeam || !actor.member);
      if (input.mediaIds.length) {
        const { data: media } = await service.from("fief_media").select("id").in("id", input.mediaIds).eq("uploader_id", actor.userId).is("post_id", null);
        if ((media ?? []).length !== input.mediaIds.length) return fail(400, "Photo introuvable : renvoyez-la.");
      }
      const { data: post, error } = await service.from("fief_posts").insert({ author_id: actor.userId, as_team: asTeam, body }).select("id").single();
      if (error) return fail(500, "Publication impossible.");
      await Promise.all(input.mediaIds.map((id, position) => service.from("fief_media").update({ post_id: post.id, position }).eq("id", id)));
      if (asTeam) {
        const { data: members } = await service.from("fief_members").select("user_id").eq("status", "active").neq("user_id", actor.userId);
        await notifyFief(
          (members ?? []).map((m) => m.user_id),
          { kind: "post", title: "Nouvelle publication de l'équipe FIEF", body: excerpt(body || "Nouvelles photos"), route: `/?post=${post.id}`, tag: `fief-post-${post.id}` }
        );
      }
      return done({ id: post.id });
    }

    case "edit": {
      const post = await visiblePost(actor, input.postId);
      if (!post || post.author_id !== actor.userId) return fail(403, "Vous ne pouvez modifier que vos publications.");
      const { error } = await service.from("fief_posts").update({ body: input.body.trim(), edited_at: new Date().toISOString() }).eq("id", post.id);
      return error ? fail(500, "Modification impossible.") : done();
    }

    case "delete": {
      const post = await visiblePost(actor, input.postId);
      if (!post || (post.author_id !== actor.userId && !actor.manager)) return fail(403, "Vous ne pouvez supprimer que vos publications.");
      const { data: media } = await service.from("fief_media").select("storage_id").eq("post_id", post.id);
      const { error } = await service.from("fief_posts").delete().eq("id", post.id);
      if (error) return fail(500, "Suppression impossible.");
      const storage = await getFiefStorage();
      if (storage) await Promise.all((media ?? []).map((m) => storage.remove(m.storage_id).catch(() => {})));
      return done();
    }

    case "like": {
      const post = await visiblePost(actor, input.postId);
      if (!post) return fail(404, "Publication introuvable.");
      const { data: existing } = await service.from("fief_reactions").select("post_id").eq("post_id", post.id).eq("user_id", actor.userId).maybeSingle();
      if (existing) await service.from("fief_reactions").delete().eq("post_id", post.id).eq("user_id", actor.userId);
      else await service.from("fief_reactions").insert({ post_id: post.id, user_id: actor.userId });
      const { count } = await service.from("fief_reactions").select("post_id", { count: "exact", head: true }).eq("post_id", post.id);
      return done({ liked: !existing, count: count ?? 0 });
    }

    case "comment": {
      const post = await visiblePost(actor, input.postId);
      if (!post || post.hidden_at) return fail(404, "Publication introuvable.");
      const asTeam = actor.manager && (input.asTeam || !actor.member);
      const { data: comment, error } = await service
        .from("fief_comments")
        .insert({ post_id: post.id, author_id: actor.userId, as_team: asTeam, body: input.body })
        .select("id, created_at")
        .single();
      if (error) return fail(500, "Commentaire impossible.");
      if (post.author_id !== actor.userId && !post.as_team) {
        await notifyFief([post.author_id], {
          kind: "comment",
          title: `${asTeam ? "L'équipe FIEF" : nameOf(actor)} a commenté votre publication`,
          body: excerpt(input.body),
          route: `/?post=${post.id}`,
          tag: `fief-comment-${post.id}`,
        });
      }
      return done({ id: comment.id, createdAt: comment.created_at });
    }

    case "deleteComment": {
      const { data: c } = await service.from("fief_comments").select("id, author_id").eq("id", input.commentId).maybeSingle();
      if (!c || (c.author_id !== actor.userId && !actor.manager)) return fail(403, "Vous ne pouvez supprimer que vos commentaires.");
      const { error } = await service.from("fief_comments").delete().eq("id", c.id);
      return error ? fail(500, "Suppression impossible.") : done();
    }

    case "report": {
      const targets = [input.postId, input.commentId, input.messageId].filter(Boolean);
      if (targets.length !== 1) return fail(400, "Que signalez-vous ?");
      if (input.messageId) {
        const { data: m } = await service.from("fief_messages").select("conversation_id").eq("id", input.messageId).maybeSingle();
        const { data: inConv } = m
          ? await service.from("fief_conversation_members").select("user_id").eq("conversation_id", m.conversation_id).eq("user_id", actor.userId).maybeSingle()
          : { data: null };
        if (!inConv) return fail(404, "Message introuvable.");
      }
      const { error } = await service.from("fief_reports").insert({
        reporter_id: actor.userId,
        post_id: input.postId ?? null,
        comment_id: input.commentId ?? null,
        message_id: input.messageId ?? null,
        reason: input.reason.trim() || null,
      });
      if (error) return fail(500, "Signalement impossible.");
      const ids = await moderatorIds();
      if (ids.length)
        await service.from("notifications").insert(
          ids.map((id) => ({
            user_id: id,
            type: "hateful_comment" as const,
            title: "Signalement FIEF",
            message: `${nameOf(actor)} a signalé ${input.postId ? "une publication" : input.commentId ? "un commentaire" : "un message"} — onglet FIEF → Fil.`,
            data: { app: "fief" },
          }))
        );
      return done();
    }
  }
}
