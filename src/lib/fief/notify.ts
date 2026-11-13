import "server-only";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { sendFiefPush } from "@/lib/fief/push";

// Notifie des membres FIEF : ligne dans la cloche (fief_notifications, sauf bell: false — messages
// privés, qui ont leur propre compteur) et push sur leurs appareils abonnés. Les e-mails restent
// réservés aux événements.

export async function notifyFief(
  userIds: string[],
  n: { kind: "comment" | "message" | "post" | "info"; title: string; body?: string | null; route: string; tag?: string; bell?: boolean }
) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  if (n.bell !== false) {
    const { error } = await createServiceClient()
      .from("fief_notifications")
      .insert(ids.map((user_id) => ({ user_id, kind: n.kind, title: n.title, body: n.body ?? null, route: n.route })));
    if (error) console.warn("[notifyFief]", error.message);
  }
  await sendFiefPush(ids, { title: n.title, body: n.body ?? "", route: n.route, tag: n.tag });
}
