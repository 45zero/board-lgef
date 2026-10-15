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
  const userId = user?.id;
  const [can, setCan] = useState<boolean | null>(() => (userId ? (cache.get(userId) ?? null) : null));

  // Par identifiant, pas par objet `user` : la session se rafraîchit d'elle-même (jeton, retour sur
  // l'onglet) et ne doit pas relancer la vérification. Une erreur (base surchargée) garde la valeur
  // connue : sinon l'écran basculait sur « réservé » et fermait le compositeur en pleine saisie.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    createClient()
      .rpc("can_see_module", { uid: userId, p_module: "audiovisuel" })
      .then(({ data, error }) => {
        if (error || cancelled) return;
        const value = data === true;
        cache.set(userId, value);
        setCan(value);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return can;
}
