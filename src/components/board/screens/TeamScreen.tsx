"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Inbox, Kanban, MoreHorizontal, Plus, Search, Users, X } from "lucide-react";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useAuth } from "@/contexts/AuthContext";
import { readCache, writeCache } from "@/lib/board/localCache";
import { unwrap } from "@/lib/board/actionResult";
import {
  createTeamBoard,
  createTeamCard,
  createTeamList,
  deleteTeamBoard,
  deleteTeamList,
  getTeamWorkspace,
  moveTeamCard,
  renameTeamBoard,
  reorderTeamLists,
  updateTeamCard,
  deleteTeamCard,
  updateTeamList,
} from "@/app/actions/team";
import { TEAM_COLORS, isCardDone, type TeamBoard, type TeamCard, type TeamList, type TeamPerson, type TeamWorkspace } from "@/lib/board/team";
import { CardShortcut, type CardShortcutAction, Avatar, CardTile, ChecklistChip, DueChip, EventChip, Popover } from "@/components/board/team/TeamUi";
import { TeamCardModal } from "@/components/board/team/TeamCardModal";
import { NewCardDialog } from "@/components/board/team/NewCardDialog";

// Espace Team : chacun organise ses tableaux ; une carte assignée reste sur le tableau de son
// créateur et « atterrit » dans Mes cartes de chaque assigné. La section Équipe montre, personne
// par personne, les cartes qui lui sont assignées (celles que l'on a le droit de voir : les siennes,
// celles qu'on a créées, celles de ses équipiers quand on est leur N+1, tout pour un admin).

type View = { kind: "mine" } | { kind: "board"; id: string } | { kind: "person"; id: string };

const LIVE = ["team_boards", "team_lists", "team_cards", "team_card_members", "team_checklist_items", "team_card_comments"] as const;

const section = "px-4 pb-1.5 pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4";
const navItem = (active: boolean) =>
  `relative flex w-full items-center gap-2.5 rounded-btn px-3 py-2 text-left text-[13px] ${
    active ? "bg-sel-bg font-bold text-ink before:absolute before:-left-2 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-red" : "text-ink-2 hover:bg-hover"
  }`;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** `mobile` : appli mobile — sections en pastilles qui défilent, une colonne de tableau par écran. */
