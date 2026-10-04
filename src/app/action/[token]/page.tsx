"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { getEmailAction, performEmailAction, type EmailActionView } from "@/app/actions/email-actions";

type Choice = "accept" | "refuse";

/**
 * Réponse depuis un e-mail de notification (bouton Accepter / Refuser) : rappelle la demande,
 * demande confirmation (les antivirus de messagerie ouvrent les liens tout seuls) puis répond,
 * sans connexion — voir src/app/actions/email-actions.ts.
 */
function EmailAction() {
  const { token } = useParams<{ token: string }>();
  const initial = useSearchParams().get("c") === "refuse" ? "refuse" : "accept";
  const [view, setView] = useState<EmailActionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>(initial);
  const [comment, setComment] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    getEmailAction(token).then((r) => (r.ok ? setView(r.data) : setError(r.error)));
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    const r = await performEmailAction(token, choice, comment, choice === "refuse" && forwardTo ? forwardTo : null);
    setBusy(false);
    if (r.ok) setDone(r.data);
    else setError(r.error);
  };

  return (
    <div className="w-full max-w-[460px] rounded-panel border border-line bg-card p-7 shadow-card">
      <div className="flex items-center gap-2.5">
        <Image src="/lgef-logo.png" alt="LGEF" width={34} height={34} className="rounded-lg" />
        <div className="leading-tight">
          <div className="text-sm font-extrabold text-ink">Board LGEF</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-4">Ligue Grand Est de Football</div>
        </div>
      </div>

      {error && <p className="mt-6 text-sm text-bad">{error}</p>}
      {!error && !view && <p className="mt-6 text-sm text-ink-4">Chargement…</p>}

      {view && !error && (
        <>
          <div className="mt-6 rounded-btn bg-subtle p-4">
            <div className="text-base font-extrabold text-ink">{view.event.title}</div>
            <div className="mt-1 text-sm text-ink-2">📅 {view.event.when}</div>
            {view.event.location && <div className="mt-0.5 text-sm text-ink-2">📍 {view.event.location}</div>}
          </div>

          {done ? (
            <p className="mt-5 text-sm font-semibold text-good">{done}</p>
          ) : (
            <>
              <p className="mt-5 text-sm font-bold text-ink">{view.question}</p>
              {view.answered && (
                <p className="mt-1 text-xs text-ink-4">
                  Vous avez déjà répondu : {view.answered === "accept" ? view.acceptLabel.toLowerCase() : view.refuseLabel.toLowerCase()}. Vous pouvez changer
                  votre réponse.
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["accept", "refuse"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setChoice(c)}
                    className={`rounded-btn border-2 px-3 py-2.5 text-sm font-bold ${
                      choice === c ? (c === "accept" ? "border-good bg-good-bg text-good" : "border-bad bg-bad-bg text-bad") : "border-line text-ink-3"
                    }`}
                  >
                    {c === "accept" ? view.acceptLabel : view.refuseLabel}
                  </button>
                ))}
              </div>
              {choice === "refuse" && view.peers.length > 0 && (
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-semibold text-ink-2">Proposer à un autre membre du comité directeur (facultatif)</label>
                  <select
                    value={forwardTo}
                    onChange={(e) => setForwardTo(e.target.value)}
                    className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-line-strong"
                  >
                    <option value="">Non, simplement décliner</option>
                    {view.peers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Un mot pour l'organisateur (facultatif)"
                className="mt-3 w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-line-strong"
              />
              <button
                onClick={() => void confirm()}
                disabled={busy}
                className="mt-4 w-full rounded-btn bg-red px-4 py-3 text-sm font-bold text-white shadow-btn-red transition hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? "Envoi…" : "Confirmer ma réponse"}
              </button>
            </>
          )}
          <Link href="/" className="mt-4 block text-center text-xs font-semibold text-ink-3 hover:underline">
            Ouvrir le board
          </Link>
        </>
      )}
    </div>
  );
}

export default function EmailActionPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-shell p-4">
      <Suspense>
        <EmailAction />
      </Suspense>
    </div>
  );
}
