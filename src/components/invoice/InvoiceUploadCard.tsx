"use client";

import { useRef, useState } from "react";
import { CalendarDays, Check, FileUp, Loader2, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { confirmInvoiceUpload, prepareInvoiceUpload, type InvoiceRequestInfo } from "@/app/actions/invoice-public";

const STATUS: Record<string, string> = { pending: "à valider", approved: "validée", rejected: "refusée" };
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/** Dépôt d'une facture depuis le lien reçu par e-mail : fichier (PDF ou photo), montant TTC, commentaire. */
export function InvoiceUploadCard({ token, info }: { token: string; info: InvoiceRequestInfo }) {
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState(info.expectedAmount !== null ? String(info.expectedAmount).replace(".", ",") : "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const date = new Date(info.eventStart).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const submit = async () => {
    if (!file) return setError("Choisissez le fichier de votre facture.");
    const parsed = Number(amount.replace(",", ".").replace(/\s|€/g, ""));
    if (!amount.trim() || !Number.isFinite(parsed)) return setError("Indiquez le montant TTC de la facture.");
    setBusy(true);
    setError(null);
    try {
      const prep = await prepareInvoiceUpload(token, file.name, file.type, file.size);
      if (!prep.ok) throw new Error(prep.error);
      const { error: upErr } = await createClient().storage.from("invoices").uploadToSignedUrl(prep.data.path, prep.data.uploadToken, file, { contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      const conf = await confirmInvoiceUpload(token, prep.data.path, parsed, comment);
      if (!conf.ok) throw new Error(conf.error);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible, réessayez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-md overflow-hidden rounded-modal border border-line bg-card shadow-card">
      <div className="bg-navy px-6 py-5 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo statique léger */}
        <img src="/lgef-logo.png" alt="LGEF" className="mb-3 h-10 w-auto rounded bg-white p-1" />
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/70">Dépôt de facture</p>
        <h1 className="mt-1 text-lg font-extrabold leading-snug">{info.eventTitle}</h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-white/85">
          <CalendarDays size={14} /> {date}
        </p>
        {info.location && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-white/85">
            <MapPin size={14} /> {info.location}
          </p>
        )}
      </div>

      {done ? (
        <div className="p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-good-bg text-good">
            <Check size={24} />
          </span>
          <p className="mt-3 text-base font-bold text-ink">Merci {info.personFirstName}, votre facture est bien déposée.</p>
          <p className="mt-1 text-sm text-ink-3">{info.requesterName} est prévenu(e) et la validera prochainement.</p>
        </div>
      ) : (
        <div className="space-y-4 p-6">
          <p className="text-sm text-ink-2">
            Bonjour {info.personFirstName}, merci de déposer votre facture pour cette intervention.
            {info.expectedAmount !== null && (
              <>
                {" "}
                Montant convenu : <b>{euros(info.expectedAmount)}</b>.
              </>
            )}
          </p>
          {info.existing && (
            <p className="rounded-btn bg-warn-bg px-3 py-2 text-xs text-warn">
              Une facture est déjà enregistrée ({STATUS[info.existing.status ?? ""] ?? info.existing.status}
              {info.existing.amountTtc !== null && `, ${euros(info.existing.amountTtc)}`}).{" "}
              {info.existing.status === "rejected" ? "Ce nouveau dépôt la remplacera." : "Ce fichier y sera ajouté."}
            </p>
          )}

          <div>
            <label className="mb-1 block text-xs font-bold text-ink-3">Facture (PDF ou photo, 15 Mo max.)</label>
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-btn border-2 border-dashed border-line-strong px-3 py-5 text-sm font-semibold text-ink-2 hover:bg-hover"
            >
              <FileUp size={18} /> {file ? file.name : "Choisir le fichier"}
            </button>
            <input ref={input} type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-ink-3">Montant TTC (€)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="150,00"
              className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none focus:border-line-strong"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-ink-3">Commentaire (facultatif)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-btn border border-line px-3 py-2 text-sm outline-none focus:border-line-strong"
            />
          </div>

          {error && <p className="text-sm text-bad">{error}</p>}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !file}
            className="flex w-full items-center justify-center gap-2 rounded-btn bg-red py-3 text-sm font-bold text-white shadow-btn-red disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} Déposer ma facture
          </button>
          <p className="text-center text-[11px] text-ink-4">
            Une question ? Répondez simplement à l&rsquo;e-mail, ou écrivez à {info.requesterName}
            {info.requesterEmail ? ` (${info.requesterEmail})` : ""}.
          </p>
        </div>
      )}
    </div>
  );
}
