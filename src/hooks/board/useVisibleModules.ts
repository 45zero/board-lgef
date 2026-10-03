"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { getMyVisibleModules } from "@/app/actions/module-access";
import { createClient } from "@/lib/supabase/client";

const key = (userId: string) => `lgef-board:modules:${userId}`;

function readCached(userId: string | undefined): Set<string> | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Modules que la personne connectée voit (règles « Accès aux modules »). Dernière liste connue
 * affichée tout de suite (navigateur), puis rafraîchie ; mise à jour en direct quand une règle
 * change. `null` tant que rien n'est connu.
 */
export function useVisibleModules(): Set<string> | null {
  const { user } = useAuth();
  const [visible, setVisible] = useState<Set<string> | null>(() => readCached(user?.id));

  const load = useCallback(() => {
    if (!user) return;
    getMyVisibleModules().then((res) => {
      if (!res.ok) return;
      setVisible(new Set(res.data));
      try {
        localStorage.setItem(key(user.id), JSON.stringify(res.data));
      } catch {
        // stockage indisponible : la liste sera relue au prochain chargement
      }
    });
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(["module_access"], load);

  return visible;
}

/**
 * Tant que la liste n'est pas connue (tout premier chargement) : l'accueil seulement — un module
 * non autorisé ou masqué ne doit jamais apparaître, même un instant.
 */
export const canShowModule = (visible: Set<string> | null, id: string) => (visible ? visible.has(id) : id === "accueil");

/**
 * Modules masqués « en préparation » (module_access.hidden) : seuls les administrateurs et super
 * users les voient ; le rail les signale pour qu'ils sachent qu'ils sont seuls à les voir.
 */
export function useHiddenModules(): Set<string> {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const load = useCallback(() => {
    createClient()
      .from("module_access")
      .select("module_id")
      .eq("hidden", true)
      .then(({ data }) => setHidden(new Set((data ?? []).map((r) => r.module_id))));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(["module_access"], load);
  return hidden;
}
