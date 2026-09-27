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