export function TeamScreen({ mobile = false }: { mobile?: boolean } = {}) {
  const { user } = useAuth();
  // Dernier état connu affiché tout de suite (navigateur), puis remplacé par le frais.
  const cacheKey = `team:${user?.id ?? ""}`;
  const [ws, setWs] = useState<TeamWorkspace | null>(() => readCache<TeamWorkspace>(cacheKey) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "mine" });
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [newCardFor, setNewCardFor] = useState<{ personId?: string; boardId?: string; listId?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = unwrap(await getTeamWorkspace());
      setWs(fresh);
      writeCache(cacheKey, fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [cacheKey]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial, l'état n'est posé qu'à la réponse
    void load();
  }, [load]);
  useLiveRefresh([...LIVE], () => void load(), 500);

  const toast = useCallback((message: string) => {
    setError(message);
    window.setTimeout(() => setError(null), 5000);
  }, []);

  const patchLocal = useCallback((cardId: string, patch: Partial<TeamCard>) => {
    setWs((prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) } : prev));
  }, []);

  const derived = useMemo(() => {
    if (!ws) return null;
    const peopleById = new Map(ws.people.map((p) => [p.id, p]));
    const listsById = new Map(ws.boards.flatMap((b) => b.lists).map((l) => [l.id, l]));
    const boardsById = new Map(ws.boards.map((b) => [b.id, b]));
    const myBoards = ws.boards.filter((b) => b.ownerId === ws.meId);
    const assignedTo = (uid: string) => ws.cards.filter((c) => c.members.some((m) => m.userId === uid));
    const active = (cards: TeamCard[]) => cards.filter((c) => !isCardDone(c, listsById));
    const mine = assignedTo(ws.meId);
    const unseen = mine.filter((c) => !c.archivedAt && c.members.some((m) => m.userId === ws.meId && !m.seenAt && m.assignedBy !== ws.meId));
    // Équipe : mes équipiers (je suis leur N+1), puis toute personne dont je vois au moins une carte.
    const reports = ws.people.filter((p) => p.managerId === ws.meId && p.id !== ws.meId);
    const withCards = ws.people.filter((p) => p.id !== ws.meId && p.managerId !== ws.meId && assignedTo(p.id).length > 0);
    const team = [...reports, ...withCards].map((p) => ({ person: p, isReport: p.managerId === ws.meId, active: active(assignedTo(p.id)).length }));
    return { peopleById, listsById, boardsById, myBoards, assignedTo, active, mine, unseen, team, me: peopleById.get(ws.meId) };
  }, [ws]);

  if (!ws || !derived) {
    return (
      <div className="flex h-full items-center justify-center rounded-panel border border-line bg-card text-sm text-ink-4">
        {error ?? "Chargement de l'Espace Team…"}
      </div>
    );
  }

  const { peopleById, listsById, boardsById, myBoards, assignedTo, active, mine, unseen, team, me } = derived;
  const currentBoard = view.kind === "board" ? boardsById.get(view.id) : undefined;
  const currentPerson = view.kind === "person" ? peopleById.get(view.id) : undefined;
  // Vue disparue (tableau supprimé) : retour à Mes cartes.
  if ((view.kind === "board" && !currentBoard) || (view.kind === "person" && !currentPerson)) queueMicrotask(() => setView({ kind: "mine" }));

  const needle = query.trim().toLowerCase();
  const matches = (c: TeamCard) => !needle || c.title.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle) || c.event?.title.toLowerCase().includes(needle);
  const openCard = ws.cards.find((c) => c.id === openCardId);
  const manager = me?.managerId ? peopleById.get(me.managerId) : undefined;
  const dueToday = active(mine).filter((c) => c.dueAt && new Date(c.dueAt).toDateString() === new Date().toDateString()).length;

  let kicker = "Espace Team · Mes cartes";
  let title = "Mes cartes";
  let subtitle = `${active(mine).length} carte${active(mine).length > 1 ? "s" : ""} vous ${active(mine).length > 1 ? "sont assignées" : "est assignée"}${
    dueToday ? ` · ${dueToday} arrive${dueToday > 1 ? "nt" : ""} à échéance aujourd'hui` : ""
  }.`;
  if (currentBoard) {
    kicker = "Espace Team · Tableau";
    title = currentBoard.title;
    const n = ws.cards.filter((c) => c.boardId === currentBoard.id && !c.archivedAt).length;
    subtitle = `${n} carte${n > 1 ? "s" : ""} · glissez une carte d'une colonne à l'autre pour la faire avancer.`;
  } else if (currentPerson) {
    kicker = "Espace Team · Équipe";
    title = currentPerson.name;
    const n = active(assignedTo(currentPerson.id)).length;
    const mgr = currentPerson.managerId ? peopleById.get(currentPerson.managerId) : undefined;
    subtitle = `${n} carte${n > 1 ? "s" : ""} en cours${mgr ? ` · N+1 : ${mgr.name}` : ""}.`;
  }

  /** « Archiver » : la carte va dans la colonne Terminé de son tableau (archivée s'il n'y en a pas). */
  const finishCard = (card: TeamCard) => {
    const doneList = boardsById.get(card.boardId)?.lists.find((l) => l.isDone);
    const after = (r: { ok: boolean; error?: string }) => {
      if (!r.ok) toast(r.error ?? "Archivage impossible.");
      else toast(`« ${card.title} » rangée dans Terminé.`);
      void load();
    };
    if (doneList) {
      const position = Math.max(0, ...ws.cards.filter((c) => c.listId === doneList.id).map((c) => c.position)) + 1000;
      patchLocal(card.id, { listId: doneList.id, position });
      void moveTeamCard(card.id, doneList.id, position).then(after);
    } else {
      patchLocal(card.id, { archivedAt: new Date().toISOString() });
      void updateTeamCard(card.id, { archived: true }).then(after);
    }
  };
  /** « Supprimer » une carte terminée : créateur, propriétaire du tableau ou administrateur. */
  const deleteCard = (card: TeamCard) => {
    if (!window.confirm(`Supprimer définitivement « ${card.title} » ?`)) return;
    setWs((prev) => (prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== card.id) } : prev));
    void deleteTeamCard(card.id).then((r) => {
      if (!r.ok) toast(r.error);
      else toast(`« ${card.title} » supprimée.`);
      void load();
    });
  };
  const canDeleteCard = (card: TeamCard) => card.createdBy === ws.meId || boardsById.get(card.boardId)?.ownerId === ws.meId || !!ws.isAdmin;
  const shortcutFor = (card: TeamCard): CardShortcutAction | undefined =>
    isCardDone(card, listsById)
      ? canDeleteCard(card)
        ? { kind: "delete", onClick: () => deleteCard(card) }
        : undefined
      : { kind: "archive", onClick: () => finishCard(card) };
  const newCard = () => setNewCardFor(currentPerson ? { personId: currentPerson.id } : currentBoard ? { boardId: currentBoard.id } : {});
  const content = currentBoard ? (
    <BoardView
      compact={mobile}
      board={currentBoard}
      cards={ws.cards.filter((c) => c.boardId === currentBoard.id && matches(c))}
      ws={ws}
      peopleById={peopleById}
      listsById={listsById}
      onOpen={setOpenCardId}
      onMoveLocal={(id, listId, position) => patchLocal(id, { listId, position })}
      onChanged={load}
      onError={toast}
      shortcutFor={shortcutFor}
    />
  ) : (
    <CardInbox
      compact={mobile}
      shortcutFor={shortcutFor}
      cards={(currentPerson ? assignedTo(currentPerson.id) : mine).filter(matches)}
      personId={currentPerson?.id ?? ws.meId}
      isMe={!currentPerson}
      ws={ws}
      peopleById={peopleById}
      listsById={listsById}
      boardsById={boardsById}
      onOpen={setOpenCardId}
    />
  );
  const overlays = (
    <>
      {openCard && (
        <TeamCardModal card={openCard} ws={ws} onClose={() => setOpenCardId(null)} onLocalPatch={patchLocal} onRefresh={() => void load()} onError={toast} />
      )}
      {newCardFor && (
        <NewCardDialog
          ws={ws}
          myBoards={myBoards}
          initial={newCardFor}
          onClose={() => setNewCardFor(null)}
          onCreated={async (id) => {
            setNewCardFor(null);
            await load();
            setOpenCardId(id);
          }}
          onError={toast}
        />
      )}
      {error && ws && (
        <div className={`fixed z-[90] max-w-sm rounded-btn bg-ink px-4 py-3 text-sm text-white shadow-card ${mobile ? "bottom-24 left-3 right-3" : "bottom-6 right-6"}`}>{error}</div>
      )}
    </>
  );

  if (mobile) {
    const chip = (active: boolean) =>
      `flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${active ? "bg-navy text-white" : "bg-subtle text-ink-2"}`;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 space-y-2 border-b border-line bg-card px-3 pb-2.5 pt-3">
          {/* Sections : mes cartes, mes tableaux, mon équipe (la barre latérale de l'ordinateur). */}
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3">
            <button onClick={() => setView({ kind: "mine" })} className={chip(view.kind === "mine")}>
              <Inbox size={13} /> Mes cartes
              {unseen.length > 0 ? (
                <span className="rounded-full bg-red px-1.5 text-[10px] font-bold text-white">{unseen.length}</span>
              ) : (
                <span className="opacity-70">{active(mine).length}</span>
              )}
            </button>
            {myBoards.map((b) => (
              <button key={b.id} onClick={() => setView({ kind: "board", id: b.id })} className={chip(view.kind === "board" && view.id === b.id)}>
                <Kanban size={13} /> <span className="max-w-[140px] truncate">{b.title}</span>
              </button>
            ))}
            <button
              onClick={async () => {
                const t = window.prompt("Nom du nouveau tableau")?.trim();
                if (!t) return;
                try {
                  const id = unwrap(await createTeamBoard(t));
                  await load();
                  setView({ kind: "board", id });
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Création impossible.");
                }
              }}
              className={`${chip(false)} border border-dashed border-line bg-transparent`}
              aria-label="Nouveau tableau"
            >
              <Plus size={13} /> Tableau
            </button>
            {team.map(({ person }) => (
              <button key={person.id} onClick={() => setView({ kind: "person", id: person.id })} className={chip(view.kind === "person" && view.id === person.id)}>
                <Avatar person={person} size={18} /> {person.name.split(" ")[0]}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {currentBoard ? (
              <div className="min-w-0 flex-1 [&_h1]:text-lg [&_input]:text-lg">
                <BoardTitle board={currentBoard} onError={toast} onChanged={load} canDelete={myBoards.length > 1} onDeleted={() => setView({ kind: "mine" })} />
              </div>
            ) : (
              <p className="min-w-0 flex-1 truncate text-xs text-ink-3">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-btn border border-line bg-panel px-3 py-2">
              <Search size={14} className="shrink-0 text-ink-4" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une carte…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Effacer">
                  <X size={13} className="text-ink-4" />
                </button>
              )}
            </div>
            <button onClick={newCard} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-red text-white shadow-btn-red" aria-label="Nouvelle carte">
              <Plus size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pb-20">{content}</div>
        {overlays}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Barre latérale */}
      <aside className="flex w-[240px] shrink-0 flex-col rounded-panel border border-line bg-card">
        <div className="flex items-center gap-2.5 px-4 pt-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-btn bg-subtle font-mono text-[11px] font-bold text-ink-2">ET</span>
          <div>
            <p className="text-[15px] font-extrabold leading-tight text-ink">Espace Team</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-4">Tableaux</p>
          </div>
        </div>
        <div className="px-3 pt-4">
          <button
            onClick={() => setNewCardFor(currentPerson ? { personId: currentPerson.id } : currentBoard ? { boardId: currentBoard.id } : {})}
            className="flex w-full items-center justify-center gap-2 rounded-btn bg-red py-2.5 text-[13px] font-bold text-white shadow-btn-red hover:bg-red-700"
          >
            <Plus size={15} /> Nouvelle carte
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <p className={section}>Sections</p>
          <button onClick={() => setView({ kind: "mine" })} className={navItem(view.kind === "mine")}>
            <Inbox size={15} className="text-ink-3" />
            <span className="flex-1">Mes cartes</span>
            {unseen.length > 0 && (
              <span className="rounded-full bg-red px-1.5 text-[10px] font-bold text-white" title={`${unseen.length} nouvelle(s)`}>
                {unseen.length}
              </span>
            )}
            <span className="font-mono text-[10px] text-ink-4">{active(mine).length}</span>
          </button>

          <p className={section}>Mes tableaux</p>
          {myBoards.map((b) => (
            <button key={b.id} onClick={() => setView({ kind: "board", id: b.id })} className={navItem(view.kind === "board" && view.id === b.id)}>
              <Kanban size={15} className="text-ink-3" />
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
              <span className="font-mono text-[10px] text-ink-4">{ws.cards.filter((c) => c.boardId === b.id && !c.archivedAt).length}</span>
            </button>
          ))}
          <InlineCreate
            placeholder="Nouveau tableau…"
            onCreate={async (t) => {
              try {
                const id = unwrap(await createTeamBoard(t));
                await load();
                setView({ kind: "board", id });
              } catch (e) {
                toast(e instanceof Error ? e.message : "Création impossible.");
              }
            }}
          />

          <p className={`${section} flex items-center gap-1.5`}>
            <Users size={11} /> Équipe
          </p>
          {team.length === 0 && <p className="px-3 py-1 text-[11px] leading-snug text-ink-4">Les personnes à qui vous assignez des cartes apparaîtront ici.</p>}
          {team.map(({ person, isReport, active: n }) => (
            <button key={person.id} onClick={() => setView({ kind: "person", id: person.id })} className={navItem(view.kind === "person" && view.id === person.id)}>
              <Avatar person={person} size={22} />
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              {isReport && <span className="rounded-chip bg-chip-bg px-1 text-[9px] font-bold text-ink-3" title="Vous êtes son N+1">N+1</span>}
              <span className="font-mono text-[10px] text-ink-4">{n}</span>
            </button>
          ))}
        </nav>

        <div className="m-3 rounded-btn bg-subtle px-3 py-2.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-4">Mon N+1</p>
          {manager ? (
            <p className="mt-1 flex items-center gap-2 text-xs font-bold text-ink-2">
              <Avatar person={manager} size={20} /> {manager.name}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-ink-4">Non désigné — à régler dans Frais → Responsables N+1.</p>
          )}
        </div>
      </aside>

      {/* Contenu */}
      <section className="flex min-w-0 flex-1 flex-col rounded-panel border border-line bg-card">
        <header className="flex flex-wrap items-start gap-3 border-b border-line px-7 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">{kicker}</p>
            <div className="mt-1 flex items-center gap-2">
              {currentPerson && <Avatar person={currentPerson} size={30} />}
              {currentBoard ? (
                <BoardTitle board={currentBoard} onError={toast} onChanged={load} canDelete={myBoards.length > 1} onDeleted={() => setView({ kind: "mine" })} />
              ) : (
                <h1 className="truncate text-[28px] font-extrabold leading-tight text-ink">{title}</h1>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-3">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex w-[260px] items-center gap-2 rounded-btn border border-line bg-panel px-3 py-2">
              <Search size={14} className="text-ink-4" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une carte…" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Effacer">
                  <X size={13} className="text-ink-4" />
                </button>
              )}
            </div>
            <button
              onClick={() => setNewCardFor(currentPerson ? { personId: currentPerson.id } : currentBoard ? { boardId: currentBoard.id } : {})}
              className="flex items-center gap-2 rounded-btn bg-navy px-4 py-2 text-[13px] font-bold text-white hover:bg-navy-600"
            >
              <Plus size={15} /> {currentPerson ? `Carte pour ${currentPerson.name.split(" ")[0]}` : "Nouvelle carte"}
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">{content}</div>
      </section>
      {overlays}
    </div>
  );
}

/* ---------- Mes cartes / cartes d'une personne ---------- */

function CardInbox({
  compact = false,
  shortcutFor,
  cards,
  personId,
  isMe,
  ws,
  peopleById,
  listsById,
  boardsById,
  onOpen,
}: {
  cards: TeamCard[];
  personId: string;
  isMe: boolean;
  ws: TeamWorkspace;
  peopleById: Map<string, TeamPerson>;
  listsById: Map<string, TeamList>;
  boardsById: Map<string, TeamBoard>;
  onOpen: (id: string) => void;
  compact?: boolean;
  shortcutFor?: (card: TeamCard) => CardShortcutAction | undefined;
}) {
  const [showDone, setShowDone] = useState(false);
  const membership = (c: TeamCard) => c.members.find((m) => m.userId === personId);
  const byAssigned = (a: TeamCard, b: TeamCard) => (membership(b)?.assignedAt ?? "").localeCompare(membership(a)?.assignedAt ?? "");
  const isNew = (c: TeamCard) => isMe && !!membership(c) && !membership(c)?.seenAt && membership(c)?.assignedBy !== personId;

  const open = cards.filter((c) => !isCardDone(c, listsById));
  const fresh = open.filter(isNew).sort(byAssigned);
  // À traiter : échéance la plus proche d'abord, puis les plus récemment assignées.
  const todo = open
    .filter((c) => !isNew(c))
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || byAssigned(a, b));
  const done = cards.filter((c) => isCardDone(c, listsById)).sort(byAssigned);

  const row = (c: TeamCard) => (
    <CardRow key={c.id} card={c} member={membership(c)} isNew={isNew(c)} ws={ws} peopleById={peopleById} listsById={listsById} boardsById={boardsById} onOpen={() => onOpen(c.id)} shortcut={shortcutFor?.(c)} />
  );

  if (!cards.length)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
        <Inbox size={28} className="text-ink-4" />
        <p className="text-sm font-bold text-ink-2">{isMe ? "Aucune carte ne vous est assignée pour l'instant." : "Aucune carte visible pour cette personne."}</p>
        <p className="max-w-sm text-xs text-ink-4">
          {isMe
            ? "Quand quelqu'un vous assigne une carte, elle arrive ici avec le nom de son créateur, la date et l'événement concerné."
            : "Vous voyez les cartes que vous lui avez assignées, et toutes ses cartes si vous êtes son N+1."}
        </p>
      </div>
    );

  return (
    <div className={`mx-auto max-w-[980px] ${compact ? "space-y-4 px-3 py-3" : "space-y-6 px-7 py-6"}`}>
      {fresh.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-red">
            <span className="h-1.5 w-1.5 rounded-full bg-red" /> Nouvelles · {fresh.length}
          </p>
          <div className="space-y-2">{fresh.map(row)}</div>
        </div>
      )}
      <div>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">À traiter · {todo.length}</p>
        {todo.length ? <div className="space-y-2">{todo.map(row)}</div> : <p className="text-xs text-ink-4">Rien en attente.</p>}
      </div>
      {done.length > 0 && (
        <div>
          <button onClick={() => setShowDone((s) => !s)} className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4 hover:text-ink-2">
            <ChevronDown size={12} className={showDone ? "" : "-rotate-90"} /> Terminées et archivées · {done.length}
          </button>
          {showDone && <div className="space-y-2">{done.map(row)}</div>}
        </div>
      )}
    </div>
  );
}

function CardRow({
  shortcut,
  card,
  member,
  isNew,
  ws,
  peopleById,
  listsById,
  boardsById,
  onOpen,
}: {
  card: TeamCard;
  member: TeamCard["members"][number] | undefined;
  isNew: boolean;
  ws: TeamWorkspace;
  peopleById: Map<string, TeamPerson>;
  listsById: Map<string, TeamList>;
  boardsById: Map<string, TeamBoard>;
  onOpen: () => void;
  shortcut?: CardShortcutAction;
}) {
  const creator = card.createdBy ? peopleById.get(card.createdBy) : undefined;
  const assigner = member?.assignedBy ? peopleById.get(member.assignedBy) : undefined;
  const from = assigner ?? creator;
  const list = listsById.get(card.listId);
  const board = boardsById.get(card.boardId);
  const done = isCardDone(card, listsById);
  const stripe = card.color ? TEAM_COLORS[card.color].base : card.labels[0] ? TEAM_COLORS[card.labels[0].color].base : "var(--line-strong)";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={`group flex cursor-pointer items-stretch overflow-hidden rounded-card border bg-card transition hover:shadow-bar ${isNew ? "border-red/40" : "border-line"} ${done ? "opacity-70" : ""}`}
    >
      <span className="w-1.5 shrink-0" style={{ background: stripe }} />
      <div className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3">
        <Avatar person={from} size={34} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            {isNew && <span className="rounded-chip bg-red px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Nouvelle</span>}
            <span className={`truncate text-sm font-bold text-ink ${done ? "line-through decoration-ink-4" : ""}`}>{card.title}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-3">
            {from?.id === ws.meId ? "Vous-même" : `De ${from?.name ?? "—"}`}
            {member ? ` · assignée le ${shortDate(member.assignedAt)}` : ` · créée le ${shortDate(card.createdAt)}`}
            {board && board.ownerId !== ws.meId && board.ownerId !== from?.id && ` · tableau de ${peopleById.get(board.ownerId)?.name ?? "—"}`}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {card.event && <EventChip event={card.event} />}
            <span className="flex items-center gap-1 rounded-chip bg-chip-bg px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">
              <span className={`h-1.5 w-1.5 rounded-full ${list?.isDone ? "bg-good" : "bg-navy"}`} />
              {board?.title ?? "—"} › {list?.title ?? "—"}
              {card.archivedAt && " · archivée"}
            </span>
            <DueChip iso={card.dueAt} done={done} />
            <ChecklistChip card={card} />
          </div>
        </div>
        {shortcut && <CardShortcut {...shortcut} />}
        <span className="hidden shrink-0 items-center gap-1 rounded-btn border border-line px-3 py-1.5 text-xs font-bold text-link group-hover:border-link sm:flex">
          Ouvrir <ArrowUpRight size={13} />
        </span>
      </div>
    </div>
  );
}

/* ---------- Tableau Kanban ---------- */

type DropTarget = { listId: string; beforeId: string | null } | null;

function BoardView({
  compact = false,
  shortcutFor,
  board,
  cards,
  ws,
  peopleById,
  listsById,
  onOpen,
  onMoveLocal,
  onChanged,
  onError,
}: {
  board: TeamBoard;
  cards: TeamCard[];
  ws: TeamWorkspace;
  peopleById: Map<string, TeamPerson>;
  listsById: Map<string, TeamList>;
  onOpen: (id: string) => void;
  onMoveLocal: (id: string, listId: string, position: number) => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
  compact?: boolean;
  shortcutFor?: (card: TeamCard) => CardShortcutAction | undefined;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [drop, setDrop] = useState<DropTarget>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const archivedCount = cards.filter((c) => c.archivedAt).length;
  const visible = cards.filter((c) => showArchived || !c.archivedAt);

  const doDrop = (target: NonNullable<DropTarget>) => {
    const id = dragId;
    setDragId(null);
    setDrop(null);
    if (!id) return;
    const column = visible.filter((c) => c.listId === target.listId && c.id !== id).sort((a, b) => a.position - b.position);
    const idx = target.beforeId ? column.findIndex((c) => c.id === target.beforeId) : column.length;
    const prev = column[idx - 1]?.position;
    const next = column[idx]?.position;
    const position = prev === undefined && next === undefined ? 1000 : prev === undefined ? next! - 1000 : next === undefined ? prev + 1000 : (prev + next) / 2;
    const card = cards.find((c) => c.id === id);
    if (card && card.listId === target.listId && card.position === position) return;
    onMoveLocal(id, target.listId, position);
    void moveTeamCard(id, target.listId, position).then((r) => {
      if (!r.ok) onError(r.error);
      void onChanged();
    });
  };

  const moveList = async (index: number, dir: -1 | 1) => {
    const ids = board.lists.map((l) => l.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    const r = await reorderTeamLists(ids);
    if (!r.ok) onError(r.error);
    await onChanged();
  };

  return (
    <div className="flex h-full flex-col">
      {archivedCount > 0 && (
        <div className={compact ? "px-3 pt-2" : "px-7 pt-3"}>
          <button onClick={() => setShowArchived((s) => !s)} className="text-xs font-semibold text-ink-3 hover:text-ink">
            {showArchived ? "Masquer" : "Afficher"} les cartes archivées ({archivedCount})
          </button>
        </div>
      )}
      <div className={`flex min-h-0 flex-1 items-start overflow-x-auto ${compact ? "snap-x snap-mandatory gap-3 px-3 py-3" : "gap-4 px-7 py-5"}`}>
        {board.lists.map((list, index) => {
          const column = visible.filter((c) => c.listId === list.id).sort((a, b) => a.position - b.position);
          const lastPos = column.at(-1)?.position ?? 0;
          return (
            <div
              key={list.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (drop?.listId !== list.id || drop.beforeId !== null) setDrop({ listId: list.id, beforeId: null });
              }}
              onDrop={(e) => {
                e.preventDefault();
                doDrop(drop?.listId === list.id ? drop : { listId: list.id, beforeId: null });
              }}
              className={`flex max-h-full shrink-0 flex-col rounded-card border bg-panel ${compact ? "w-[85vw] snap-center" : "w-[290px]"} ${drop?.listId === list.id ? "border-navy/40" : "border-line"}`}
            >
              <ListHeader
                list={list}
                count={column.length}
                canLeft={index > 0}
                canRight={index < board.lists.length - 1}
                onMove={(dir) => void moveList(index, dir)}
                onChanged={onChanged}
                onError={onError}
              />
              <div className="min-h-[8px] space-y-2 overflow-y-auto px-3 pb-2">
                {column.map((c) => (
                  <div
                    key={c.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (drop?.beforeId !== c.id) setDrop({ listId: list.id, beforeId: c.id });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      doDrop({ listId: list.id, beforeId: c.id });
                    }}
                  >
                    {drop?.beforeId === c.id && dragId && dragId !== c.id && <div className="mb-2 h-1 rounded-full bg-navy/40" />}
                    <CardTile
                      card={c}
                      done={isCardDone(c, listsById)}
                      peopleById={peopleById}
                      onOpen={() => onOpen(c.id)}
                      draggable
                      onDragStart={(e) => {
                        setDragId(c.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDrop(null);
                      }}
                      isNew={c.members.some((m) => m.userId === ws.meId && !m.seenAt && m.assignedBy !== ws.meId)}
                      shortcut={shortcutFor?.(c)}
                    />
                  </div>
                ))}
                {drop?.listId === list.id && drop.beforeId === null && dragId && <div className="h-1 rounded-full bg-navy/40" />}
              </div>
              <AddCard
                onAdd={async (title) => {
                  const r = await createTeamCard({ boardId: board.id, listId: list.id, title, position: lastPos + 1000 });
                  if (!r.ok) onError(r.error);
                  await onChanged();
                }}
              />
            </div>
          );
        })}
        <div className={`shrink-0 ${compact ? "w-[85vw] snap-center" : "w-[290px]"}`}>
          <InlineCreate
            boxed
            placeholder="Ajouter une liste"
            onCreate={async (t) => {
              const r = await createTeamList(board.id, t);
              if (!r.ok) onError(r.error);
              await onChanged();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ListHeader({
  list,
  count,
  canLeft,
  canRight,
  onMove,
  onChanged,
  onError,
}: {
  list: TeamList;
  count: number;
  canLeft: boolean;
  canRight: boolean;
  onMove: (dir: -1 | 1) => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(list.title);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setMenu(false);
    const r = await fn();
    if (!r.ok && r.error) onError(r.error);
    await onChanged();
  };
  const save = () => {
    setRenaming(false);
    if (title.trim() && title.trim() !== list.title) void act(() => updateTeamList(list.id, { title }));
    else setTitle(list.title);
  };
  return (
    <div className="relative flex items-center gap-2 px-4 pb-2 pt-3.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${list.isDone ? "bg-good" : count ? "bg-navy" : "bg-ink-4"}`} />
      {renaming ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="min-w-0 flex-1 rounded-md border border-line-strong px-1.5 py-0.5 text-[13px] font-bold outline-none"
        />
      ) : (
        <button onDoubleClick={() => setRenaming(true)} className="min-w-0 flex-1 truncate text-left text-[13px] font-extrabold text-ink">
          {list.title}
        </button>
      )}
      <span className="font-mono text-[10px] text-ink-4">{count}</span>
      <button onClick={() => setMenu((m) => !m)} aria-label="Options de la liste" className="rounded-md p-0.5 text-ink-4 hover:bg-hover hover:text-ink">
        <MoreHorizontal size={15} />
      </button>
      <div className="absolute right-3 top-8">
        <Popover open={menu} onClose={() => setMenu(false)} align="right" width={230}>
          <button onClick={() => (setMenu(false), setRenaming(true))} className="w-full rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover">
            Renommer
          </button>
          <button onClick={() => void act(() => updateTeamList(list.id, { isDone: !list.isDone }))} className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover">
            <span className="flex-1">Colonne « terminé »</span>
            {list.isDone && <Check size={14} className="text-good" />}
          </button>
          <p className="px-2 pb-1 text-[10px] leading-snug text-ink-4">Une carte déposée ici compte comme faite dans Mes cartes de ses assignés.</p>
          {canLeft && (
            <button onClick={() => (setMenu(false), onMove(-1))} className="w-full rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover">
              Déplacer vers la gauche
            </button>
          )}
          {canRight && (
            <button onClick={() => (setMenu(false), onMove(1))} className="w-full rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover">
              Déplacer vers la droite
            </button>
          )}
          <button
            onClick={() => window.confirm(`Supprimer la liste « ${list.title} » ?`) && void act(() => deleteTeamList(list.id))}
            className="w-full rounded-btn px-2 py-1.5 text-left text-[13px] text-red hover:bg-bad-bg"
          >
            Supprimer la liste
          </button>
        </Popover>
      </div>
    </div>
  );
}

