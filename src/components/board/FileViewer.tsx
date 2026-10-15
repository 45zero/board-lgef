"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { X, Download, ExternalLink } from "lucide-react";

/**
 * Aperçu d'un fichier dans le board (images, vidéos, sons, PDF, textes) — plutôt qu'un nouvel onglet,
 * que l'appli Android transforme en « Ouvrir avec » et liste de navigateurs. `getUrl` : lien du
 * fichier (relais signé du board pour le Drive), demandé à l'ouverture ; `downloadAs` le télécharge.
 */
export function FileViewer({
  name,
  contentType,
  getUrl,
  onClose,
}: {
  name: string;
  contentType: string | null;
  getUrl: (downloadAs?: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const m = (contentType ?? "").toLowerCase();
  // La WebView Android n'affiche pas les PDF : ils passent par le téléchargement.
  const native = Capacitor.isNativePlatform();

  useEffect(() => {
    let alive = true;
    getUrl()
      .catch(() => null)
      .then((u) => alive && setSrc(u));
    getUrl(name)
      .catch(() => null)
      .then((u) => alive && setDownloadUrl(u));
    return () => {
      alive = false;
    };
    // Lien demandé une fois par fichier ouvert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);

  let body: React.ReactNode;
  if (src === undefined) body = <p className="text-sm text-white/80">Chargement…</p>;
  else if (src === null) body = <p className="text-sm text-white/80">Fichier indisponible.</p>;
  // eslint-disable-next-line @next/next/no-img-element -- fichier relayé depuis le Drive du board
  else if (m.startsWith("image/")) body = <img src={src} alt={name} className="max-h-full max-w-full object-contain" />;
  else if (m.startsWith("video/")) body = <video src={src} controls autoPlay playsInline className="max-h-full max-w-full" />;
  else if (m.startsWith("audio/")) body = <audio src={src} controls autoPlay />;
  else if (!native && (m === "application/pdf" || m.startsWith("text/")))
    body = <iframe src={src} title={name} className="h-full w-full rounded-btn bg-white" />;
  else
    body = (
      <div className="rounded-card bg-card p-8 text-center">
        <p className="text-sm font-bold text-ink">Aperçu indisponible pour ce format.</p>
        <div className="mt-3 flex justify-center gap-2">
          {downloadUrl && (
            <a href={downloadUrl} download={name} className="inline-flex items-center gap-1.5 rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white">
              <Download size={14} /> Télécharger
            </a>
          )}
          {!native && (
            <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-btn border border-line px-4 py-2 text-sm font-bold text-ink-2">
              <ExternalLink size={14} /> Ouvrir dans un onglet
            </a>
          )}
        </div>
      </div>
    );

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex flex-col bg-[rgba(6,14,28,0.85)] p-4 pt-[max(1rem,env(safe-area-inset-top))]"
      onMouseDown={(e) => {
        // Ouvert depuis une fenêtre (fiche d'événement…) : le clic ne doit pas la refermer aussi.
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center gap-3 text-white" onMouseDown={(e) => e.stopPropagation()}>
        <p className="min-w-0 flex-1 truncate text-sm font-bold">{name}</p>
        {downloadUrl && (
          <a href={downloadUrl} download={name} className="flex items-center gap-1.5 rounded-btn bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25">
            <Download size={13} /> Télécharger
          </a>
        )}
        <button onClick={onClose} aria-label="Fermer l'aperçu" className="rounded-full p-1.5 hover:bg-white/15">
          <X size={18} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center" onMouseDown={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>,
    document.body
  );
}
