"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { Archive, BellRing, Check, ChevronRight, Clock, Kanban, ListChecks, Plus } from "lucide-react";
import { ackTeamCardReminder, finishTeamCard, remindTeamCardMember, setMyCardStatus, updateTeamChecklistItem } from "@/app/actions/team";
import { PANEL, PanelHead } from "@/components/board/dashboard/Panel";
import { useOpenTeamCard } from "@/components/board/team/TeamCardOpener";
import type { MyCard } from "@/lib/board/myCards";
import { MEMBER_STATUS_COLOR, MEMBER_STATUSES, TEAM_COLORS, type MemberStatus, type ReminderLevel } from "@/lib/board/team";

// « Mes cartes » : même panneau sur l'accueil (colonne de droite) et dans l'Espace Team (section
// Mes cartes, pleine page). À faire = ma part, Suivi = la part des autres, statut par personne,
// relance orange puis rouge en cliquant sur la pastille d'un membre.

type CardsView = "all" | "todo" | "follow";
const CARDS_VIEWS: { id: CardsView; label: string; hint: string }[] = [
  { id: "all", label: "Tous", hint: "Toutes mes cartes" },
  {
    id: "todo",
    label: "À faire",
    hint: "Cartes où je suis assigné : mon statut, mes éléments à cocher",
  },
  {
    id: "follow",
    label: "Suivi",
    hint: "La part des autres : cartes que j'ai créées ou partagées avec d'autres membres",
  },
];
/** Vue par défaut retenue sur cet appareil (préférence d'affichage) ; « À faire » sinon. */
function readCardsView(key: string): CardsView {
  try {
    const v = localStorage.getItem(key);
    return v === "all" || v === "todo" || v === "follow" ? v : "todo";
  } catch {
    return "todo";
  }
}

/**
 * Valeurs choisies sur l'accueil en attendant que le serveur les renvoie. Une valeur vaut tant que les
 * données affichées ont été demandées avant son enregistrement (`dataAt`) ; ensuite le serveur fait foi.
 */
function useOverrides<T>(dataAt: number) {
  const [map, setMap] = useState<Record<string, { v: T; at: number }>>({});
  return {
    get: (key: string): T | undefined => {
      const o = map[key];
      return o && o.at > dataAt ? o.v : undefined;
    },
    /** Choix en cours d'envoi : affiché jusqu'à settle / drop. */
    set: (key: string, v: T) => setMap((m) => ({ ...m, [key]: { v, at: Infinity } })),
    /** Enregistré : les données demandées à partir de maintenant le remplacent. */
    settle: (key: string) => {
      const at = Date.now();
      setMap((m) => (m[key] ? { ...m, [key]: { ...m[key], at } } : m));
    },
    drop: (key: string) =>
      setMap((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      }),
  };
}

/**
 * « Mes cartes » : cartes de l'Espace Team qui me sont assignées et pas encore faites. Clic = la fiche
 * de la carte en popup ; « Archiver » = comme dans Espace Team (colonne Terminé de son tableau, archivée
 * s'il n'y en a pas), la carte disparaît tout de suite. Toujours affiché : « + » crée une carte.
 */
