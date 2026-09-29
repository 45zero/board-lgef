"use client";

import { useState } from "react";
import { Camera, Check, Video } from "lucide-react";
import { approveAccessRequest, rejectAccessRequest, type AccessRequest, type PaymentMode } from "@/app/actions/account-requests";

const input = "w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm outline-none focus:border-navy";
const btnSmall = "flex items-center gap-1 rounded-btn px-2.5 py-1.5 text-xs font-bold disabled:opacity-50";
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Une erreur est survenue.");

export const KIND_LABELS: Record<string, string> = {
  salarie: "Salarié",
  arbitre: "Arbitre",
  photographe: "Photographe",
  videaste: "Vidéaste",
  partenaire: "Partenaire",
  media: "Média",
  autre: "Autre",
};
const PAYMENT_LABELS: Record<PaymentMode, string> = {
  reseau: "Réseau — remboursement de frais",
  prestataire: "Prestataire — sur facture",
  benevole: "Bénévole — ni frais ni facture",
};

/**
 * Demande d'accès en attente : accepter (avec, au besoin, Couverture match — photographe et/ou
 * vidéaste — et le mode de paiement) ou refuser. Les cases sont pré-cochées d'après « Vous êtes ».
 */
export function AccessRequestCard({ request, onDone }: { request: AccessRequest; onDone: (message: string) => void }) {
  const [photo, setPhoto] = useState(request.kind === "photographe");
  const [video, setVideo] = useState(request.kind === "videaste");
  const [payment, setPayment] = useState<PaymentMode>("reseau");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = `${request.firstName} ${request.lastName}`;
  const coverage = photo || video;

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  const approve = () =>
    act(async () => {
      const res = await approveAccessRequest(request.id, coverage ? { photo, video, payment } : null);
      const who = coverage ? `${name} ajouté à Couverture match` : `Accès accordé à ${name}`;
      return res.emailed ? `${who} — e-mail envoyé pour choisir son mot de passe.` : `${who} — l'e-mail n'a pas pu partir, prévenez-le.`;
    });

  return (
    <div className="space-y-2 border-b border-line p-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-ink">{name}</span>
        <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold text-ink-3">{KIND_LABELS[request.kind ?? ""] ?? request.kind ?? "—"}</span>
      </div>
      <div className="text-xs text-ink-3">
        {request.email}
        {request.phone && <> · {request.phone}</>}
        {request.organization && <> · {request.organization}</>}
      </div>
      {request.reason && <p className="whitespace-pre-line rounded-btn bg-subtle px-2.5 py-2 text-xs text-ink-2">{request.reason}</p>}

      <div className="space-y-2 rounded-btn border border-line p-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-ink-4">Couverture match</div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-1.5 text-sm text-ink-2">
            <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
            <Camera size={13} /> Photographe
          </label>
          <label className="flex items-center gap-1.5 text-sm text-ink-2">
            <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} />
            <Video size={13} /> Vidéaste
          </label>
        </div>
        {coverage && (
          <select value={payment} onChange={(e) => setPayment(e.target.value as PaymentMode)} className={`${input} !py-1.5 text-xs`}>
            {(Object.keys(PAYMENT_LABELS) as PaymentMode[]).map((p) => (
              <option key={p} value={p}>
                {PAYMENT_LABELS[p]}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          disabled={busy}
          onClick={() => confirm(`Refuser la demande de ${name} ? Un e-mail lui sera envoyé.`) && void act(async () => (await rejectAccessRequest(request.id), `Demande de ${name} refusée.`))}
          className={`${btnSmall} border border-bad text-bad`}
        >
          Refuser
        </button>
        <button disabled={busy} onClick={() => void approve()} className={`${btnSmall} bg-good text-white`}>
          <Check size={12} /> {coverage ? "Accepter dans Couverture match" : "Accepter (accès simple)"}
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
