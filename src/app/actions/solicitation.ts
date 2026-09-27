"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getSolicitations } from "@/lib/board/solicitation";

/** Ids des événements où l'utilisateur connecté est sollicité — filtre « Mes sollicitations » du calendrier. */
export async function getMySolicitedEventIds(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return [];
  const roles = await getSolicitations(createServiceClient(), userId, { includePendingDirector: true, includeProposedCoverage: true });
  return [...roles.keys()];
}
