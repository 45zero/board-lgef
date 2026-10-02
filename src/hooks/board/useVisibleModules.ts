"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { getMyVisibleModules } from "@/app/actions/module-access";

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

/** Tant que la liste n'est pas connue : tout sauf le centre de publication (restreint par défaut). */
export const canShowModule = (visible: Set<string> | null, id: string) => (visible ? visible.has(id) : id !== "audiovisuel");
