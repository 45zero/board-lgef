"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { buildDashboard, type Dashboard } from "@/lib/board/dashboardCore";

export type { Dashboard, DashboardAction, DashboardActionItem, ProgrammeItem } from "@/lib/board/dashboardCore";

/** Tableau de bord de l'utilisateur connecté (voir src/lib/board/dashboardCore.ts). */
export async function getDashboard(period: "day" | "week"): Promise<Dashboard> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return buildDashboard(createServiceClient(), userId, period);
}

/**
 * Frais à déclarer : « auto » (les événements où je suis sollicité arrivent d'office dans Mes actions et
 * Mes frais) ou « manuel » (je saisis mes frais et les rattache moi-même). Réglage de chacun, pour soi.
 */
export async function setFraisDeclarationMode(mode: "auto" | "manuel"): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "Non authentifié" };
  if (mode !== "auto" && mode !== "manuel") return { error: "Mode inconnu" };
  const service = createServiceClient();
  const { data, error: readError } = await service.from("profiles").select("notification_prefs").eq("id", userId).single();
  if (readError) return { error: readError.message };
  const prefs = (data?.notification_prefs ?? {}) as Record<string, unknown>;
  const { error } = await service.from("profiles").update({ notification_prefs: { ...prefs, frais_declaration: mode } as never }).eq("id", userId);
  return { error: error?.message ?? null };
}
