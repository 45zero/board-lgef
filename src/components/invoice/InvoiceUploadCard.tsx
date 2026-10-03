"use client";

import { useRef, useState } from "react";
import { CalendarDays, Check, FileUp, Loader2, MapPin, MessageSquareQuote } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { confirmInvoiceUpload, prepareInvoiceUpload, type InvoiceRequestInfo, type InvoiceRequestItem } from "@/app/actions/invoice-public";

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const longDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

type State = "todo" | "pending" | "approved" | "rejected" | "sent";
const stateOf = (item: InvoiceRequestItem): State =>
  !item.existing ? "todo" : item.existing.status === "approved" ? "approved" : item.existing.status === "rejected" ? "rejected" : "pending";

/**
 * Dépôt des factures depuis le lien reçu par e-mail : mode d'emploi, mot du responsable, puis une
 * carte par intervention (date, lieu, montant convenu) avec son propre dépôt.
 */
export function InvoiceUploadCard({ token, info }: { token: string; info: InvoiceRequestInfo }) {
  const [states, setStates] = useState<Record<string, State>>(() => Object.fromEntries(info.items.map((i) => [i.eventId, stateOf(i)])));
  const remaining = info.items.filter((i) => states[i.eventId] === "todo" || states[i.eventId] === "rejected").length;
  const total = info.items.length;

  return (
    <div className="w-full max-w-xl overflow-hidden rounded-modal border border-line bg-card shadow-card">
      <div className="bg-navy px-6 py-5 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo statique léger */}
        <img src="/lgef-logo.png" alt="LGEF" className="mb-3 h-10 w-auto rounded bg-white p-1" />
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/70">Ligue du Grand Est de Football</p>
        <h1 className="mt-1 text-xl font-extrabold">Dépôt de {total > 1 ? "vos factures" : "votre facture"}</h1>
        <p className="mt-1 text-sm text-white/85">
          Bonjour {info.personFirstName}, {remaining === 0 ? "tout est déposé, merci !" : `${remaining} facture${remaining > 1 ? "s" : ""} à déposer sur ${total}.`}
        </p>
      </div>

      <div className="space-y-5 p-6">
        {/* Mode d'emploi */}
        <ol className="grid gap-2 text-[13px] text-ink-2 sm:grid-cols-3">
          {[
            ["Une facture par intervention", "au nom de la Ligue, avec la date et l'événement"],
            ["Joignez le fichier", "PDF ou photo lisible, 15 Mo max."],
            ["Vérifiez le montant TTC", "puis « Déposer » : votre responsable la valide"],
          ].map(([title, hint], i) => (
            <li key={title} className="rounded-btn bg-subtle px-3 py-2.5">
              <span className="mb-1 flex h-5 w-5 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-white">{i + 1}</span>
              <span className="block font-bold text-ink">{title}</span>
              <span className="block text-[11px] text-ink-3">{hint}</span>
            </li>
          ))}
        </ol>

        {info.comment && (
          <div className="flex gap-2 rounded-btn border-l-4 border-navy bg-sel-bg px-3 py-2.5 text-sm text-ink-2">
            <MessageSquareQuote size={16} className="mt-0.5 shrink-0 text-link" />
            <p>
              <span className="block text-[11px] font-bold text-ink-3">Message de {info.requesterName}</span>
              <span className="whitespace-pre-wrap">{info.comment}</span>
            </p>
          </div>
        )}

        <div className="space-y-3">
          {info.items.map((item) => (
            <ItemCard key={item.eventId} token={token} item={item} state={states[item.eventId]} onSent={() => setStates((s) => ({ ...s, [item.eventId]: "sent" }))} />
          ))}
        </div>

        <p className="text-center text-[11px] text-ink-4">
          Votre responsable est prévenu à chaque dépôt et vous recevez un e-mail quand la facture est validée (ou s&rsquo;il faut la corriger). Une question ? Répondez
          simplement à l&rsquo;e-mail, ou écrivez à {info.requesterName}
          {info.requesterEmail ? ` (${info.requesterEmail})` : ""}.
        </p>
      </div>
    </div>
  );
}

function ItemCard({ token, item, state, onSent }: { token: string; item: InvoiceRequestItem; state: State; onSent: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState(item.expectedAmount !== null ? String(item.expectedAmount).replace(".", ",") : "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const open = state === "todo" || state === "rejected";

  const submit = async () => {
    if (!file) return setError("Choisissez le fichier de votre facture.");
    const parsed = Number(amount.replace(",", ".").replace(/\s|€/g, ""));
    if (!amount.trim() || !Number.isFinite(parsed)) return setError("Indiquez le montant TTC de la facture.");
    setBusy(true);
    setError(null);
    try {
      const prep = await prepareInvoiceUpload(token, item.eventId, file.name, file.type, file.size);
      if (!prep.ok) throw new Error(prep.error);
      const { error: upErr } = await createClient().storage.from("invoices").uploadToSignedUrl(prep.data.path, prep.data.uploadToken, file, { contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      const conf = await confirmInvoiceUpload(token, item.eventId, prep.data.path, parsed, comment);
      if (!conf.ok) throw new Error(conf.error);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible, réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const badge: Record<State, { label: string; tone: string }> = {
    todo: { label: "À déposer", tone: "bg-warn-bg text-warn" },
    rejected: { label: "À corriger", tone: "bg-bad-bg text-bad" },
    pending: { label: "Déposée · en validation", tone: "bg-sel-bg text-link" },
    approved: { label: "Validée", tone: "bg-good-bg text-good" },
    sent: { label: "Déposée ✓", tone: "bg-good-bg text-good" },
  };

  return (
    <div className={`rounded-card border ${open ? "border-line-strong" : "border-line opacity-80"}`}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{item.eventTitle}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
            <CalendarDays size={12} /> {longDate(item.eventStart)}
          </p>
          {item.location && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
              <MapPin size={12} /> {item.location}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <span className={`rounded-chip px-2 py-0.5 text-[10px] font-bold ${badge[state].tone}`}>{badge[state].label}</span>
          {item.expectedAmount !== null && (
            <p className="mt-1 text-xs text-ink-3">
              Convenu : <b className="text-ink">{euros(item.expectedAmount)}</b>
            </p>
          )}
        </div>
      </div>

      {state === "rejected" && item.existing?.comment && <p className="mx-4 mb-2 rounded-btn bg-bad-bg px-3 py-2 text-xs text-bad">Motif du refus : {item.existing.comment}</p>}

      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-btn border-2 border-dashed border-line-strong px-3 py-3 text-sm font-semibold text-ink-2 hover:bg-hover"
          >
            {file ? <Check size={16} className="text-good" /> : <FileUp size={16} />} {file ? file.name : "Choisir le fichier de la facture"}
          </button>
          <input ref={input} type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="flex gap-2">
            <label className="flex w-36 shrink-0 items-center gap-1 rounded-btn border border-line px-2.5 py-2 text-sm focus-within:border-line-strong">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Montant" className="min-w-0 flex-1 text-right outline-none" />
              <span className="text-ink-4">€ TTC</span>
            </label>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Commentaire (facultatif)"
              className="min-w-0 flex-1 rounded-btn border border-line px-2.5 py-2 text-sm outline-none focus:border-line-strong"
            />
          </div>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !file}
            className="flex w-full items-center justify-center gap-2 rounded-btn bg-red py-2.5 text-sm font-bold text-white shadow-btn-red disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Déposer cette facture
          </button>
        </div>
      )}
    </div>
  );
}
