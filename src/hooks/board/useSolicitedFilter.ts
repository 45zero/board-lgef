"use client";

import { useState } from "react";
import { useCalendarDefaults } from "@/hooks/board/useCalendarDefaults";

/**
 * Filtre « Uniquement où je suis sollicité » du calendrier (ordinateur et mobile). Le réglage par
 * défaut (clic droit sur le bonhomme) est celui du compte, repris sur le mobile ; le clic simple
 * n'agit que sur la session.
 */
export function useSolicitedFilter(): [boolean, (value: boolean) => void, boolean, (value: boolean) => void] {
  const [defaults, setCalendarDefault] = useCalendarDefaults();
  const [session, setSession] = useState<boolean | null>(null);
  const setDefault = (value: boolean) => {
    setCalendarDefault("mine", value);
    setSession(value);
  };
  return [session ?? defaults.mine, setSession, defaults.mine, setDefault];
}