function AddCard({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await onAdd(t);
  };
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mx-3 mb-3 flex items-center gap-2 rounded-btn border border-dashed border-line-strong px-3 py-2 text-[13px] text-ink-3 hover:bg-hover hover:text-ink">
        <Plus size={14} /> Ajouter une carte
      </button>
    );
  return (
    <div className="mx-3 mb-3">
      <textarea
        autoFocus
        rows={2}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Titre de la carte…"
        className="w-full resize-none rounded-btn border border-line-strong bg-card px-3 py-2 text-[13px] outline-none"
      />
      <div className="mt-1 flex items-center gap-2">
        <button onClick={() => void submit()} className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white">
          Ajouter
        </button>
        <button onClick={() => setOpen(false)} aria-label="Annuler" className="text-ink-4 hover:text-ink">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function InlineCreate({ placeholder, onCreate, boxed = false }: { placeholder: string; onCreate: (title: string) => Promise<void>; boxed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    setOpen(false);
    await onCreate(t);
  };
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className={
          boxed
            ? "flex w-full items-center gap-2 rounded-card border border-dashed border-line-strong px-4 py-3 text-[13px] text-ink-3 hover:bg-hover hover:text-ink"
            : "flex w-full items-center gap-2.5 rounded-btn px-3 py-2 text-left text-[13px] text-ink-4 hover:bg-hover hover:text-ink-2"
        }
      >
        <Plus size={14} /> {placeholder}
      </button>
    );
  return (
    <div className={boxed ? "rounded-card border border-line bg-panel p-3" : "px-1 py-1"}>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => !title.trim() && setOpen(false)}
        placeholder={placeholder.replace(/…$/, "") + "…"}
        className="w-full rounded-btn border border-line-strong bg-card px-2.5 py-1.5 text-[13px] outline-none"
      />
    </div>
  );
}