export function MyCardsPanel({
  cards,
  cardsAt,
  onOpenBoard,
  onChanged,
  page = false,
  onOpen,
  storageKey = "dashboard:cardsView",
}: {
  cards: MyCard[] | null;
  cardsAt: number;
  onOpenBoard?: () => void;
  onChanged: () => void;
  /** Section « Mes cartes » de l'Espace Team : pleine page, sans cadre ni titre, cartes en grille. */
  page?: boolean;
  /** Ouvre la fiche (par défaut : la fenêtre partagée du board). */
  onOpen?: (id: string) => void;
  /** Vue par défaut retenue sur cet appareil (clic droit sur un onglet). */
  storageKey?: string;
}) {
  const opener = useOpenTeamCard();
  const open = onOpen ?? opener.open;
  const create = opener.create;
  const a = useCardActions(cardsAt, onChanged);
  // Onglets : « Tous » puis un onglet par tableau de l'Espace Team (ordre d'apparition des cartes).
  const [tab, setTab] = useState<string>("all");
  // Vue : Tous, À faire (cartes où je suis assigné : statut, cases à cocher) ou Suivi (cartes que j'ai
  // créées sans y être assigné : je vois où en sont les autres). Clic droit sur un onglet = vue par défaut.
  const [defaultView, setDefaultView] = useState<CardsView>(() => readCardsView(storageKey));
  const [view, setView] = useState<CardsView>(defaultView);
  const all = (cards ?? []).filter((c) => !a.archived.has(c.id));
  if (cards === null) return null;
  // À faire = ma part (cartes où je suis assigné, compté sur mon statut).
  // Suivi = la part des autres : cartes partagées avec d'autres membres, ou créées par moi sans assigné
  // (compté par personne ; « personne d'assigné » en gris). Une carte peut être dans les deux vues.
  const myStatus = a.myStatus;
  const others = (c: MyCard) => (c.members ?? []).filter((m): m is typeof m & { status: MemberStatus } => !m.isMe && !!m.status);
  const unassigned = (c: MyCard) => !c.assigned && others(c).length === 0;
  const isTodo = (c: MyCard) => c.assigned;
  const isFollow = (c: MyCard) => others(c).length > 0 || (c.createdByMe && !c.assigned);
  const todoCards = all.filter(isTodo);
  const followCards = all.filter(isFollow);
  type Tally = { id: string; label: string; color: string; n: number };
  const tally = (statusesOf: MemberStatus[], extra?: Tally): Tally[] =>
    [
      ...MEMBER_STATUSES.map((st) => ({
        id: st.id,
        label: st.label,
        color: st.color,
        n: statusesOf.filter((x) => x === st.id).length,
      })),
      ...(extra ? [extra] : []),
    ].filter((x) => x.n > 0);
  const statusCounts: Partial<Record<CardsView, Tally[]>> = {
    todo: tally(todoCards.map(myStatus)),
    follow: tally(
      followCards.flatMap((c) => others(c).map((m) => m.status)),
      {
        id: "none",
        label: "Sans personne d'assigné",
        color: "var(--ink-4)",
        n: followCards.filter(unassigned).length,
      }
    ),
  };
  const counts: Record<CardsView, number> = {
    all: all.length,
    todo: todoCards.length,
    follow: followCards.length,
  };
  const inView = view === "todo" ? todoCards : view === "follow" ? followCards : all;
  const boards = [...new Set(inView.map((c) => c.boardTitle || "Sans tableau"))];
  const activeTab = tab !== "all" && boards.includes(tab) ? tab : "all";
  const list = activeTab === "all" ? inView : inView.filter((c) => (c.boardTitle || "Sans tableau") === activeTab);
  const makeDefault = (v: CardsView) => {
    setDefaultView(v);
    setView(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {
      /* stockage indisponible (navigation privée) : la vue par défaut vaut pour cette visite */
    }
  };
  const tabClass = (on: boolean) =>
    `flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${on ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:text-ink"}`;

  return (
    <section className={page ? "min-w-0" : `min-w-0 ${PANEL}`}>
      {!page && (
        <PanelHead
          icon={<Kanban size={14} />}
          title="Mes cartes"
          count={counts.todo}
          right={
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Nouvelle carte : même fenêtre que dans l'Espace Team (tableau, colonne, membres). */}
              <button
                type="button"
                onClick={create}
                title="Nouvelle carte"
                aria-label="Nouvelle carte"
                className="flex h-6 w-6 items-center justify-center rounded-btn bg-navy text-white transition hover:opacity-90"
              >
                <Plus size={14} strokeWidth={2.5} />
              </button>
              {onOpenBoard && (
                <button onClick={onOpenBoard} className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-link hover:underline md:text-xs">
                  Espace Team <ChevronRight size={12} />
                </button>
              )}
            </div>
          }
        />
      )}
      {/* Tous / À faire / Suivi — clic droit : vue par défaut. */}
      <div className={`flex rounded-full bg-subtle p-0.5 ${page ? "mb-3 max-w-xl" : "-mt-0.5 mb-2"}`}>
        {CARDS_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              makeDefault(v.id);
            }}
            title={`${v.hint}${defaultView === v.id ? " — vue par défaut" : " — clic droit : en faire la vue par défaut"}`}
            className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold transition-colors ${
              view === v.id ? "bg-navy text-white shadow-card" : "text-ink-3 hover:text-ink"
            }`}
          >
            {v.label}
            {statusCounts[v.id] ? (
              /* Un nombre par statut, entouré de sa couleur : ex. 2 en cours (orange), 1 fait (vert). */
              statusCounts[v.id]!.map((st) => (
                <span
                  key={st.id}
                  title={
                    v.id === "follow"
                      ? st.id === "none"
                        ? `${st.n} carte${st.n > 1 ? "s" : ""} sans personne d'assigné`
                        : `${st.n} personne${st.n > 1 ? "s" : ""} : ${st.label.toLowerCase()}`
                      : `${st.n} carte${st.n > 1 ? "s" : ""} : ${st.label.toLowerCase()}`
                  }
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-extrabold leading-none"
                  style={{
                    boxShadow: `inset 0 0 0 1.5px ${st.color}`,
                    color: view === v.id ? "#fff" : st.color,
                  }}
                >
                  {st.n}
                </span>
              ))
            ) : (
              <span className="opacity-70">{counts[v.id]}</span>
            )}
            {defaultView === v.id && <span className={`h-1 w-1 rounded-full ${view === v.id ? "bg-white" : "bg-link"}`} aria-label="vue par défaut" />}
          </button>
        ))}
      </div>
      {boards.length > 1 && (
        <div className="mb-2.5 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => setTab("all")} className={tabClass(activeTab === "all")}>
            Tous les tableaux <span className="opacity-70">{inView.length}</span>
          </button>
          {boards.map((b) => (
            <button key={b} type="button" onClick={() => setTab(b)} className={tabClass(activeTab === b)}>
              {b} <span className="opacity-70">{inView.filter((c) => (c.boardTitle || "Sans tableau") === b).length}</span>
            </button>
          ))}
        </div>
      )}
      {list.length === 0 && (
        <div className="rounded-card bg-panel p-4 text-sm text-ink-3">
          {view === "todo"
            ? "Aucune carte où vous êtes assigné."
            : view === "follow"
            ? "Rien à suivre : aucune carte partagée avec d'autres membres."
            : "Aucune carte pour le moment — « + » pour en créer une."}
        </div>
      )}
      <div className={page ? "grid items-start gap-2.5 md:grid-cols-2 2xl:grid-cols-3" : "grid gap-2"}>
        {list.map((c) => (
          <MyCardTile key={c.id} card={c} actions={a} showMine={view !== "follow"} onOpen={() => open(c.id)} />
        ))}
      </div>
    </section>
  );
}

