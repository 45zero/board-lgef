"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { listMyEvents } from "@/app/actions/calendar";
import { readCache, writeCache } from "@/lib/board/localCache";
import { useAccountScope } from "@/hooks/board/useAccountScope";
import { isCalendarAccount } from "@/lib/board/accountKinds";

// Accueil — agendas des comptes connectés (Google, iCloud) mêlés au programme « Aujourd'hui / Cette
// semaine », comme les mails : pastilles « Tous / compte » quand il y en a plusieurs, clic droit =
// agenda affiché par défaut. Les copies Google des événements du board (boardEventId) sont écartées :
// l'événement du board est déjà dans le programme.

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
export type AgendaEvent = Awaited<ReturnType<typeof listMyEvents>>[number] & { accountId: string };

/** Même période que le programme du tableau de bord (buildDashboard) : aujourd'hui, ou jusqu'à dimanche inclus. */
function periodRange(period: "day" | "week") {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from);
  if (period === "day") to.setDate(to.getDate() + 1);
  else to.setDate(to.getDate() + 7 - ((from.getDay() + 6) % 7));
  return { from, to };
}

export function useDashboardAgenda(period: "day" | "week", reloadKey: number) {
  const [accounts, setAccounts] = useState<Account[]>(() => (readCache<Account[]>("mail:accounts") ?? []).filter(isCalendarAccount));
  const box = useAccountScope("dashGoogleCalendars", accounts);
  const [events, setEvents] = useState<AgendaEvent[]>(() => readCache<AgendaEvent[]>(`dashboard:agenda:${period}`) ?? []);

  useEffect(() => {
    let cancelled = false;
    getMyConnectedAccounts()
      .then((accs) => {
        if (cancelled) return;
        writeCache("mail:accounts", accs);
        setAccounts(accs.filter(isCalendarAccount));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const idsKey = accounts.map((a) => a.id).join(",");
  const load = useCallback(async () => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (!ids.length) return [] as AgendaEvent[];
    const { from, to } = periodRange(period);
    const lists = await Promise.all(
      ids.map((accountId) =>
        listMyEvents(accountId, { timeMin: from.toISOString(), timeMax: to.toISOString() })
          .then((items) => items.filter((e) => !e.boardEventId).map((e) => ({ ...e, accountId })))
          .catch(() => [] as AgendaEvent[])
      )
    );
    return lists.flat();
  }, [idsKey, period]);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      void load().then((all) => {
        if (cancelled) return;
        setEvents(all);
        writeCache(`dashboard:agenda:${period}`, all);
      });
    run();
    const timer = window.setInterval(run, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load, period, reloadKey]);

  // Tous les comptes ou un seul ; compte déconnecté depuis la mise en cache : écarté.
  const visible = events.filter((e) => box.accountIds.includes(e.accountId));
  return { accounts, box, events: visible, reload: () => void load().then(setEvents) };
}