function BoardTitle({
  board,
  canDelete,
  onChanged,
  onDeleted,
  onError,
}: {
  board: TeamBoard;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(board.title);
  const [menu, setMenu] = useState(false);
  const save = async () => {
    setEditing(false);
    if (!title.trim() || title.trim() === board.title) return setTitle(board.title);
    const r = await renameTeamBoard(board.id, title);
    if (!r.ok) onError(r.error);
    await onChanged();
  };
  if (editing)
    return (
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === "Enter" && void save()}
        className="rounded-btn border border-line-strong px-2 py-0.5 text-[26px] font-extrabold text-ink outline-none"
      />
    );
  return (
    <div className="relative flex min-w-0 items-center gap-1">
      <h1 onDoubleClick={() => setEditing(true)} className="truncate text-[28px] font-extrabold leading-tight text-ink">
        {board.title}
      </h1>
      <button onClick={() => setMenu((m) => !m)} aria-label="Options du tableau" className="rounded-md p-1 text-ink-4 hover:bg-hover hover:text-ink">
        <MoreHorizontal size={18} />
      </button>
      <Popover open={menu} onClose={() => setMenu(false)} width={200}>
        <button onClick={() => (setMenu(false), setEditing(true))} className="w-full rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover">
          Renommer le tableau
        </button>
        {canDelete && (
          <button
            onClick={async () => {
              setMenu(false);
              if (!window.confirm(`Supprimer le tableau « ${board.title} » et toutes ses cartes ?`)) return;
              const r = await deleteTeamBoard(board.id);
              if (!r.ok) return onError(r.error);
              onDeleted();
              await onChanged();
            }}
            className="w-full rounded-btn px-2 py-1.5 text-left text-[13px] text-red hover:bg-bad-bg"
          >
            Supprimer le tableau
          </button>
        )}
      </Popover>
    </div>
  );
}
