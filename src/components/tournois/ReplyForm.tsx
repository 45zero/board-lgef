"use client";

import { useState } from "react";
import { Check, Download, FileText, Loader2, Paperclip, Send, Trash2 } from "lucide-react";
import { finalizeTournamentReply, submitTournamentReply, type ReplyContext } from "@/app/actions/tournois-public";
import { ACCEPTED_FILES, FILE_KIND_LABELS, fmtSize, MAX_FILE_BYTES } from "@/lib/tournois/shared";
import { uploadPiece } from "@/components/tournois/upload";

// Page de réponse d'un dossier de tournoi (bouton « Répondre » des mails) : le destinataire voit le
// message reçu et les pièces jointes, puis écrit sa réponse (avec pièces) qui arrive dans le board.

const fmtAt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
const input = "w-full rounded-btn border border-line-strong bg-card px-3 py-2.5 text-[15px] text-ink outline-none focus:border-navy focus:ring-2 focus:ring-navy/15";

export function ReplyForm({ token, ctx }: { token: string; ctx: ReplyContext }) {
  const [name, setName] = useState(ctx.recipientName ?? "");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<{ failed: string[] } | null>(null);
  const [replies, setReplies] = useState(ctx.replies);

  const t = encodeURIComponent(token);
  const fileUrl = (id: string, dl = false) => `/api/tournoi/file?f=${id}&t=${t}${dl ? "&dl=1" : ""}`;

  const send = async () => {
    setError(null);
    if (name.trim().length < 2) return setError("Indiquez votre nom.");
    if (message.trim().length < 2) return setError("Écrivez votre message.");
    setSending("Envoi du message…");
    try {
      const res = await submitTournamentReply(token, {
        name,
        message,
        files: files.map((f) => ({ name: f.name, mimeType: f.type || "application/octet-stream", size: f.size })),
      });
      if (!res.ok) throw new Error(res.error);
      const failed: string[] = [];
      for (const slot of res.data.uploads) {
        const f = files[slot.index];
        if (!f) continue;
        setSending(`Envoi de « ${f.name} »…`);
        try {
          await uploadPiece(f, slot.fileId, () => undefined);
        } catch {
          failed.push(f.name);
        }
      }
      if (res.data.uploads.length) await finalizeTournamentReply(token, res.data.messageId);
      setReplies((r) => [...r, { at: new Date().toISOString(), body: message, files: files.length - failed.length }]);
      setSent({ failed });
      setMessage("");
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'envoi a échoué. Réessayez.");
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <header className="mb-5 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo statique léger */}
        <img src="/lgef-logo.png" alt="Ligue du Grand Est de Football" className="h-12 w-auto" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-4">Dossier {ctx.ref}</p>
          <h1 className="text-lg font-extrabold leading-tight text-ink">{ctx.title}</h1>
          <p className="text-sm text-ink-3">
            {ctx.clubName} · {ctx.period}
          </p>
        </div>
      </header>

      <section className="rounded-modal border border-line bg-card p-5 shadow-card">
        <p className="text-xs text-ink-4">
          {ctx.senderName ? `${ctx.senderName} · ` : ""}
          {fmtAt(ctx.sentAt)}
        </p>
        <h2 className="mt-1 text-base font-extrabold text-ink">{ctx.subject}</h2>
        <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{ctx.body}</p>

        {(ctx.files.length > 0 || ctx.pdf) && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-bold text-ink">Pièces</p>
            {ctx.pdf && <PieceRow name={`Récapitulatif de la déclaration ${ctx.ref}.pdf`} kind="Récapitulatif" open={`/api/tournoi/pdf?t=${t}`} download={`/api/tournoi/pdf?t=${t}&dl=1`} />}
            {ctx.files.map((f) => (
              <PieceRow
                key={f.id}
                name={f.name}
                kind={`${FILE_KIND_LABELS[f.kind as keyof typeof FILE_KIND_LABELS] ?? "Pièce"}${f.size ? ` · ${fmtSize(f.size)}` : ""}`}
                open={fileUrl(f.id)}
                download={fileUrl(f.id, true)}
              />
            ))}
          </div>
        )}
      </section>

      {replies.length > 0 && (
        <section className="mt-4 space-y-2">
          {replies.map((r, i) => (
            <div key={i} className="ml-6 rounded-card border border-line bg-sel-bg p-3">
              <p className="text-xs text-ink-4">Votre réponse · {fmtAt(r.at)}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{r.body}</p>
              {r.files > 0 && (
                <p className="mt-1 text-xs text-ink-3">
                  {r.files} pièce{r.files > 1 ? "s" : ""} jointe{r.files > 1 ? "s" : ""}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="mt-4 rounded-modal border border-line bg-card p-5 shadow-card">
        {sent && (
          <p className="mb-4 flex items-start gap-2 rounded-btn bg-good-bg px-3 py-2 text-sm text-good">
            <Check size={16} className="mt-0.5 shrink-0" />
            <span>
              Message envoyé : il est arrivé dans le dossier et la personne qui suit la déclaration est prévenue.
              {sent.failed.length > 0 && ` Pièce(s) non envoyée(s) : ${sent.failed.join(", ")}.`}
            </span>
          </p>
        )}
        <h2 className="text-base font-extrabold text-ink">{replies.length ? "Écrire un nouveau message" : "Répondre"}</h2>
        <p className="mb-3 text-xs text-ink-4">Vous répondez en tant que {ctx.recipientEmail}</p>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink-2">Votre nom</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-semibold text-ink-2">Message</span>
          <textarea rows={6} className={input} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="mt-3">
          {files.map((f) => (
            <div key={f.name + f.size} className="mb-1 flex items-center gap-2 text-sm text-ink-2">
              <FileText size={16} className="shrink-0 text-navy" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-ink-4">{fmtSize(f.size)}</span>
              <button type="button" onClick={() => setFiles(files.filter((x) => x !== f))} className="rounded-btn p-1 text-ink-4 hover:bg-hover" aria-label="Retirer">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {files.length < 5 && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-btn bg-subtle px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover">
              <Paperclip size={15} /> Joindre un fichier
              <input
                type="file"
                multiple
                accept={ACCEPTED_FILES}
                className="sr-only"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  const big = list.find((f) => f.size > MAX_FILE_BYTES);
                  if (big) setError(`« ${big.name} » dépasse 20 Mo.`);
                  else setFiles([...files, ...list].slice(0, 5));
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
        {error && <p className="mt-3 rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
        <button
          type="button"
          onClick={send}
          disabled={!!sending}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-btn bg-red px-5 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60 sm:w-auto"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {sending ?? "Envoyer"}
        </button>
      </section>
    </div>
  );
}

function PieceRow({ name, kind, open, download }: { name: string; kind: string; open: string; download: string }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-line px-3 py-2">
      <FileText size={18} className="shrink-0 text-navy" />
      <a href={open} target="_blank" rel="noopener" className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink hover:underline">{name}</span>
        <span className="block text-xs text-ink-4">{kind}</span>
      </a>
      <a href={download} className="rounded-btn p-2 text-ink-3 hover:bg-hover" aria-label={`Télécharger ${name}`}>
        <Download size={16} />
      </a>
    </div>
  );
}
