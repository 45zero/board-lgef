import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Qui appelle une route /api/fief/* : membre FIEF active et/ou équipe FIEF du board (module « fief »).
// Les routes /api/fief/* sont les seules ouvertes aux comptes FIEF (src/proxy.ts) ; chacune vérifie ici.

export interface FiefActor {
  userId: string;
  /** Membre active (peut publier, commenter, écrire). */
  member: { firstName: string; lastName: string; functions: string[]; clubNumber: string | null } | null;
  /** Équipe FIEF (modération, publication « Équipe FIEF »). */
  manager: boolean;
}

export async function getFiefActor(): Promise<FiefActor | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const [{ data: m }, { data: manager }] = await Promise.all([
    createServiceClient().from("fief_members").select("first_name, last_name, status, functions, club_number").eq("user_id", userId).maybeSingle(),
    supabase.rpc("fief_is_manager"),
  ]);
  return {
    userId,
    member: m?.status === "active" ? { firstName: m.first_name, lastName: m.last_name, functions: m.functions ?? [], clubNumber: m.club_number } : null,
    manager: manager === true,
  };
}

export const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
export const done = <T extends object>(data: T = {} as T) => NextResponse.json({ ok: true, ...data });
