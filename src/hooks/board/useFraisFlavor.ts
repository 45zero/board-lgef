"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { getMyFraisFlavor } from "@/app/actions/module-access";
import { FRAIS_FLAVORS, type FraisFlavor } from "@/lib/board/fraisFlavor";

const key = (userId: string) => `lgef-board:frais-flavor:${userId}`;

function readCached(userId: string | undefined): FraisFlavor | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(key(userId));
    return raw && raw in FRAIS_FLAVORS ? (raw as FraisFlavor) : null;
  } catch {
    return null;
  }
}

/**
 * Nom du module Frais pour la personne connectée (voir fraisFlavor.ts) : dernier connu affiché tout
 * de suite (navigateur), puis vérifié ; « frais » tant que rien n'est connu.
 */
export function useFraisFlavor(): FraisFlavor {
  const { user } = useAuth();
  const [flavor, setFlavor] = useState<FraisFlavor | null>(() => readCached(user?.id));

  const load = useCallback(() => {
    if (!user) return;
    getMyFraisFlavor().then((res) => {
      if (!res.ok) return;
      setFlavor(res.data);
      try {
        localStorage.setItem(key(user.id), res.data);
      } catch {
        // stockage indisponible : relu au prochain chargement
      }
    });
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(["module_access"], load);

  return flavor ?? "frais";
}

/** Nom et sous-titre affichés d'un module : ceux du profil pour Frais, sinon ceux de BOARD_APPS. */
export function useAppLabel() {
  const flavor = useFraisFlavor();
  return useCallback(
    <T extends { id: string; label: string; kicker?: string }>(app: T): { label: string; kicker: string } =>
      app.id === "frais" ? FRAIS_FLAVORS[flavor] : { label: app.label, kicker: app.kicker ?? "" },
    [flavor]
  );
}
