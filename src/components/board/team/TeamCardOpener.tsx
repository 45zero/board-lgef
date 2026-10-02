"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Kanban, Loader2 } from "lucide-react";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useAuth } from "@/contexts/AuthContext";
import { readCache, writeCache } from "@/lib/board/localCache";
import { getTeamWorkspace, listTeamCardsForEvents } from "@/app/actions/team";
import { unwrap } from "@/lib/board/actionResult";
import type { TeamCard, TeamWorkspace } from "@/lib/board/team";
import { TeamCardModal } from "./TeamCardModal";

// Ouverture d'une carte de l'Espace Team en popup, depuis n'importe quel écran (fiche événement,
// calendrier, notifications). Le fournisseur porte l'état ; l'hôte, monté sous l'EventOpenerProvider,
// affiche la fiche par-dessus la fiche événement (z-90 > z-80).

type Ctx = { open: (cardId: string) => void; current: string | null; close: () => void; loadingId: string | null; setLoadingId: (id: string | null) => void };

const TeamCardOpenerContext = createContext<Ctx | null>(null);

export function TeamCardOpenerProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const value = useMemo<Ctx>(
    () => ({ open: (id) => setCurrent(id), current, close: () => setCurrent(null), loadingId, setLoadingId }),
    [current, loadingId]
  );
  return <TeamCardOpenerContext.Provider value={value}>{children}</TeamCardOpenerContext.Provider>;
}

export function useOpenTeamCard() {
  const ctx = useContext(TeamCardOpenerContext);
  if (!ctx) throw new Error("useOpenTeamCard doit être utilisé sous <TeamCardOpenerProvider>.");
  return { open: ctx.open, loadingId: ctx.loadingId };
}

/** Fiche carte en popup — à monter sous l'EventOpenerProvider (la fiche ouvre l'événement lié). */
export function TeamCardOpenerHost() {
  const ctx = useContext(TeamCardOpenerContext);
  const { user } = useAuth();
  // Même cache que l'écran Espace Team : la carte s'affiche sans attendre le réseau.
  const cacheKey = `team:${user?.id ?? ""}`;
  const [ws, setWs] = useState<TeamWorkspace | null>(() => readCache<TeamWorkspace>(cacheKey) ?? null);
  const [error, setError] = useState<string | null>(null);
  const cardId = ctx?.current ?? null;
  const setLoadingId = ctx?.setLoadingId;
  const close = ctx?.close;

  const load = useCallback(async () => {
    try {
      const fresh = unwrap(await getTeamWorkspace());
      setWs(fresh);
      writeCache(cacheKey, fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Carte indisponible.");
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!cardId) return;
    setLoadingId?.(cardId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load().finally(() => setLoadingId?.(null));
  }, [cardId, load, setLoadingId]);

  useLiveRefresh(["team_cards", "team_card_members", "team_checklist_items", "team_card_comments", "team_lists"], () => cardId && void load(), 500);

  const toast = useCallback((m: string) => {
    setError(m);
    window.setTimeout(() => setError(null), 5000);
  }, []);
  const patchLocal = useCallback((id: string, patch: Partial<TeamCard>) => {
    setWs((prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : prev));
  }, []);

  // Carte introuvable une fois l'espace chargé (supprimée, ou non accessible) : on prévient et on ferme.
  const card = cardId ? ws?.cards.find((c) => c.id === cardId) : undefined;
  useEffect(() => {
    if (cardId && ws && !card && !ctx?.loadingId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- message ponctuel
      toast("Cette carte n'existe plus ou ne vous est pas accessible.");
      close?.();
    }
  }, [cardId, ws, card, ctx?.loadingId, toast, close]);

  return (
    <>
      {card && ws && close && (
        <TeamCardModal card={card} ws={ws} zClass="z-[90]" onClose={close} onLocalPatch={patchLocal} onRefresh={() => void load()} onError={toast} />
      )}
      {error && <div className="fixed bottom-6 right-6 z-[95] max-w-sm rounded-btn bg-ink px-4 py-3 text-sm text-white shadow-card">{error}</div>}
    </>
  );
}

/* ---------- Cartes liées aux événements ---------- */

/** Cartes visibles liées à ces événements, tenues à jour en direct. */
export function useEventTeamCards(eventIds: string[]) {
  const [map, setMap] = useState<Record<string, { id: string; title: string }[]>>({});
  const key = [...eventIds].sort().join(",");
  const load = useCallback(async () => {
    const res = await listTeamCardsForEvents(key ? key.split(",") : []);
    if (res.ok) setMap(res.data);
  }, [key]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load();
  }, [load]);
  useLiveRefresh(["team_cards"], () => void load(), 800);
  return map;
}

/** Petit pictogramme « dans une carte » d'un événement du calendrier ; ouvre la carte. */
export function TeamCardGlyph({ cards, size = 10, color }: { cards: { id: string; title: string }[] | undefined; size?: number; color?: string }) {
  const { open } = useOpenTeamCard();
  if (!cards?.length) return null;
  const trigger = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    open(cards[0].id);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={trigger}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && trigger(e)}
      title={`Espace Team : ${cards.map((c) => `« ${c.title} »`).join(", ")} — ouvrir la carte`}
      aria-label="Ouvrir la carte de l'Espace Team"
      className="inline-flex shrink-0 cursor-pointer items-center rounded-[3px] hover:bg-black/10"
      style={{ color }}
    >
      <Kanban size={size} strokeWidth={2.5} />
      {cards.length > 1 && <span className="ml-px text-[8px] font-bold">{cards.length}</span>}
    </span>
  );
}

/** Section « Cartes Espace Team » de la fiche événement. */
export function EventTeamCards({ eventId }: { eventId: string }) {
  const map = useEventTeamCards([eventId]);
  const { open, loadingId } = useOpenTeamCard();
  const cards = map[eventId];
  if (!cards?.length) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Cartes Espace Team</div>
      <div className="flex flex-wrap gap-1.5">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => open(c.id)}
            className="flex max-w-full items-center gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:border-link hover:bg-sel-bg hover:text-link"
          >
            {loadingId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Kanban size={12} />}
            <span className="truncate">{c.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
