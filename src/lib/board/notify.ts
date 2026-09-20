import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type NotificationType = Database["public"]["Enums"]["notification_type"];

/** Envoie une notification in-app via la RPC create_notification déjà déployée sur le projet. */
export async function notifyUsers(
  userIds: (string | null | undefined)[],
  params: { type: NotificationType; title: string; message: string; actorName: string; data?: Record<string, unknown> }
) {
  const supabase = createClient();
  const unique = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  await Promise.all(
    unique.map((uid) =>
      supabase
        .rpc("create_notification", {
          p_user_id: uid,
          p_type: params.type,
          p_title: params.title,
          p_message: params.message,
          p_actor_name: params.actorName,
          p_data: params.data ?? {},
        })
        .then(({ error }) => {
          if (error) console.warn("[notifyUsers]", uid, error);
        })
    )
  );
}

/** Créateur de l'événement + responsable(s) désignés dans l'équipe. */
export async function getEventOwners(eventId: string) {
  const supabase = createClient();
  const [{ data: ev }, { data: team }] = await Promise.all([
    supabase.from("events").select("created_by").eq("id", eventId).maybeSingle(),
    supabase.from("event_team_members").select("user_id").eq("event_id", eventId).eq("role", "responsable"),
  ]);
  return [ev?.created_by, ...(team ?? []).map((t) => t.user_id)].filter((id): id is string => !!id);
}

/** Comptes admin / super_user. */
export async function getAdminIds() {
  const supabase = createClient();
  const { data } = await supabase.from("profiles").select("id").in("role", ["admin", "super_user"]);
  return (data ?? []).map((p) => p.id);
}

export async function getActorName(userId: string) {
  const supabase = createClient();
  const { data } = await supabase.from("profiles").select("first_name, last_name, email").eq("id", userId).maybeSingle();
  return [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim() || data?.email || "";
}
