"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const cache = new Map<string, boolean>();

/**
 * Habilité à publier (administrateur ou personne désignée dans le centre de publication) : affiche
 * le centre de publication, ses pastilles et l'option « Publication réseaux » du mobile.
 * `null` tant que ce n'est pas connu.
 */
export function useCanPublish(): boolean | null {
  const { user } = useAuth();
  const [can, setCan] = useState<boolean | null>(() => (user ? (cache.get(user.id) ?? null) : null));

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).single(),
      supabase.from("board_settings").select("publisher_ids").eq("id", true).single(),
    ]).then(([{ data: profile }, { data: settings }]) => {
      const value = profile?.role === "admin" || profile?.role === "super_user" || (settings?.publisher_ids ?? []).includes(user.id);
      cache.set(user.id, value);
      if (!cancelled) setCan(value);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return can;
}
