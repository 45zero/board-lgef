"use client";

import { useEffect, useMemo, useState } from "react";
import { X, FileText, FileVideo, FileImage, FileAudio, File as FileIcon, Download } from "lucide-react";
import { fileKind, formatBytes, type FileKind, type TransferPreview } from "@/lib/transfer/shared";

// Aperçu des fichiers de LGEF Transfer : fichier local (l'expéditeur revoit ce qu'il va envoyer,
// rien ne quitte son ordinateur) ou fichier en ligne (page de téléchargement, aperçu du Drive).

/** URL locale (blob:) d'un fichier, libérée quand il change ou au démontage. */
function useObjectUrl(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url]
  );
  return url;
}

export function KindIcon({ kind, size = 18 }: { kind: FileKind; size?: number }) {
  const Icon = kind === "image" ? FileImage : kind === "video" ? FileVideo : kind === "audio" ? FileAudio : kind === "pdf" || kind === "text" ? FileText : FileIcon;
  return <Icon size={size} />;
}

/** Vignette d'un fichier local (image : miniature réelle). */
export function LocalThumb({ file }: { file: File }) {
  const kind = fileKind(file.type, file.name);
  const url = useObjectUrl(kind === "image" ? file : null);
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-btn bg-sel-bg text-link">
      {/* eslint-disable-next-line @next/next/no-img-element -- miniature locale (blob:) */}
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <KindIcon kind={kind} />}
    </span>
  );
}

function Shell({ title, subtitle, onClose, children, actions }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Aperçu de ${title}`}>
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{title}</p>
          {subtitle && <p className="text-xs text-white/60">{subtitle}</p>}
        </div>
        {actions}
        <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Fermer l'aperçu">
          <X size={20} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 pt-0 sm:p-6 sm:pt-0" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Unavailable({ text }: { text: string }) {
  return (
    <div className="rounded-card bg-white/10 px-6 py-10 text-center text-sm text-white/80">
      <FileIcon size={36} className="mx-auto mb-3 opacity-60" />
      {text}
    </div>
  );
}

/** Aperçu d'un fichier local, avant envoi. */
export function LocalPreviewModal({ file, onClose }: { file: File; onClose: () => void }) {
  const kind = fileKind(file.type, file.name);
  const url = useObjectUrl(kind === "text" || kind === "other" ? null : file);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (kind === "text") void file.slice(0, 200_000).text().then(setText);
  }, [file, kind]);

  return (
    <Shell title={file.name} subtitle={formatBytes(file.size)} onClose={onClose}>
      {kind === "image" && url && (
        /* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) */
        <img src={url} alt={file.name} className="max-h-full max-w-full rounded-btn object-contain" />
      )}
      {kind === "video" && url && <video src={url} controls autoPlay playsInline className="max-h-full max-w-full rounded-btn bg-black" />}
      {kind === "audio" && url && <audio src={url} controls autoPlay className="w-full max-w-lg" />}
      {kind === "pdf" && url && <iframe src={url} title={file.name} className="h-full w-full max-w-4xl rounded-btn bg-white" />}
      {kind === "text" && text !== null && <pre className="h-full w-full max-w-4xl overflow-auto whitespace-pre-wrap rounded-btn bg-white p-4 text-xs text-ink">{text}</pre>}
      {kind === "other" && <Unavailable text="Pas d'aperçu pour ce type de fichier — il sera envoyé tel quel." />}
    </Shell>
  );
}

/** Aperçu d'un fichier en ligne (page de téléchargement, onglet Transferts). */
export function RemotePreviewModal({
  file,
  onClose,
  downloadHref,
}: {
  file: { name: string; size: number; mimeType: string; preview: TransferPreview };
  onClose: () => void;
  downloadHref?: string;
}) {
  const p = file.preview;
  return (
    <Shell
      title={file.name}
      subtitle={formatBytes(file.size)}
      onClose={onClose}
      actions={
        downloadHref ? (
          <a href={downloadHref} className="flex items-center gap-1.5 rounded-btn bg-red px-3 py-2 text-xs font-bold text-white hover:bg-red-700">
            <Download size={14} /> Télécharger
          </a>
        ) : null
      }
    >
      {p.kind === "image" && (
        /* eslint-disable-next-line @next/next/no-img-element -- aperçu du Drive (domaine externe) */
        <img src={p.url} alt={file.name} className="max-h-full max-w-full rounded-btn object-contain" />
      )}
      {p.kind === "video" && <video src={p.url} controls autoPlay playsInline className="max-h-full max-w-full rounded-btn bg-black" />}
      {p.kind === "iframe" && <iframe src={p.url} title={file.name} allow="autoplay; fullscreen" allowFullScreen className="h-full w-full max-w-5xl rounded-btn bg-black" />}
      {p.kind === "none" && <Unavailable text="Pas d'aperçu pour ce type de fichier — téléchargez-le pour l'ouvrir." />}
    </Shell>
  );
}
