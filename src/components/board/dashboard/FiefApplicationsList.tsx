"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { approveFiefApplication, listFiefApplications, refuseFiefApplication, type FiefApplicationRow } from "@/app/actions/fief-admin";
import { unwrap } from "@/lib/board/actionResult";
import { refreshBadges } from "@/components/board/live/LiveProvider";

// Popup « Demandes d'adhésion FIEF » du tableau de bord : accepter ou refuser sans ouvrir l'onglet FIEF.

const age = (birth: string) => {
  const b = new Date(birth + "T12:00:00");
  const n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
};

export function FiefApplicationsList({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<FiefApplicationRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    listFiefApplications("pending")
      .then((r) => setRows(unwrap(r)))
      .catch(() => setRows([]));
  }, []);
  if (!rows) return <p className="p-4 text-sm text-ink-4">Chargement…</p>;
  const done = (id: string, message: string) => {
    setNotice(message);
    setRows((prev) => prev?.filter((x) => x.id !== id) ?? null);
    refreshBadges();
    onChanged();
  };
  return (
    <>
      {notice && <div className="m-3 rounded-btn bg-sel-bg px-3 py-2 text-xs font-semibold text-ink">{notice}</div>}
      {rows.length === 0 ? <p className="p-4 text-sm text-ink-3">Tout est traité. 👍</p> : rows.map((r) => <Row key={r.id} row={r} onDone={(m) => done(r.id, m)} />)}
    </>
  );
}

function Row({ row: r, onDone }: { row: FiefApplicationRow; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState<null | "ok" | "ko">(null);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const name = `${r.firstName} ${r.lastName}`;

  const approve = async () => {
    setBusy("ok");
    setError(null);
    const res = await approveFiefApplication(r.id);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    onDone(`${name} fait maintenant partie de FIEF${res.data.emailed ? " — e-mail d'accueil envoyé" : ""}.`);
  };
  const refuse = async () => {
    setBusy("ko");
    setError(null);
    const res = await refuseFiefApplication(r.id, reason, true);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    onDone(`Demande de ${name} refusée${res.data.emailed ? " — e-mail envoyé" : ""}.`);
  };

  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{name}</p>
          <p className="text-[11px] text-ink-3">{[r.clubName, r.functions.join(", "), `${age(r.birthDate)} ans`, r.email].filter(Boolean).join(" · ")}</p>
          {r.message && <p className="mt-1 line-clamp-3 text-xs text-ink-2">« {r.message} »</p>}
        </div>
        {!refusing && (
          <div className="flex shrink-0 gap-2">
            <button onClick={approve} disabled={!!busy} className="flex items-center gap-1 rounded-btn bg-good px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              {busy === "ok" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Accepter
            </button>
            <button
              onClick={() => setRefusing(true)}
              disabled={!!busy}
              className="flex items-center gap-1 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover disabled:opacity-50"
            >
              <X size={13} /> Refuser
            </button>
          </div>
        )}
      </div>
      {refusing && (
        <div className="mt-2 space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Motif (facultatif, repris dans l'e-mail)"
            className="w-full rounded-btn border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-navy"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setRefusing(false)} disabled={!!busy} className="rounded-btn px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover">
              Annuler
            </button>
            <button onClick={refuse} disabled={!!busy} className="flex items-center gap-1 rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              {busy === "ko" && <Loader2 size={13} className="animate-spin" />} Confirmer le refus
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
