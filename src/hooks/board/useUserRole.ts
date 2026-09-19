"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Porté (sous-ensemble) de calendrier-lgef/src/hooks/useUserRole.ts — juste les
 * permissions nécessaires à la désignation de couverture média pour l'instant. */
export function useUserRole() {
  const { user } = useAuth();
  const [role, setRole] = useState<string>("user");
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user?.id) {
      setRole("user");
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    setRole(data?.role ?? "user");
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const isAdmin = role === "admin";
  const isSuperUser = role === "super_user" || isAdmin;
  const isOrganizer = role === "organizer" || isSuperUser;

  return { role, loading, isAdmin, isSuperUser, isOrganizer, refetch };
}
