"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, ImagePlus, LifeBuoy, Loader2, MonitorUp, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/board/actionResult";
import { normalizePhoto } from "@/lib/board/receiptUpload";
import { collectSupportContext, SUPPORT_STATUS, type SupportContext } from "@/lib/board/supportContext";
import { createSupportUploads, listSupportTickets, submitSupportTicket, updateSupportTicket, type SupportStatus, type SupportTicket } from "@/app/actions/support";
import { BOARD_APPS } from "@/lib/board/tokens";

// Centre d'aide : « Signaler » (texte, photos, capture de l'écran), « Mes signalements » (suivi et
// réponse), « Tous les tickets » pour les admins et super users (statut, réponse à l'auteur).

type Tab = "new" | "mine" | "all";
type Picked = { file: File; preview: string };

const MAX_FILES = 6;
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Une erreur est survenue.");
const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const appLabel = (id: string | null) => BOARD_APPS.find((a) => a.id === id)?.label ?? id ?? "—";

/** Capture de l'onglet (ordinateur) : le navigateur demande quoi partager, une image est prise. */
async function captureScreen(): Promise<File | null> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true } as DisplayMediaStreamOptions);
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Le temps que la fenêtre du centre d'aide disparaisse de l'image.
    await new Promise((r) => setTimeout(r, 400));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }) : null;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function SupportModal({ app, isStaff, focusTicketId, onClose }: { app: string | null; isStaff: boolean; focusTicketId?: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(focusTicketId ? (isStaff ? "all" : "mine") : "new");
  const [capturing, setCapturing] = useState(false);

  const tabs: { id: Tab; label: string }[] = [
    { id: "new", label: "Signaler" },
    { id: "mine", label: "Mes signalements" },
    ...(isStaff ? [{ id: "all" as const, label: "Tous les tickets" }] : []),
  ];

  return (
    <div className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 ${capturing ? "invisible" : ""}`} onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Centre d&apos;aide</div>
            <h3 className="mt-1 flex items-center gap-2 text-base font-extrabold">
              <LifeBuoy size={17} /> Un problème avec le board ?
            </h3>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="flex shrink-0 gap-1 border-b border-line px-4 pt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-t-btn px-3 py-2 text-sm font-semibold ${tab === t.id ? "border-b-2 border-red text-ink" : "text-ink-3 hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "new" && <NewTicket app={app} onCapturing={setCapturing} onSent={() => setTab("mine")} />}
          {tab === "mine" && <TicketList scope="mine" focusId={focusTicketId} />}
          {tab === "all" && isStaff && <TicketList scope="all" focusId={focusTicketId} />}
        </div>
      </div>
    </div>
  );
}

function NewTicket({ app, onCapturing, onSent }: { app: string | null; onCapturing: (on: boolean) => void; onSent: () => void }) {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCapture = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  const add = (list: File[]) => {
    setError(null);
    const images = list.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    setFiles((prev) => [...prev, ...images.map((file) => ({ file, preview: URL.createObjectURL(file) }))].slice(0, MAX_FILES));
  };
  const remove = (i: number) =>
    setFiles((prev) => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, j) => j !== i);
    });

  const capture = async () => {
    onCapturing(true);
    try {
      const shot = await captureScreen();
      if (shot) add([shot]);
    } catch {
      // Partage refusé ou annulé : rien à faire.
    } finally {
      onCapturing(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const context: SupportContext = collectSupportContext();
      let paths: string[] = [];
      if (files.length) {
        const targets = unwrap(await createSupportUploads(files.length));
        const storage = createClient().storage.from("support");
        paths = await Promise.all(
          files.map(async ({ file }, i) => {
            const photo = await normalizePhoto(file);
            const { error } = await storage.uploadToSignedUrl(targets[i].path, targets[i].token, photo, { contentType: photo.type || "image/jpeg" });
            if (error) throw new Error("Envoi d'une photo impossible.");
            return targets[i].path;
          })
        );
      }
      unwrap(await submitSupportTicket({ message, app, context, attachments: paths }));
      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setMessage("");
      setFiles([]);
      onSent();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const full = files.length >= MAX_FILES;

  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-ink-3">
        Décrivez ce qui ne va pas : ce que vous faisiez, ce que vous attendiez, ce qui s&apos;est passé. La page, votre appareil et les erreurs
        techniques sont joints automatiquement.
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onPaste={(e) => add(Array.from(e.clipboardData.files))}
        rows={6}
        maxLength={5000}
        autoFocus
        placeholder="Ex. : dans le calendrier, quand j'accepte une couverture, le bouton tourne sans fin…"
        className="w-full resize-y rounded-btn border border-line bg-subtle px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
      />

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={f.preview} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) */}
              <img src={f.preview} alt="" className="h-20 w-20 rounded-btn border border-line object-cover" />
              <button
                onClick={() => remove(i)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-navy text-white"
                aria-label="Retirer la photo"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className={`flex cursor-pointer items-center gap-1.5 rounded-btn border border-line px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover ${full ? "pointer-events-none opacity-50" : ""}`}>
          <ImagePlus size={15} /> Joindre des photos
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>
        <label className={`flex cursor-pointer items-center gap-1.5 rounded-btn border border-line px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover md:hidden ${full ? "pointer-events-none opacity-50" : ""}`}>
          <Camera size={15} /> Prendre une photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>
        {canCapture && (
          <button
            onClick={() => void capture()}
            disabled={full}
            className="hidden items-center gap-1.5 rounded-btn border border-line px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover disabled:opacity-50 md:flex"
          >
            <MonitorUp size={15} /> Capturer l&apos;écran
          </button>
        )}
        <span className="text-xs text-ink-4">
          {files.length}/{MAX_FILES}
          <span className="hidden md:inline"> · coller une capture (⌘V) marche aussi</span>
        </span>
      </div>

      {error && <div className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>}

      <div className="flex justify-end">
        <button
          onClick={() => void send()}
          disabled={busy || message.trim().length < 3}
          className="flex items-center gap-2 rounded-btn bg-red px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          Envoyer le signalement
        </button>
      </div>
    </div>
  );
}

function TicketList({ scope, focusId }: { scope: "mine" | "all"; focusId?: string }) {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(scope === "all");
  const [expanded, setExpanded] = useState<string | null>(focusId ?? null);

  const load = useCallback(() => {
    listSupportTickets(scope)
      .then((r) => setTickets(unwrap(r)))
      .catch((e) => setError(errorMessage(e)));
  }, [scope]);
  useEffect(load, [load]);

  if (error) return <div className="m-4 rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>;
  if (!tickets) return <p className="p-8 text-center text-sm text-ink-4">Chargement…</p>;

  const shown = openOnly ? tickets.filter((t) => t.status === "nouveau" || t.status === "en_cours" || t.id === focusId) : tickets;

  return (
    <div className="space-y-2 p-4">
      {scope === "all" && (
        <label className="flex items-center gap-2 text-xs font-semibold text-ink-3">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Seulement les tickets ouverts
        </label>
      )}
      {shown.length === 0 && <p className="p-6 text-center text-sm text-ink-4">{scope === "mine" ? "Aucun signalement pour l'instant." : "Aucun ticket."}</p>}
      {shown.map((t) => (
        <TicketCard key={t.id} ticket={t} staff={scope === "all"} open={expanded === t.id} onToggle={() => setExpanded((id) => (id === t.id ? null : t.id))} onSaved={load} />
      ))}
    </div>
  );
}

function TicketCard({ ticket: t, staff, open, onToggle, onSaved }: { ticket: SupportTicket; staff: boolean; open: boolean; onToggle: () => void; onSaved: () => void }) {
  const status = SUPPORT_STATUS[t.status] ?? SUPPORT_STATUS.nouveau;
  const ctx = (t.context ?? {}) as Partial<SupportContext>;

  return (
    <div className="rounded-btn border border-line bg-card">
      <button onClick={onToggle} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-hover">
        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${status.tone}`}>{status.label}</span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm text-ink ${open ? "whitespace-pre-wrap" : "truncate"}`}>{t.message}</span>
          <span className="mt-0.5 block text-xs text-ink-4">
            {staff && `${t.author.name} · `}
            {when(t.createdAt)} · {appLabel(t.app)}
            {t.attachments.length > 0 && ` · ${t.attachments.length} photo${t.attachments.length > 1 ? "s" : ""}`}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          {t.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {t.attachments.map((a) => (
                <a key={a.path} href={a.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL signée du bucket privé */}
                  <img src={a.url} alt="" className="h-24 w-24 rounded-btn border border-line object-cover hover:opacity-80" />
                </a>
              ))}
            </div>
          )}
          {t.resolution && !staff && <div className="rounded-btn bg-good-bg px-3 py-2 text-sm text-good">{t.resolution}</div>}
          {!t.resolution && !staff && t.status !== "regle" && <p className="text-xs text-ink-4">Bien reçu — vous serez prévenu dès que c&apos;est réglé.</p>}
          {staff && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-ink-4">Page</dt>
                <dd className="break-all text-ink-2">{ctx.url ?? "—"}</dd>
                <dt className="text-ink-4">Appareil</dt>
                <dd className="text-ink-2">
                  {ctx.userAgent ?? "—"} · écran {ctx.viewport ?? "?"}
                </dd>
                <dt className="text-ink-4">Version</dt>
                <dd className="font-mono text-ink-2">{ctx.version ?? "—"}</dd>
                <dt className="text-ink-4">Ticket</dt>
                <dd className="font-mono text-ink-2">{t.id}</dd>
              </dl>
              {!!ctx.errors?.length && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-bad">{ctx.errors.length} erreur(s) technique(s) avant l&apos;envoi</summary>
                  <ul className="mt-1 space-y-1 font-mono text-[11px] text-ink-3">
                    {ctx.errors.map((e, i) => (
                      <li key={i} className="break-all">
                        [{e.kind}] {e.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <StaffActions ticket={t} onSaved={onSaved} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StaffActions({ ticket, onSaved }: { ticket: SupportTicket; onSaved: () => void }) {
  const [status, setStatus] = useState<SupportStatus>(ticket.status);
  const [resolution, setResolution] = useState(ticket.resolution ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      unwrap(await updateSupportTicket(ticket.id, { status, resolution }));
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-btn bg-subtle p-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SUPPORT_STATUS) as SupportStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-2.5 py-1 text-xs font-bold ${status === s ? `${SUPPORT_STATUS[s].tone} ring-1 ring-current` : "text-ink-3 hover:bg-hover"}`}
          >
            {SUPPORT_STATUS[s].label}
          </button>
        ))}
      </div>
      <textarea
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
        rows={2}
        placeholder="Réponse à l'auteur (envoyée quand le ticket passe à « Réglé »)"
        className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
      />
      {error && <div className="text-xs text-bad">{error}</div>}
      <div className="flex justify-end">
        <button onClick={() => void save()} disabled={busy} className="rounded-btn bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-600 disabled:opacity-50">
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
