import "server-only";

/** Petites icônes de notification dessinées dans l'appli (android/app/src/main/res/drawable/ic_stat_*). */
export type PushIcon = "ic_stat_gmail" | "ic_stat_publication" | "ic_stat_team";

/**
 * Push vers les téléphones d'un utilisateur (jetons fcm_tokens) via la fonction Supabase send_push_v1
 * (dépôt calendrier-lgef). `channel` : canal Android (« mail » pour les mails, sinon par défaut) ;
 * `icon` : petite icône et teinte de la notification ; `data.route` : écran ouvert au toucher.
 */
export async function sendPush(params: {
  userId: string;
  title: string;
  body: string;
  type: string;
  channel?: "mail";
  icon?: PushIcon;
  data?: Record<string, string>;
}): Promise<boolean> {
  const functionsUrl = (process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL || `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`).replace(/\/+$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) return false;
  try {
    const res = await fetch(`${functionsUrl}/send_push_v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({
        user_id: params.userId,
        title: params.title,
        body: params.body,
        type: params.type,
        data: params.data ?? {},
        ...(params.channel ? { channel_id: params.channel } : {}),
        ...(params.icon ? { icon: params.icon } : {}),
      }),
    });
    return res.ok;
  } catch (e) {
    console.error("[sendPush]", e);
    return false;
  }
}
