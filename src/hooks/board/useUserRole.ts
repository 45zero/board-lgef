"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Porté (sous-ensemble) de calendrier-lgef/src/hooks/useUserRole.ts — juste les
 * permissions nécessaires à la désignation de couverture média pour l'instant. */
export function useUserRole() {
  const { user } = useAuth();
  const [role, setRole] = useState<string>("user");
  const [isTechSalarie, setIsTechSalarie] = useState(false);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user?.id) {
      setRole("user");
      setIsTechSalarie(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const [{ data: profile }, { data: specialty }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).single(),
      supabase
        .from("profile_specialties")
        .select("specialties!inner(slug)")
        .eq("user_id", user.id)
        .eq("specialties.slug", "tech-salarie")
        .maybeSingle(),
    ]);
    setRole(profile?.role ?? "user");
    setIsTechSalarie(!!specialty);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const isAdmin = role === "admin";
  const isSuperUser = role === "super_user" || isAdmin;
  const isOrganizer = role === "organizer" || isSuperUser;
  // Réseau salarié — peut voir/assigner n'importe quelle demande de couverture (cf. policies RLS covreq_*).
  const canAssignCoverage = isSuperUser || isTechSalarie;

  return { role, loading, isAdmin, isSuperUser, isOrganizer, isTechSalarie, canAssignCoverage, refetch };
}