/** Actions des cartes (mon statut, cases cochées, relances, archivage) avec affichage immédiat. */
export function useCardActions(cardsAt: number, onChanged: () => void) {
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // « En retard » : comparé à l'heure d'ouverture de l'accueil (le rendu reste pur).
  const [now] = useState(() => Date.now());
  // Mes éléments de checklist cochés/décochés depuis l'accueil (affichage immédiat, avant rechargement).
  // Choix faits ici, affichés tout de suite : cases cochées (clé = élément), relances (« carte:personne »,
  // 0 aucune, 1 orange, 2 rouge), mon statut (clé = carte). Chacun garde l'heure où le serveur l'a
  // enregistré (Infinity tant que l'envoi est en cours) : dès qu'arrivent des données demandées après,
  // elles font foi — un changement fait par quelqu'un d'autre s'affiche donc en direct.
  const checkedOv = useOverrides<boolean>(cardsAt);
  const levelsOv = useOverrides<ReminderLevel>(cardsAt);
  const statusOv = useOverrides<MemberStatus>(cardsAt);
  const [sending, setSending] = useState<string | null>(null);
  const myStatus = (c: MyCard): MemberStatus => statusOv.get(c.id) ?? c.myStatus ?? "red";

  const changeStatus = async (c: MyCard, next: MemberStatus) => {
    const before = myStatus(c);
    const me = c.members?.find((m) => m.isMe);
    const myLevel = me ? levelOf(c, me) : 0;
    // Même statut accepté si on m'a relancé : confirmer son statut efface la relance.
    if (before === next && !myLevel) return;
    const levelKey = me ? `${c.id}:${me.id}` : null;
    statusOv.set(c.id, next);
    if (levelKey) levelsOv.set(levelKey, 0);
    const res = await setMyCardStatus(c.id, next).catch(() => ({
      ok: false as const,
      error: "Statut impossible à changer pour le moment.",
    }));
    if (!res.ok) {
      statusOv.drop(c.id);
      if (levelKey) levelsOv.drop(levelKey);
      window.alert(res.error);
      return;
    }
    statusOv.settle(c.id);
    if (levelKey) levelsOv.settle(levelKey);
  };

  const toggleItem = async (item: { id: string; done: boolean }) => {
    const before = checkedOv.get(item.id) ?? item.done;
    checkedOv.set(item.id, !before);
    const res = await updateTeamChecklistItem(item.id, { done: !before }).catch(() => ({
      ok: false as const,
      error: "Impossible de cocher pour le moment.",
    }));
    if (!res.ok) {
      checkedOv.drop(item.id);
      window.alert(res.error);
      return;
    }
    checkedOv.settle(item.id);
  };

  const levelOf = (c: MyCard, m: NonNullable<MyCard["members"]>[number]): ReminderLevel => levelsOv.get(`${c.id}:${m.id}`) ?? m.reminderLevel ?? 0;

  // Clic sur la pastille d'un membre : 1re relance orange (notification), 2e rouge (pop-up + son chez lui).
  const remind = async (c: MyCard, m: NonNullable<MyCard["members"]>[number]) => {
    const key = `${c.id}:${m.id}`;
    const current = levelOf(c, m);
    if (m.isMe || sending === key || current >= 2) return;
    if (
      current === 1 &&
      !window.confirm(`${m.name} n'a pas encore réagi à votre relance.\nRelancer en rouge ? Un message s'ouvrira sur son board jusqu'à ce qu'il ou elle mette à jour son statut.`)
    )
      return;
    setSending(key);
    const res = await remindTeamCardMember(c.id, m.id).catch(() => ({
      ok: false as const,
      error: "Relance impossible pour le moment.",
    }));
    setSending(null);
    if (!res.ok) {
      window.alert(res.error);
      return;
    }
    levelsOv.set(key, res.data);
    levelsOv.settle(key);
  };

  // Ma cloche orange : « vu » au clic. La rouge ne part qu'en mettant à jour mon statut.
  const ackMine = async (c: MyCard, m: NonNullable<MyCard["members"]>[number]) => {
    const key = `${c.id}:${m.id}`;
    if (levelOf(c, m) !== 1) return;
    levelsOv.set(key, 0);
    const res = await ackTeamCardReminder(c.id).catch(() => ({
      ok: false as const,
      error: "Impossible pour le moment.",
    }));
    if (res.ok) levelsOv.settle(key);
    else levelsOv.drop(key);
  };

  const archive = async (c: MyCard) => {
    setBusy(c.id);
    setArchived((s) => new Set(s).add(c.id));
    const res = await finishTeamCard(c.id).catch(() => ({
      ok: false as const,
      error: "Archivage impossible pour le moment.",
    }));
    setBusy(null);
    if (!res.ok) {
      setArchived((s) => {
        const next = new Set(s);
        next.delete(c.id);
        return next;
      });
      window.alert(res.error);
      return;
    }
    onChanged();
  };

  return {
    archived,
    busy,
    now,
    checkedOv,
    sending,
    myStatus,
    levelOf,
    changeStatus,
    toggleItem,
    remind,
    ackMine,
    archive,
  };
}
export type CardActions = ReturnType<typeof useCardActions>;

