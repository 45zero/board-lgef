"use client";

// Panneau « Espace Team » de l'accueil : mes tableaux (le principal d'abord, puis les autres et ceux
// partagés avec moi), un volet par tableau, qu'on fait défiler latéralement. Dans chaque volet, les
// listes du tableau avec les mêmes cartes « mission » que l'Espace Team (statut, relances) et le
// bouton « Cartes sans mission » par liste (même réglage par défaut que l'Espace Team).

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Kanban, Plus } from "lucide-react";
import { getTeamWorkspace } from "@/app/actions/team";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { PANEL, PanelHead } from "@/components/board/dashboard/Panel";
import { MissionFilter } from "@/components/board/team/MissionFilter";
import { MyCardTile, useCardActions } from "@/components/board/team/MissionCard";
import { useOpenTeamCard } from "@/components/board/team/TeamCardOpener";
import { readOnlyMineDefaults, saveOnlyMineDefault, toMyCard } from "@/components/board/team/boardCards";
import { useAuth } from "@/contexts/AuthContext";
import { readCache, writeCache } from "@/lib/board/localCache";
import type { TeamBoard, TeamWorkspace } from "@/lib/board/team";

const LIVE = ["team_boards", "team_lists", "team_cards", "team_card_members", "team_checklist_items"] as const;

