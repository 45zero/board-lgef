"use client";

import { useState } from "react";
import { AlertTriangle, Check, FileText, Loader2, Mail, X } from "lucide-react";
import { getInvoiceFiles, requestInvoices, reviewInvoice } from "@/app/actions/staff";
import { INVOICE_STATUS_LABELS, euros, invoiceMissing, type Engagement, type StaffPerson } from "@/lib/board/staff";

// Facture d'une intervention de prestataire (Effectif, GED → Prestataires) : la consulter, la valider
// ou la refuser (N+1, administrateur), ou la réclamer par e-mail si elle manque.

/** Facture d'une intervention de prestataire : bouton pour la consulter, ou signal si elle manque. */
export function InvoiceLine({
  engagement: e,
  status,
  claimedTo,
  onClaimed,
  onChanged,
  onError,
}: {
  engagement: Engagement;
  status: StaffPerson["status"];
  /** Adresse à qui la facture a été réclamée (ici ou via « Réclamer tout »). */
  claimedTo: string | null;
  onClaimed: (email: string) => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimNote, setClaimNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [motive, setMotive] = useState("");
  const [reviewing, setReviewing] = useState<"approved" | "rejected" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!e.invoice) {
    if (!invoiceMissing(e, status)) return null;
    // Réclamer : e-mail au prestataire (mot facultatif, infos de l'intervention, lien de dépôt).
    const claim = async () => {
      setBusy(true);
      const res = await requestInvoices(e.userId, [e.eventId], claimNote);
      setBusy(false);
      if (!res.ok) return onError(res.error);
      setClaiming(false);
      onClaimed(res.data.email);
    };
    return (
      <div className="mt-1.5 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-bad">
            <AlertTriangle size={12} /> Facture non déposée
          </span>
          {claimedTo ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-good">
              <Check size={12} /> Réclamée à {claimedTo}
            </span>
          ) : (
            !claiming && (
              <button
                type="button"
                onClick={() => setClaiming(true)}
                title="E-mail avec les infos de l'intervention et un lien pour déposer la facture directement"
                className="flex items-center gap-1 rounded-btn border border-bad/40 px-2 py-0.5 text-[11px] font-bold text-bad hover:bg-bad-bg"
              >
                <Mail size={11} /> Réclamer
              </button>
            )
          )}
        </div>
        {claiming && <ClaimForm busy={busy} note={claimNote} onNote={setClaimNote} onSend={() => void claim()} onCancel={() => setClaiming(false)} />}
      </div>
    );
  }
  const inv = e.invoice;
  const view = async () => {
    // Fenêtre ouverte tout de suite (sinon bloquée par le navigateur), remplie à la réponse.
    const win = window.open("", "_blank");
    setBusy(true);
    const res = await getInvoiceFiles(inv.id);
    setBusy(false);
    if (!res.ok || !res.data.length) {
      win?.close();
      onError(res.ok ? "Aucun fichier joint à cette facture." : res.error);
      return;
    }
    if (win) win.location.href = res.data[0].url;
    for (const f of res.data.slice(1)) window.open(f.url, "_blank");
  };
  const tone = inv.status === "approved" ? "bg-good-bg text-good" : inv.status === "rejected" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn";
  // Décision du N+1 : prestataire prévenu (board + e-mail) ; validée → copiée dans le Drive.
  const review = async (decision: "approved" | "rejected") => {
    setReviewing(decision);
    const res = await reviewInvoice(inv.id, decision, decision === "rejected" ? motive : undefined);
    setReviewing(null);
    if (!res.ok) return onError(res.error);
    setRejecting(false);
    setMotive("");
    setNotice(decision === "approved" ? (res.data.archived ? "Validée et archivée dans le Drive." : "Validée.") : "Refusée — le prestataire a reçu le motif et un lien pour en déposer une nouvelle.");
    await onChanged();
  };
  return (
    <div className="mt-1.5 space-y-1.5">
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void view()}
        disabled={busy || inv.files === 0}
        className="flex items-center gap-1 rounded-btn border border-line px-2 py-1 text-[11px] font-bold text-link hover:border-link hover:bg-sel-bg disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Consulter la facture
        {inv.files > 1 && <span className="font-normal text-ink-4">({inv.files} fichiers)</span>}
      </button>
      <span className={`rounded-chip px-1.5 py-0.5 text-[10px] font-bold ${tone}`}>{INVOICE_STATUS_LABELS[inv.status ?? ""] ?? inv.status ?? "—"}</span>
      {inv.amountTtc !== null && (
        <span className={`text-[11px] ${inv.amountTtc !== e.amount ? "font-bold text-warn" : "text-ink-4"}`} title={inv.amountTtc !== e.amount ? "Montant facturé différent du montant prévu" : undefined}>
          {euros(inv.amountTtc)} TTC
        </span>
      )}
      {inv.status === "pending" && !rejecting && (
        <>
          <button
            type="button"
            onClick={() => void review("approved")}
            disabled={!!reviewing}
            className="flex items-center gap-1 rounded-btn bg-good px-2 py-1 text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {reviewing === "approved" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Valider
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            disabled={!!reviewing}
            className="rounded-btn border border-bad/40 px-2 py-1 text-[11px] font-bold text-bad hover:bg-bad-bg disabled:opacity-50"
          >
            Refuser
          </button>
        </>
      )}
    </div>
    {rejecting && (
      <div className="flex items-start gap-2">
        <input
          autoFocus
          value={motive}
          onChange={(ev) => setMotive(ev.target.value)}
          onKeyDown={(ev) => ev.key === "Enter" && motive.trim() && void review("rejected")}
          placeholder="Motif du refus (envoyé au prestataire)"
          className="min-w-0 flex-1 rounded-btn border border-line px-2 py-1 text-[12px] outline-none focus:border-line-strong"
        />
        <button
          type="button"
          onClick={() => void review("rejected")}
          disabled={!motive.trim() || !!reviewing}
          className="flex items-center gap-1 rounded-btn bg-bad px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {reviewing === "rejected" && <Loader2 size={11} className="animate-spin" />} Refuser
        </button>
        <button type="button" onClick={() => setRejecting(false)} aria-label="Annuler" className="rounded-md p-1 text-ink-4 hover:bg-hover">
          <X size={12} />
        </button>
      </div>
    )}
    {inv.status === "rejected" && inv.comment && <p className="text-[11px] text-bad">Motif du refus : {inv.comment}</p>}
    {notice && <p className="text-[11px] font-semibold text-good">{notice}</p>}
    </div>
  );
}

/** Mot facultatif joint à la réclamation, puis envoi de l'e-mail. */
export function ClaimForm({
  busy,
  note,
  onNote,
  onSend,
  onCancel,
  count = 1,
}: {
  busy: boolean;
  note: string;
  onNote: (v: string) => void;
  onSend: () => void;
  onCancel: () => void;
  count?: number;
}) {
  return (
    <div className="space-y-1.5 rounded-btn border border-line bg-card p-2">
      <textarea
        autoFocus
        value={note}
        onChange={(ev) => onNote(ev.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Message pour le prestataire (facultatif) — ex. merci d'indiquer le n° de match sur la facture"
        className="w-full resize-none rounded-btn border border-line px-2 py-1.5 text-[12px] outline-none focus:border-line-strong"
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-btn px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-hover">
          Annuler
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={busy}
          className="flex items-center gap-1 rounded-btn bg-navy px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />} Envoyer {count > 1 ? `la réclamation (${count} factures)` : "la réclamation"}
        </button>
      </div>
    </div>
  );
}