/**
 * Une carte : titre, extrait, mes éléments cochables, mon statut (si j'y suis assigné et `showMine`),
 * relance reçue, échéance, checklist, pastilles des membres (clic = relance). Accueil, Mes cartes et
 * listes des tableaux de l'Espace Team.
 */
export function MyCardTile({
  card: c,
  actions: a,
  showMine,
  onOpen,
  done = false,
  surface = "panel",
  action,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  card: MyCard;
  actions: CardActions;
  showMine: boolean;
  onOpen: () => void;
  done?: boolean;
  surface?: "panel" | "card";
  /** Bouton à droite à la place de « Archiver » (null : aucun). */
  action?: ReactNode;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const unassigned = !c.assigned && !(c.members ?? []).some((m) => !m.isMe && !!m.status);
  const due = c.dueAt ? new Date(c.dueAt).getTime() : null;
  const late = due !== null && due < a.now;
  // Échéance en couleur : rouge en retard, orange sous 48 h, sinon neutre.
  const soon = due !== null && !late && due - a.now < 2 * 86_400_000;
  const dueClass = late ? "bg-bad-bg text-bad" : soon ? "bg-warn-bg text-warn" : "bg-subtle text-ink-3";
  const accent = c.color ? TEAM_COLORS[c.color].base : late ? "var(--red)" : "var(--navy)";
  const myItems = c.myItems ?? [];
  const delta = myItems.reduce((n, i) => {
    const v = a.checkedOv.get(i.id);
    return n + (v === undefined || v === i.done ? 0 : v ? 1 : -1);
  }, 0);
  const check = c.checklist ? { done: c.checklist.done + delta, total: c.checklist.total } : null;
  const mention = c.mentions?.[0];
  // Mon statut sur la carte (si j'y suis assigné) : rouge à faire, orange en cours, vert fait.
  const status = c.assigned && showMine ? a.myStatus(c) : null;
  const checkDone = !!check && check.total > 0 && check.done === check.total;
  const members = c.members ?? [];
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen()}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      style={{ borderLeftColor: accent }}
      className={`group relative flex min-w-0 cursor-pointer flex-col rounded-card border border-l-4 border-line px-2.5 py-2 transition hover:-translate-y-px hover:border-line-strong hover:shadow-card ${
        surface === "card" ? "bg-card" : "bg-panel"
      } ${done ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-1.5">
        <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-bold leading-tight text-ink">{c.title}</span>
        {c.isNew && <span className="shrink-0 rounded-full bg-sel-bg px-1.5 py-0.5 text-[9px] font-bold text-link">Nouvelle</span>}
      </div>
      {/* Début de la description : de quoi saisir le contexte sans ouvrir la carte. */}
      {c.excerpt && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-3">{c.excerpt}</p>}
      {/* Éléments de checklist où je suis identifié : le texte, cochable sans ouvrir la carte. */}
      {showMine && myItems.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {myItems.slice(0, 4).map((i) => {
            const done = a.checkedOv.get(i.id) ?? i.done;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void a.toggleItem(i);
                  }}
                  className="flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-hover"
                  title={done ? "Décocher" : "Cocher"}
                >
                  <span
                    className={`mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                      done ? "border-good bg-good text-white" : "border-line-strong bg-card"
                    }`}
                  >
                    {done && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className={`line-clamp-2 text-[11px] leading-snug ${done ? "text-ink-4 line-through" : "text-ink-2"}`}>{i.content}</span>
                </button>
              </li>
            );
          })}
          {myItems.length > 4 && (
            <li className="px-1 text-[10px] text-ink-4">
              + {myItems.length - 4} autre{myItems.length > 5 ? "s" : ""} dans la carte
            </li>
          )}
        </ul>
      )}
      {/* Dernier message où je suis identifié. */}
      {showMine && mention && (
        <div className="mt-1.5 rounded-md border-l-2 border-link bg-card px-2 py-1 text-[11px] leading-snug text-ink-2">
          <span className="line-clamp-2">
            <span className="font-bold text-ink">{mention.author}</span> · {mention.content}
          </span>
          {(c.mentions?.length ?? 0) > 1 && <span className="mt-0.5 block text-[10px] text-ink-4">+ 1 autre message vous cite</span>}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[10px] font-semibold">
          {/* Mon statut : rouge à faire, orange en cours, vert fait — les autres le voient en point sous ma pastille. */}
          {status ? (
            <span className="flex items-center gap-1.5 rounded-full bg-card px-1.5 py-1 ring-1 ring-line" title="Mon statut sur cette carte">
              {MEMBER_STATUSES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void a.changeStatus(c, st.id);
                  }}
                  title={`Mon statut : ${st.label}`}
                  aria-label={st.label}
                  aria-pressed={status === st.id}
                  className={`h-2 w-2 shrink-0 rounded-full transition ${status === st.id ? "" : "opacity-25 hover:opacity-80"}`}
                  style={{
                    background: st.color,
                    boxShadow: status === st.id ? `0 0 0 1.5px var(--card), 0 0 0 3px ${st.color}` : undefined,
                  }}
                />
              ))}
            </span>
          ) : (
            <>
              {c.createdByMe && <span className="rounded-full bg-subtle px-1.5 py-0.5 text-ink-3">Créée par vous</span>}
              {unassigned && <span className="rounded-full border border-dashed border-line-strong px-1.5 py-0.5 text-ink-4">Personne d&apos;assigné</span>}
            </>
          )}
          {(() => {
            // On m'a relancé : orange = cliquer pour « vu » ; rouge = mettre à jour mon statut.
            const me = members.find((m) => m.isMe);
            const myLevel = me && status ? a.levelOf(c, me) : 0;
            if (!me || !myLevel) return null;
            return (
              <button
                type="button"
                disabled={myLevel === 2}
                onClick={(e) => {
                  e.stopPropagation();
                  void a.ackMine(c, me);
                }}
                title={myLevel === 2 ? "Relancé en rouge : choisissez votre statut avec les pastilles" : "Vous avez été relancé — cliquer : vu"}
                className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-white ${myLevel === 2 ? "animate-pulse" : "hover:opacity-90"}`}
                style={{ background: myLevel === 2 ? "#E1141B" : "#E08A0B" }}
              >
                <BellRing size={10} strokeWidth={2.5} />
                {myLevel === 2 ? "Statut ?" : "Relancé"}
              </button>
            );
          })()}
          {c.dueAt && (
            <span className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 ${dueClass}`} title={late ? "En retard" : "Échéance"}>
              <Clock size={10} />
              {new Date(c.dueAt).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "short",
              })}
            </span>
          )}
          {check && check.total > 0 && (
            <span className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 ${checkDone ? "bg-good-bg text-good" : "bg-subtle text-ink-3"}`} title="Checklist">
              <ListChecks size={10} />
              {check.done}/{check.total}
            </span>
          )}
          {c.boardTitle && <span className="truncate font-medium text-ink-4">{c.boardTitle}</span>}
        </div>
        {/* Membres : pastilles (4 au plus, puis +n), point de statut dessous, créateur entouré d'or ; clic = relance. */}
        {members.length > 0 && (
          <div className="flex shrink-0 -space-x-1 pb-1">
            {members.slice(0, 4).map((m) => {
              const level = a.levelOf(c, m);
              const isSending = a.sending === `${c.id}:${m.id}`;
              const bell = level === 2 ? "#E1141B" : "#E08A0B";
              const memberStatus = m.isMe && status ? status : m.status;
              const statusLabel = memberStatus ? MEMBER_STATUSES.find((st) => st.id === memberStatus)?.label : null;
              const who = `${m.name}${m.isMe ? " (vous)" : ""}${m.isCreator ? " — créateur" : ""}${statusLabel ? ` — ${statusLabel}` : ""}`;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={isSending || (m.isMe ? level !== 1 : level >= 2)}
                  onClick={(e) => {
                    e.stopPropagation();
                    void (m.isMe ? a.ackMine(c, m) : a.remind(c, m));
                  }}
                  title={
                    m.isMe
                      ? level === 1
                        ? `${who} · vous avez été relancé — cliquer : vu`
                        : level === 2
                        ? `${who} · relancé en rouge — mettez à jour votre statut`
                        : who
                      : level === 2
                      ? `${who} · relancé en rouge, en attente de sa mise à jour`
                      : level === 1
                      ? `${who} · relancé (orange) — cliquer pour relancer en rouge`
                      : `${who} · cliquer pour relancer`
                  }
                  className={`relative block h-5 w-5 rounded-full ring-2 transition ${m.isCreator ? "ring-[#F2C14E]" : "ring-panel"} ${
                    (m.isMe ? level === 1 : level < 2) ? "hover:z-10 hover:scale-110" : "cursor-default"
                  } ${isSending ? "animate-pulse" : ""}`}
                >
                  {m.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- photo du bucket Supabase
                    <img src={m.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy text-[8px] font-bold text-white">{m.initials}</span>
                  )}
                  {memberStatus && (
                    <span
                      className="absolute -bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ring-1 ring-panel"
                      style={{ background: MEMBER_STATUS_COLOR[memberStatus] }}
                    />
                  )}
                  {/* Relance figée tant que la personne n'a pas réagi : orange, puis rouge. */}
                  {level > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full text-white ring-1 ring-panel" style={{ background: bell }}>
                      <BellRing size={7} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
            {members.length > 4 && (
              <span
                title={members
                  .slice(4)
                  .map((m) => m.name)
                  .join(", ")}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-subtle text-[8px] font-bold text-ink-3 ring-2 ring-panel"
              >
                +{members.length - 4}
              </span>
            )}
          </div>
        )}
        {action === undefined ? (
          <button
            type="button"
            disabled={a.busy === c.id}
            onClick={(e) => {
              e.stopPropagation();
              void a.archive(c);
            }}
            title="Archiver : la carte passe dans la colonne Terminé de son tableau"
            aria-label="Archiver la carte"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-card text-ink-3 hover:border-line-strong hover:text-ink disabled:opacity-50"
          >
            <Archive size={12} />
          </button>
        ) : (
          action
        )}
      </div>
    </div>
  );
}
