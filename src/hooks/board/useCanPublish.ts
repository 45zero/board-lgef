"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const cache = new Map<string, boolean>();

/**
 * Habilité à publier (administrateur, ou désigné par la règle d'accès du centre de publication) : affiche
 * le centre de publication, ses pastilles et l'option « Publication réseaux » du mobile.
 * `null` tant que ce n'est pas connu.
 */
export function useCanPublish(): boolean | null {
  const { user } = useAuth();
  const [can, setCan] = useState<boolean | null>(() => (user ? (cache.get(user.id) ?? null) : null));

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    createClient()
      .rpc("can_see_module", { uid: user.id, p_module: "audiovisuel" })
      .then(({ data }) => {
        const value = data === true;
        cache.set(user.id, value);
        if (!cancelled) setCan(value);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return can;
}
