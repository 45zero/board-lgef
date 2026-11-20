"use client";

import { useState } from "react";
import { useCalendarDefaults, type AccountScope } from "@/hooks/board/useCalendarDefaults";

type ScopeKey = "mailBox" | "dashMailBox" | "googleCalendars" | "dashGoogleCalendars";

/**
 * Boîte(s) affichée(s) quand plusieurs comptes Google sont connectés : « all » ou un compte. Le clic
 * simple change pour la session ; le clic droit enregistre le réglage par défaut sur le compte
 * (profiles.calendar_prefs, voir useCalendarDefaults) pour le retrouver sur l'ordinateur et le mobile.
 * Un seul compte : toujours ce compte. Compte par défaut déconnecté depuis : retour à « all ».
 */
export function useAccountScope(key: ScopeKey, accounts: { id: string }[] | null | undefined) {
  const [defaults, setCalendarDefault] = useCalendarDefaults();
  const [session, setSession] = useState<AccountScope | null>(null);

  const ids = (accounts ?? []).map((a) => a.id);
  const valid = (s: AccountScope | null | undefined): s is AccountScope => !!s && (s === "all" || ids.includes(s));
  const defaultScope: AccountScope = valid(defaults[key]) ? defaults[key] : "all";
  let scope: AccountScope = valid(session) ? session : defaultScope;
  if (ids.length === 1) scope = ids[0];

  const setDefault = (value: AccountScope) => {
    setCalendarDefault(key, value);
    setSession(value);
  };

  return {
    scope,
    setScope: setSession,
    defaultScope,
    setDefault,
    /** Comptes à interroger pour ce choix. */
    accountIds: scope === "all" ? ids : ids.filter((id) => id === scope),
    multiple: ids.length > 1,
  };
}

/** Pastille du nombre de non lus (99+ au-delà), null à zéro. */
export function unreadLabel(n: number | undefined) {
  if (!n) return null;
  return n > 99 ? "99+" : String(n);
}
