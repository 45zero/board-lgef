"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { createTeamCard } from "@/app/actions/team";
import type { TeamBoard, TeamWorkspace } from "@/lib/board/team";
import { Avatar } from "./TeamUi";

// Fenêtre « Nouvelle carte » : écran Espace Team et raccourci « + » de Mes cartes (récapitulatif).

export function NewCardDialog({
  ws,
  myBoards,
  initial,
  onClose,
  onCreated,
  onError,
  zClass = "z-[70]",
}: {
  ws: TeamWorkspace;
  myBoards: TeamBoard[];
  initial: { personId?: string; boardId?: string; listId?: string };
  onClose: () => void;
  onCreated: (cardId: string) => Promise<void>;
  onError: (m: string) => void;
  zClass?: string;
}) {
  const [title, setTitle] = useState("");
  const [boardId, setBoardId] = useState(initial.boardId ?? myBoards[0]?.id ?? "");
  const board = myBoards.find((b) => b.id === boardId);
  const [listId, setListId] = useState(initial.listId ?? "");
  const effectiveList = board?.lists.find((l) => l.id === listId) ?? board?.lists.find((l) => !l.isDone) ?? board?.lists[0];
  const [members, setMembers] = useState<string[]>(initial.personId ? [initial.personId] : []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const needle = q.trim().toLowerCase();
  const suggestions = needle ? ws.people.filter((p) => !members.includes(p.id) && p.name.toLowerCase().includes(needle)).slice(0, 6) : [];

  const submit = async () => {
    if (!title.trim() || !board || !effectiveList) return;
    setBusy(true);
    const maxPos = Math.max(0, ...ws.cards.filter((c) => c.listId === effectiveList.id).map((c) => c.position));
    const r = await createTeamCard({ boardId: board.id, listId: effectiveList.id, title, position: maxPos + 1000, memberIds: members });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    await onCreated(r.data);
  };

  return (
    <div className={`fixed inset-0 ${zClass} flex items-center justify-center bg-[rgba(6,14,28,0.45)] p-4 backdrop-blur-sm`} onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-[480px] rounded-modal bg-card p-6 shadow-modal">
        <div className="mb-4 flex items-center">
          <h2 className="flex-1 text-lg font-extrabold text-ink">Nouvelle carte</h2>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1 text-ink-3 hover:bg-hover">
            <X size={18} />
          </button>
        </div>
        <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Titre</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="Ex. Préparer les visuels du match"
          className="w-full rounded-btn border border-line-strong px-3 py-2 text-sm outline-none"
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Tableau</label>
            <select value={boardId} onChange={(e) => (setBoardId(e.target.value), setListId(""))} className="w-full rounded-btn border border-line bg-card px-2 py-2 text-sm outline-none">
              {myBoards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Colonne</label>
            <select value={effectiveList?.id ?? ""} onChange={(e) => setListId(e.target.value)} className="w-full rounded-btn border border-line bg-card px-2 py-2 text-sm outline-none">
              {board?.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="mb-1 mt-4 block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Assigner à</label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-btn border border-line px-2 py-1.5">
          {members.map((id) => {
            const p = ws.people.find((x) => x.id === id);
            return (
              <span key={id} className="flex items-center gap-1 rounded-full bg-subtle py-0.5 pl-0.5 pr-2 text-xs font-semibold text-ink-2">
                <Avatar person={p} size={20} /> {p?.name}
                <button onClick={() => setMembers((m) => m.filter((x) => x !== id))} aria-label="Retirer">
                  <X size={11} className="text-ink-4" />
                </button>
              </span>
            );
          })}
          <div className="relative min-w-[140px] flex-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={members.length ? "Ajouter…" : "Rechercher une personne…"} className="w-full py-1 text-[13px] outline-none" />
            {suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-btn border border-line bg-card p-1 shadow-card">
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setMembers((m) => [...m, p.id]);
                      setQ("");
                    }}
                    className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover"
                  >
                    <Avatar person={p} size={22} /> {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-4">La carte apparaîtra dans « Mes cartes » des personnes assignées. Vous pourrez ensuite la lier à un événement.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-semibold text-ink-3 hover:bg-hover">
            Annuler
          </button>
          <button onClick={() => void submit()} disabled={!title.trim() || busy} className="rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
            {busy ? "Création…" : "Créer la carte"}
          </button>
        </div>
      </div>
    </div>
  );
}
