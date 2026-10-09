"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlignLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckSquare,
  Clock,
  Copy,
  Kanban,
  Paperclip,
  MessageSquare,
  Plus,
  Search,
  Tag,
  Trash2,
  Archive,
  ArchiveRestore,
  User,
  X,
} from "lucide-react";
import {
  addTeamCardComment,
  addTeamChecklistItem,
  copyTeamCard,
  deleteTeamCard,
  deleteTeamCardComment,
  deleteTeamChecklistItem,
  listTeamCardComments,
  markTeamCardSeen,
  moveTeamCard,
  searchTeamEvents,
  setTeamCardMembers,
  updateTeamCard,
  updateTeamChecklistItem,
  type TeamCardPatch,
} from "@/app/actions/team";
import { unwrap } from "@/lib/board/actionResult";
import { TEAM_COLORS, TEAM_COLOR_IDS, isCardDone, type TeamCard, type TeamColor, type TeamComment, type TeamWorkspace } from "@/lib/board/team";
import { Avatar, DueChip, EventChip, LeaveBeforeEventContext, Popover } from "./TeamUi";
import { TeamAttachments } from "./TeamAttachments";
import { TeamEmails } from "./TeamEmails";

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`;
  return `le ${new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
};

/** Valeur d'un <input type="datetime-local"> (heure locale) ↔ ISO. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const sectionTitle = "mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4";
const sideBtn = "flex w-full items-center gap-2 rounded-btn bg-subtle px-3 py-2 text-left text-[13px] font-semibold text-ink-2 hover:bg-chip-bg disabled:opacity-50";

type Pop = "members" | "labels" | "due" | "event" | "move" | null;

export function TeamCardModal({
  card,
  ws,
  onClose,
  onLocalPatch,
  onRefresh,
  onError,
  zClass = "z-[70]",
}: {
  card: TeamCard;
  ws: TeamWorkspace;
  /** Niveau d'affichage : z-90 quand la fiche s'ouvre en popup par-dessus la fiche événement. */
  zClass?: string;
  onClose: () => void;
  /** Mise à jour immédiate de l'affichage, avant la confirmation du serveur. */
  onLocalPatch: (cardId: string, patch: Partial<TeamCard>) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const peopleById = useMemo(() => new Map(ws.people.map((p) => [p.id, p])), [ws.people]);
  const board = ws.boards.find((b) => b.id === card.boardId);
  const listsById = useMemo(() => new Map(ws.boards.flatMap((b) => b.lists).map((l) => [l.id, l])), [ws.boards]);
  const list = listsById.get(card.listId);
  const done = isCardDone(card, listsById);

  const me = ws.meId;
  const isOwner = board?.ownerId === me;
  const isMember = card.members.some((m) => m.userId === me);
  const canEdit = isOwner || card.createdBy === me || isMember || ws.isAdmin;
  const canDelete = isOwner || card.createdBy === me || ws.isAdmin;

  const [pop, setPop] = useState<Pop>(null);
  const closePop = useCallback(() => setPop(null), []);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(card.description);
  const [newItem, setNewItem] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [comments, setComments] = useState<TeamComment[] | null>(null);
  const [comment, setComment] = useState("");
  const [pickSignal, setPickSignal] = useState(0);
  const [attachmentsReload, setAttachmentsReload] = useState(0);
  const reloadAttachments = useCallback(() => setAttachmentsReload((n) => n + 1), []);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Une erreur est survenue.");
      } finally {
        onRefresh();
      }
    },
    [onError, onRefresh]
  );

  const patch = (p: TeamCardPatch, local: Partial<TeamCard>) => {
    onLocalPatch(card.id, local);
    void run(async () => unwrap(await updateTeamCard(card.id, p)));
  };

  const loadComments = useCallback(async () => {
    try {
      setComments(unwrap(await listTeamCardComments(card.id)));
    } catch {
      setComments([]);
    }
  }, [card.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void loadComments();
  }, [loadComments, card.commentCount]);

  // L'assigné ouvre sa carte : elle n'est plus « nouvelle ».
  useEffect(() => {
    const mine = card.members.find((m) => m.userId === me);
    if (mine && !mine.seenAt) {
      onLocalPatch(card.id, { members: card.members.map((m) => (m.userId === me ? { ...m, seenAt: new Date().toISOString() } : m)) });
      void markTeamCardSeen(card.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !pop && !editingDesc && !editingTitle && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [pop, editingDesc, editingTitle, onClose]);

  const checklistDone = card.checklist.filter((i) => i.done).length;
  const progress = card.checklist.length ? Math.round((checklistDone / card.checklist.length) * 100) : 0;
  const creator = card.createdBy ? peopleById.get(card.createdBy) : undefined;
  const otherMembers = card.members.filter((m) => m.userId !== card.createdBy);

  const saveTitle = () => {
    setEditingTitle(false);
    if (title.trim() && title.trim() !== card.title) patch({ title }, { title: title.trim() });
    else setTitle(card.title);
  };

  return (
    <LeaveBeforeEventContext.Provider value={zClass === "z-[70]" ? null : onClose}>
    <div className={`fixed inset-0 ${zClass} flex items-center justify-center bg-[rgba(6,14,28,0.45)] p-4 backdrop-blur-sm`} onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[940px] flex-col overflow-hidden rounded-modal bg-card shadow-modal"
        style={{ borderTop: `6px solid ${card.color ? TEAM_COLORS[card.color].base : "var(--navy)"}` }}
      >
        {/* En-tête */}
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-subtle text-ink-3">
            <Kanban size={17} />
          </span>
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") {
                    setTitle(card.title);
                    setEditingTitle(false);
                  }
                }}
                className="w-full rounded-btn border border-line-strong px-2 py-1 text-xl font-extrabold text-ink outline-none"
              />
            ) : (
              <h2
                onClick={() => canEdit && setEditingTitle(true)}
                className={`text-xl font-extrabold leading-tight text-ink ${canEdit ? "cursor-text" : ""} ${card.archivedAt ? "line-through decoration-ink-4" : ""}`}
              >
                {card.title}
              </h2>
            )}
            <p className="mt-1 text-xs text-ink-3">
              dans la liste <b className="text-ink-2">{list?.title ?? "—"}</b> · tableau {board?.title ?? "—"}
              {board && board.ownerId !== me && <> de {peopleById.get(board.ownerId)?.name ?? "—"}</>}
              {card.archivedAt && <span className="ml-2 rounded-chip bg-chip-bg px-1.5 py-0.5 text-[10px] font-bold text-ink-3">Archivée</span>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {/* Colonne principale */}
          <div className="min-w-0 flex-1 space-y-6 px-6 py-5 md:overflow-y-auto">
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <div>
                <p className={sectionTitle}>Membres</p>
                <div className="flex items-center gap-1.5">
                  {card.members.map((m) => (
                    <Avatar key={m.userId} person={peopleById.get(m.userId)} size={30} />
                  ))}
                  {canEdit && (
                    <button onClick={() => setPop("members")} aria-label="Assigner" className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-subtle text-ink-3 hover:bg-chip-bg">
                      <Plus size={14} />
                    </button>
                  )}
                  {!card.members.length && !canEdit && <span className="text-xs text-ink-4">Personne</span>}
                </div>
              </div>
              <div>
                <p className={sectionTitle}>Étiquettes</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {card.labels.map((l, i) => (
                    <span key={i} className="rounded-btn px-3 py-1.5 text-xs font-bold text-white" style={{ background: TEAM_COLORS[l.color].base }}>
                      {l.name}
                    </span>
                  ))}
                  {canEdit && (
                    <button onClick={() => setPop("labels")} aria-label="Étiquettes" className="flex h-[30px] w-[30px] items-center justify-center rounded-btn bg-subtle text-ink-3 hover:bg-chip-bg">
                      <Plus size={14} />
                    </button>
                  )}
                </div>
              </div>
              {card.dueAt && (
                <div>
                  <p className={sectionTitle}>Échéance</p>
                  <button
                    onClick={() => canEdit && setPop("due")}
                    className="flex items-center gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-xs font-bold text-ink-2 hover:bg-hover"
                  >
                    <Clock size={13} />
                    {new Date(card.dueAt).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} ·{" "}
                    {new Date(card.dueAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    <DueChip iso={card.dueAt} done={done} />
                  </button>
                </div>
              )}
              {card.event && (
                <div className="min-w-0">
                  <p className={sectionTitle}>Événement</p>
                  <div className="flex items-center gap-1.5">
                    <EventChip event={card.event} />
                    {canEdit && (
                      <button onClick={() => patch({ eventId: null }, { event: null })} title="Délier l'événement" className="rounded-full p-1 text-ink-4 hover:bg-hover hover:text-ink">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Qui a créé / assigné la carte */}
            <div className="flex items-start gap-2.5 rounded-btn bg-subtle px-3 py-2.5 text-xs text-ink-3">
              <Avatar person={creator} size={24} />
              <p className="pt-1">
                Créée par <b className="text-ink-2">{creator?.name ?? "—"}</b> {ago(card.createdAt)}
                {otherMembers.length > 0 && (
                  <>
                    {" · assignée à "}
                    {otherMembers.map((m, i) => (
                      <span key={m.userId}>
                        {i > 0 && (i === otherMembers.length - 1 ? " et " : ", ")}
                        <b className="text-ink-2">{peopleById.get(m.userId)?.name ?? "—"}</b>
                      </span>
                    ))}
                  </>
                )}
                {card.event && " · les assignés sont participants de l'événement"}
              </p>
            </div>

            {/* Checklist */}
            {(card.checklist.length > 0 || addingItem) && (
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <CheckSquare size={16} className="text-ink-3" />
                  <h3 className="text-sm font-extrabold text-ink">Checklist</h3>
                  <span className="ml-1 h-1.5 w-28 overflow-hidden rounded-full bg-track">
                    <span className={`block h-full rounded-full ${progress === 100 ? "bg-good" : "bg-red"}`} style={{ width: `${progress}%` }} />
                  </span>
                  <span className="font-mono text-[11px] text-ink-4">
                    {checklistDone}/{card.checklist.length}
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {card.checklist.map((item) => (
                    <li key={item.id} className="group flex items-center gap-2 rounded-btn px-1.5 py-1 hover:bg-hover">
                      <button
                        disabled={!canEdit}
                        onClick={() => {
                          onLocalPatch(card.id, { checklist: card.checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) });
                          void run(async () => unwrap(await updateTeamChecklistItem(item.id, { done: !item.done })));
                        }}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${item.done ? "border-good bg-good text-white" : "border-line-strong bg-card"}`}
                        aria-label={item.done ? "Décocher" : "Cocher"}
                      >
                        {item.done && <Check size={11} strokeWidth={3} />}
                      </button>
                      <span className={`flex-1 text-[13px] ${item.done ? "text-ink-4 line-through" : "text-ink-2"}`}>{item.content}</span>
                      {canEdit && (
                        <button
                          onClick={() => {
                            onLocalPatch(card.id, { checklist: card.checklist.filter((i) => i.id !== item.id) });
                            void run(async () => unwrap(await deleteTeamChecklistItem(item.id)));
                          }}
                          className="hidden text-ink-4 hover:text-bad group-hover:block"
                          aria-label="Supprimer l'élément"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <form
                    className="mt-1.5 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const content = newItem.trim();
                      if (!content) return;
                      setNewItem("");
                      void run(async () => unwrap(await addTeamChecklistItem(card.id, content, card.checklist.length)));
                    }}
                  >
                    <input
                      autoFocus={addingItem}
                      value={newItem}
                      onChange={(e) => setNewItem(e.target.value)}
                      placeholder="Ajouter un élément…"
                      className="min-w-0 flex-1 rounded-btn border border-line px-2.5 py-1.5 text-[13px] outline-none focus:border-line-strong"
                    />
                    <button className="rounded-btn bg-navy px-3 text-xs font-bold text-white disabled:opacity-40" disabled={!newItem.trim()}>
                      Ajouter
                    </button>
                  </form>
                )}
              </section>
            )}

            {/* Description */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <AlignLeft size={16} className="text-ink-3" />
                <h3 className="flex-1 text-sm font-extrabold text-ink">Description</h3>
                {canEdit && !editingDesc && (
                  <button onClick={() => setEditingDesc(true)} className="text-xs font-bold text-link hover:underline">
                    Modifier
                  </button>
                )}
              </div>
              {editingDesc ? (
                <div>
                  <textarea
                    autoFocus
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    rows={6}
                    placeholder="Contexte, consignes, liens…"
                    className="w-full rounded-btn border border-line-strong bg-card px-3 py-2.5 text-[13px] leading-relaxed text-ink-2 outline-none"
                  />
                  <div className="mt-1.5 flex gap-2">
                    <button
                      onClick={() => {
                        setEditingDesc(false);
                        if (desc !== card.description) patch({ description: desc }, { description: desc });
                      }}
                      className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white"
                    >
                      Enregistrer
                    </button>
                    <button
                      onClick={() => {
                        setDesc(card.description);
                        setEditingDesc(false);
                      }}
                      className="rounded-btn px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : card.description ? (
                <p className="whitespace-pre-wrap rounded-btn bg-subtle px-4 py-3 text-[13px] leading-relaxed text-ink-2">{card.description}</p>
              ) : (
                <button
                  disabled={!canEdit}
                  onClick={() => setEditingDesc(true)}
                  className="w-full rounded-btn bg-subtle px-4 py-3 text-left text-[13px] text-ink-4 enabled:hover:bg-chip-bg"
                >
                  {canEdit ? "Ajouter une description…" : "Pas de description."}
                </button>
              )}
            </section>

            <TeamAttachments cardId={card.id} canEdit={canEdit} pickSignal={pickSignal} reloadSignal={attachmentsReload} people={ws.people} hasEvent={!!card.event} onError={onError} />

            <TeamEmails cardId={card.id} canEdit={canEdit} me={me} people={ws.people} onAttachmentsAdded={reloadAttachments} onError={onError} />

            {/* Discussion */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <MessageSquare size={16} className="text-ink-3" />
                <h3 className="flex-1 text-sm font-extrabold text-ink">Discussion</h3>
                <span className="font-mono text-[10px] text-ink-4">
                  {comments?.length ?? card.commentCount} message{(comments?.length ?? card.commentCount) > 1 ? "s" : ""}
                </span>
              </div>
              <form
                className="flex items-start gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const content = comment.trim();
                  if (!content) return;
                  setComment("");
                  setComments((prev) => [{ id: `tmp-${Date.now()}`, userId: me, content, createdAt: new Date().toISOString() }, ...(prev ?? [])]);
                  void run(async () => {
                    unwrap(await addTeamCardComment(card.id, content));
                    await loadComments();
                  });
                }}
              >
                <Avatar person={peopleById.get(me)} size={30} />
                <div className="flex-1">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
                    }}
                    rows={comment ? 3 : 1}
                    placeholder="Écrire un commentaire…"
                    className="w-full resize-none rounded-btn border border-line px-3 py-2 text-[13px] outline-none focus:border-line-strong"
                  />
                  {comment.trim() && (
                    <button className="mt-1 rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white">Envoyer</button>
                  )}
                </div>
              </form>
              <ul className="mt-3 space-y-3">
                {(comments ?? []).map((c) => {
                  const author = peopleById.get(c.userId);
                  return (
                    <li key={c.id} className="group flex gap-2.5">
                      <Avatar person={author} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs">
                          <b className="text-ink">{author?.name ?? "—"}</b> <span className="text-ink-4">{ago(c.createdAt)}</span>
                          {c.userId === me && !c.id.startsWith("tmp-") && (
                            <button
                              onClick={() => {
                                setComments((prev) => (prev ?? []).filter((x) => x.id !== c.id));
                                void run(async () => unwrap(await deleteTeamCardComment(c.id)));
                              }}
                              className="ml-2 hidden text-[11px] font-semibold text-ink-4 hover:text-bad group-hover:inline"
                            >
                              Supprimer
                            </button>
                          )}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap rounded-btn border border-line bg-card px-3 py-2 text-[13px] text-ink-2">{c.content}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          {/* Colonne d'actions */}
          <aside className="shrink-0 border-t border-line bg-panel px-5 py-5 md:w-[250px] md:overflow-y-auto md:border-l md:border-t-0">
            {canEdit ? (
              <>
                <p className={sectionTitle}>Ajouter à la carte</p>
                <div className="space-y-1.5">
                  <div className="relative">
                    <button onClick={() => setPop(pop === "members" ? null : "members")} className={sideBtn}>
                      <User size={14} /> Membres
                    </button>
                    <MembersPopover open={pop === "members"} onClose={closePop} card={card} ws={ws} onSave={(ids) => {
                      const now = new Date().toISOString();
                      onLocalPatch(card.id, {
                        members: ids.map((id) => card.members.find((m) => m.userId === id) ?? { userId: id, assignedBy: me, assignedAt: now, seenAt: id === me ? now : null }),
                      });
                      void run(async () => unwrap(await setTeamCardMembers(card.id, ids)));
                    }} />
                  </div>
                  <div className="relative">
                    <button onClick={() => setPop(pop === "labels" ? null : "labels")} className={sideBtn}>
                      <Tag size={14} /> Étiquettes
                    </button>
                    <LabelsPopover open={pop === "labels"} onClose={closePop} labels={card.labels} onSave={(labels) => patch({ labels }, { labels })} />
                  </div>
                  <button
                    onClick={() => setAddingItem(true)}
                    className={sideBtn}
                  >
                    <CheckSquare size={14} /> Checklist
                  </button>
                  <div className="relative">
                    <button onClick={() => setPop(pop === "due" ? null : "due")} className={sideBtn}>
                      <Clock size={14} /> Échéance
                    </button>
                    <Popover open={pop === "due"} onClose={closePop} width={240}>
                      <p className={sectionTitle}>Échéance</p>
                      <input
                        type="datetime-local"
                        defaultValue={toLocalInput(card.dueAt) || toLocalInput(new Date(new Date().setHours(18, 0, 0, 0)).toISOString())}
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const iso = new Date(e.target.value).toISOString();
                          patch({ dueAt: iso }, { dueAt: iso });
                        }}
                        className="w-full rounded-btn border border-line px-2 py-1.5 text-sm outline-none"
                      />
                      {card.dueAt && (
                        <button
                          onClick={() => {
                            patch({ dueAt: null }, { dueAt: null });
                            closePop();
                          }}
                          className="mt-2 text-xs font-semibold text-bad hover:underline"
                        >
                          Retirer l&rsquo;échéance
                        </button>
                      )}
                    </Popover>
                  </div>
                  <button onClick={() => setPickSignal((n) => n + 1)} className={sideBtn}>
                    <Paperclip size={14} /> Pièce jointe
                  </button>
                  <div className="relative">
                    <button onClick={() => setPop(pop === "event" ? null : "event")} className={sideBtn}>
                      <CalendarDays size={14} /> Événement
                    </button>
                    <EventPopover
                      open={pop === "event"}
                      onClose={closePop}
                      onPick={(ev) => {
                        patch({ eventId: ev.id }, { event: ev });
                        closePop();
                      }}
                    />
                  </div>
                </div>

                <p className={`${sectionTitle} mt-6`}>Couleur de la carte</p>
                <div className="flex flex-wrap gap-2">
                  {TEAM_COLOR_IDS.map((c) => (
                    <button
                      key={c}
                      title={TEAM_COLORS[c].label}
                      onClick={() => patch({ color: card.color === c ? null : c }, { color: card.color === c ? null : c })}
                      className={`h-8 w-8 rounded-btn ${card.color === c ? "ring-2 ring-offset-2" : ""}`}
                      style={{ background: TEAM_COLORS[c].base, ["--tw-ring-color" as string]: TEAM_COLORS[c].base }}
                    />
                  ))}
                </div>

                <p className={`${sectionTitle} mt-6`}>Actions</p>
                <div className="space-y-0.5">
                  <div className="relative">
                    <button onClick={() => setPop(pop === "move" ? null : "move")} className="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-[13px] font-semibold text-ink-2 hover:bg-hover">
                      <ArrowRight size={14} /> Déplacer
                    </button>
                    <Popover open={pop === "move"} onClose={closePop} width={220}>
                      <p className={sectionTitle}>Vers la colonne</p>
                      {(board?.lists ?? []).map((l) => (
                        <button
                          key={l.id}
                          onClick={() => {
                            closePop();
                            if (l.id === card.listId) return;
                            onLocalPatch(card.id, { listId: l.id, position: Date.now() });
                            void run(async () => unwrap(await moveTeamCard(card.id, l.id, Date.now())));
                          }}
                          className={`flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-[13px] hover:bg-hover ${l.id === card.listId ? "font-bold text-ink" : "text-ink-2"}`}
                        >
                          <span className={`h-2 w-2 rounded-full ${l.isDone ? "bg-good" : "bg-ink-4"}`} />
                          {l.title}
                          {l.id === card.listId && <Check size={13} className="ml-auto" />}
                        </button>
                      ))}
                    </Popover>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => void run(async () => unwrap(await copyTeamCard(card.id)))}
                      className="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-[13px] font-semibold text-ink-2 hover:bg-hover"
                    >
                      <Copy size={14} /> Copier
                    </button>
                  )}
                  {card.archivedAt ? (
                    <button
                      onClick={() => patch({ archived: false }, { archivedAt: null })}
                      className="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-[13px] font-semibold text-ink-2 hover:bg-hover"
                    >
                      <ArchiveRestore size={14} /> Restaurer
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        patch({ archived: true }, { archivedAt: new Date().toISOString() });
                        onClose();
                      }}
                      className="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-[13px] font-semibold text-red hover:bg-bad-bg"
                    >
                      <Archive size={14} /> Archiver
                    </button>
                  )}
                  {canDelete && card.archivedAt && (
                    <button
                      onClick={() => {
                        if (!window.confirm(`Supprimer définitivement « ${card.title} » ?`)) return;
                        onClose();
                        void run(async () => unwrap(await deleteTeamCard(card.id)));
                      }}
                      className="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-[13px] font-semibold text-red hover:bg-bad-bg"
                    >
                      <Trash2 size={14} /> Supprimer
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-ink-4">
                Lecture seule : vous voyez cette carte en tant que responsable N+1. Vous pouvez la commenter.
              </p>
            )}
          </aside>
        </div>
      </div>
    </div>
    </LeaveBeforeEventContext.Provider>
  );
}

function MembersPopover({ open, onClose, card, ws, onSave }: { open: boolean; onClose: () => void; card: TeamCard; ws: TeamWorkspace; onSave: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const selected = new Set(card.members.map((m) => m.userId));
  const needle = q.trim().toLowerCase();
  const people = ws.people
    .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.email?.toLowerCase().includes(needle))
    // Moi d'abord, puis les personnes déjà assignées.
    .sort((a, b) => Number(b.id === ws.meId) - Number(a.id === ws.meId) || Number(selected.has(b.id)) - Number(selected.has(a.id)));
  return (
    <Popover open={open} onClose={onClose} width={280}>
      <p className={sectionTitle}>Assigner</p>
      <div className="mb-2 flex items-center gap-1.5 rounded-btn border border-line px-2 py-1.5">
        <Search size={13} className="text-ink-4" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une personne…" className="min-w-0 flex-1 text-[13px] outline-none" />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {people.map((p) => {
          const on = selected.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => onSave(on ? [...selected].filter((id) => id !== p.id) : [...selected, p.id])}
              className="flex w-full items-center gap-2 rounded-btn px-1.5 py-1.5 text-left hover:bg-hover"
            >
              <Avatar person={p} size={24} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                {p.name}
                {p.id === ws.meId && <span className="text-ink-4"> (moi)</span>}
              </span>
              {on && <Check size={14} className="text-good" />}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

function LabelsPopover({ open, onClose, labels, onSave }: { open: boolean; onClose: () => void; labels: TeamCard["labels"]; onSave: (labels: TeamCard["labels"]) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<TeamColor>("navy");
  return (
    <Popover open={open} onClose={onClose} width={260}>
      <p className={sectionTitle}>Étiquettes</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {labels.map((l, i) => (
          <span key={i} className="flex items-center gap-1 rounded-btn px-2 py-1 text-xs font-bold text-white" style={{ background: TEAM_COLORS[l.color].base }}>
            {l.name}
            <button onClick={() => onSave(labels.filter((_, j) => j !== i))} aria-label={`Retirer ${l.name}`} className="opacity-80 hover:opacity-100">
              <X size={11} />
            </button>
          </span>
        ))}
        {!labels.length && <span className="text-xs text-ink-4">Aucune étiquette.</span>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSave([...labels, { name: name.trim().slice(0, 30), color }]);
          setName("");
        }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouvelle étiquette (ex. Urgent)" className="w-full rounded-btn border border-line px-2 py-1.5 text-[13px] outline-none" />
        <div className="mt-2 flex items-center gap-1.5">
          {TEAM_COLOR_IDS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              title={TEAM_COLORS[c].label}
              className={`h-6 w-6 rounded-md ${color === c ? "ring-2 ring-offset-1" : ""}`}
              style={{ background: TEAM_COLORS[c].base, ["--tw-ring-color" as string]: TEAM_COLORS[c].base }}
            />
          ))}
          <button className="ml-auto rounded-btn bg-navy px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40" disabled={!name.trim()}>
            Ajouter
          </button>
        </div>
      </form>
    </Popover>
  );
}

function EventPopover({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (ev: NonNullable<TeamCard["event"]>) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<NonNullable<TeamCard["event"]>[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      const res = await searchTeamEvents(q);
      if (alive) setResults(res.ok ? res.data : []);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, open]);
  return (
    <Popover open={open} onClose={onClose} width={300}>
      <p className={sectionTitle}>Lier un événement</p>
      <p className="mb-2 text-[11px] leading-snug text-ink-4">Les personnes assignées à la carte deviennent participantes de l&rsquo;événement.</p>
      <div className="mb-2 flex items-center gap-1.5 rounded-btn border border-line px-2 py-1.5">
        <Search size={13} className="text-ink-4" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un événement…" className="min-w-0 flex-1 text-[13px] outline-none" />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {results === null && <p className="px-1.5 py-2 text-xs text-ink-4">Recherche…</p>}
        {results?.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-4">Aucun événement trouvé.</p>}
        {results?.map((ev) => (
          <button key={ev.id} onClick={() => onPick(ev)} className="flex w-full items-center gap-2 rounded-btn px-1.5 py-1.5 text-left hover:bg-hover">
            <span className="w-14 shrink-0 font-mono text-[10px] text-ink-4">
              {new Date(ev.startDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{ev.title}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