export function TeamBoardsPanel({ onOpenSpace }: { onOpenSpace?: () => void }) {
  const { user } = useAuth();
  // Même cache que l'écran Espace Team : affichage immédiat, puis données fraîches.
  const cacheKey = `team:${user?.id ?? ""}`;
  const [ws, setWs] = useState<TeamWorkspace | null>(() => readCache<TeamWorkspace>(cacheKey) ?? null);
  const [dataAt, setDataAt] = useState(0);
  const load = useCallback(async () => {
    const startedAt = Date.now();
    const res = await getTeamWorkspace().catch(() => null);
    if (!res?.ok) return;
    setWs(res.data);
    setDataAt(startedAt);
    writeCache(cacheKey, res.data);
  }, [cacheKey]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load();
  }, [load]);
  useLiveRefresh([...LIVE], () => void load(), 500);

  const actions = useCardActions(dataAt, () => void load());
  const { open, create } = useOpenTeamCard();
  const [onlyMineDefaults, setOnlyMineDefaults] = useState(readOnlyMineDefaults);
  const [onlyMineNow, setOnlyMineNow] = useState<Record<string, boolean>>({});
  const [doneOpen, setDoneOpen] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  if (!ws) return null;
  const me = ws.meId;
  const peopleById = new Map(ws.people.map((p) => [p.id, p]));
  const listsById = new Map(ws.boards.flatMap((b) => b.lists).map((l) => [l.id, l]));
  const isDone = (listId: string) => !!listsById.get(listId)?.isDone;
  const live = ws.cards.filter((c) => !c.archivedAt && !actions.archived.has(c.id));
  const assigned = live.filter((c) => c.members.some((m) => m.userId === me) && !isDone(c.listId));
  // Tableaux : les miens (le principal d'abord), puis ceux des autres où j'ai une mission.
  const boards: TeamBoard[] = [
    ...ws.boards.filter((b) => b.ownerId === me),
    ...ws.boards.filter((b) => b.ownerId !== me && assigned.some((c) => c.boardId === b.id)),
  ];
  const current = Math.min(index, Math.max(0, boards.length - 1));
  const onlyMineOf = (listId: string) => onlyMineNow[listId] ?? onlyMineDefaults[listId] ?? false;
  const goTo = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setIndex(i);
  };

  return (
    <section className={`min-w-0 ${PANEL}`}>
      <PanelHead
        icon={<Kanban size={14} />}
        title="Espace Team"
        count={assigned.length}
        right={
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={create}
              title="Nouvelle carte"
              aria-label="Nouvelle carte"
              className="flex h-6 w-6 items-center justify-center rounded-btn bg-navy text-white transition hover:opacity-90"
            >
              <Plus size={14} strokeWidth={2.5} />
            </button>
            {onOpenSpace && (
              <button onClick={onOpenSpace} className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-link hover:underline md:text-xs">
                Ouvrir <ChevronRight size={12} />
              </button>
            )}
          </div>
        }
      />
      {boards.length === 0 ? (
        <div className="rounded-card bg-panel p-4 text-sm text-ink-3">Aucun tableau pour le moment — « + » pour créer une carte.</div>
      ) : (
        <>
          {/* Noms des tableaux : clic = aller au tableau ; on peut aussi faire défiler les volets. */}
          <div className="-mt-0.5 mb-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => goTo(Math.max(0, current - 1))}
              disabled={current === 0}
              aria-label="Tableau précédent"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-hover disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {boards.map((b, i) => {
                const mine = assigned.filter((c) => c.boardId === b.id).length;
                const owner = b.ownerId !== me ? peopleById.get(b.ownerId)?.name.split(" ")[0] : null;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => goTo(i)}
                    title={owner ? `Tableau de ${owner}` : undefined}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${i === current ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:text-ink"}`}
                  >
                    <span className="max-w-[140px] truncate">{b.title}</span>
                    {owner && <span className="font-medium opacity-70">· {owner}</span>}
                    {mine > 0 && <span className="opacity-70">{mine}</span>}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => goTo(Math.min(boards.length - 1, current + 1))}
              disabled={current >= boards.length - 1}
              aria-label="Tableau suivant"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-hover disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          {/* Un volet par tableau, défilement latéral avec aimantation. */}
          <div
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
              if (i !== current) setIndex(i);
            }}
            className="flex snap-x snap-mandatory items-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {boards.map((b) => (
              <div key={b.id} className="w-full shrink-0 snap-start space-y-3">
                {b.lists.map((list) => {
                  const all = live.filter((c) => c.listId === list.id).sort((x, y) => x.position - y.position);
                  const hide = onlyMineOf(list.id);
                  const cards = hide ? all.filter((c) => c.members.some((m) => m.userId === me)) : all;
                  if (list.isDone) {
                    // Colonne « terminé » : repliée, on l'ouvre au besoin.
                    if (!all.length) return null;
                    return (
                      <div key={list.id}>
                        <button
                          type="button"
                          onClick={() => setDoneOpen((d) => ({ ...d, [list.id]: !d[list.id] }))}
                          className="flex items-center gap-1.5 text-[11px] font-bold text-ink-4 hover:text-ink-2"
                        >
                          <ChevronDown size={12} className={doneOpen[list.id] ? "" : "-rotate-90"} />
                          <span className="h-1.5 w-1.5 rounded-full bg-good" /> {list.title} · {all.length}
                        </button>
                        {doneOpen[list.id] && (
                          <div className="mt-1.5 grid gap-2">
                            {all.map((c) => (
                              <MyCardTile key={c.id} card={toMyCard(c, ws, peopleById, "")} actions={actions} showMine done onOpen={() => open(c.id)} action={null} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={list.id}>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cards.length ? "bg-navy" : "bg-ink-4"}`} />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-extrabold text-ink">{list.title}</span>
                        <span className="font-mono text-[10px] text-ink-4">{cards.length}</span>
                        <MissionFilter
                          hide={hide}
                          hideByDefault={onlyMineDefaults[list.id] ?? false}
                          onToggle={() => setOnlyMineNow((m) => ({ ...m, [list.id]: !hide }))}
                          onMakeDefault={(v) => {
                            setOnlyMineNow((m) => ({ ...m, [list.id]: v }));
                            setOnlyMineDefaults((d) => ({ ...d, [list.id]: v }));
                            saveOnlyMineDefault(list.id, v);
                          }}
                        />
                      </div>
                      {cards.length ? (
                        <div className="grid gap-2">
                          {cards.map((c) => (
                            <MyCardTile key={c.id} card={toMyCard(c, ws, peopleById, "")} actions={actions} showMine onOpen={() => open(c.id)} />
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-card bg-panel px-3 py-2 text-[11px] text-ink-4">{hide && all.length ? "Aucune mission pour vous ici." : "Aucune carte."}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
