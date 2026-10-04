"use client";

import { useState } from "react";
import type { DirectorProfile } from "@/hooks/board/useDirectorAttendance";

const nameOf = (d: DirectorProfile) => [d.first_name, d.last_name].filter(Boolean).join(" ").trim() || d.email || "—";

/**
 * Le membre du comité directeur sollicité ne peut pas venir : il décline, ou propose la présence
 * à un autre membre (qui est alors sollicité à sa place). Mot facultatif pour l'organisateur.
 */
export function DirectorDeclineForm({
  directors,
  selfId,
  onDecline,
  onForward,
  onCancel,
}: {
  directors: DirectorProfile[];
  selfId: string | null;
  onDecline: (comment: string) => Promise<unknown>;
  onForward: (directorId: string, comment: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [forwardTo, setForwardTo] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const peers = directors.filter((d) => d.id !== selfId);
  const chosen = peers.find((d) => d.id === forwardTo);

  const submit = async () => {
    setBusy(true);
    try {
      if (forwardTo) await onForward(forwardTo, comment);
      else await onDecline(comment);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">Vous ne pourrez pas être présent. Voulez-vous proposer un autre membre du comité directeur ?</p>
      <select
        value={forwardTo}
        onChange={(e) => setForwardTo(e.target.value)}
        className="w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm outline-none"
      >
        <option value="">Non, simplement décliner</option>
        {peers.map((d) => (
          <option key={d.id} value={d.id}>
            {nameOf(d)}
          </option>
        ))}
      </select>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Un mot pour l'organisateur (facultatif)"
        className="w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm outline-none"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className="rounded-btn border border-line px-3 py-2 text-sm font-semibold text-ink-2 disabled:opacity-60">
          Retour
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-btn bg-red px-3 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
        >
          {chosen ? `Proposer à ${nameOf(chosen)}` : "Décliner"}
        </button>
      </div>
    </div>
  );
}
