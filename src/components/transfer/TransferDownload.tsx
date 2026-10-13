"use client";

import { useState } from "react";
import { Download, Eye, Clock, Loader2, Check } from "lucide-react";
import { fileKind, formatBytes, type TransferPreview } from "@/lib/transfer/shared";
import { KindIcon, RemotePreviewModal } from "@/components/transfer/FilePreview";

// Page de téléchargement : le destinataire voit les fichiers, les prévisualise (vidéo lisible,
// photos, PDF…) et télécharge. Chaque bouton passe par /api/transfer/<code>/download/<id> (compté).

type TransferFile = { id: string; name: string; mimeType: string; size: number; preview: TransferPreview };

const longDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function TransferDownload(props: {
  code: string;
  title: string;
  message: string;
  senderName: string;
  totalBytes: number;
  createdAt: string;
  expiresAt: string | null;
  files: TransferFile[];
}) {
  const [preview, setPreview] = useState<TransferFile | null>(null);
  const [all, setAll] = useState<"idle" | "busy" | "done">("idle");
  const href = (id: string) => `/api/transfer/${encodeURIComponent(props.code)}/download/${id}`;

  // Plusieurs fichiers : un téléchargement après l'autre (le navigateur peut demander l'autorisation une fois).
  const downloadAll = async () => {
    setAll("busy");
    for (const f of props.files) {
      const a = document.createElement("a");
      a.href = href(f.id);
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 1200));
    }
    setAll("done");
  };

  const [openedAt] = useState(() => Date.now());
  const daysLeft = props.expiresAt ? Math.max(0, Math.ceil((new Date(props.expiresAt).getTime() - openedAt) / 86400_000)) : null;

  return (
    <div className="overflow-hidden rounded-modal bg-card shadow-card">
      <div className="border-b border-line p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-4">{props.senderName} vous a envoyé</p>
        <p className="mt-1 text-lg font-extrabold text-ink">{props.title || `${props.files.length} fichier${props.files.length > 1 ? "s" : ""}`}</p>
        <p className="mt-0.5 text-xs text-ink-3">
          {props.files.length} fichier{props.files.length > 1 ? "s" : ""} · {formatBytes(props.totalBytes)} · envoyé le {new Date(props.createdAt).toLocaleDateString("fr-FR")}
        </p>
        {props.message && <p className="mt-3 whitespace-pre-line rounded-btn bg-subtle px-3 py-2.5 text-sm text-ink-2">{props.message}</p>}
      </div>

      <ul className="max-h-[45vh] divide-y divide-line overflow-y-auto">
        {props.files.map((f) => {
          const canPreview = f.preview.kind !== "none";
          return (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
              <button
                type="button"
                onClick={() => canPreview && setPreview(f)}
                disabled={!canPreview}
                className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-btn bg-sel-bg text-link"
                aria-label={canPreview ? `Aperçu de ${f.name}` : undefined}
              >
                {f.preview.kind === "image" ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- miniature du Drive */
                  <img src={f.preview.url.replace("sz=w2000", "sz=w200")} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <KindIcon kind={fileKind(f.mimeType, f.name)} />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{f.name}</p>
                <p className="text-[11px] text-ink-4">{formatBytes(f.size)}</p>
              </div>
              {canPreview && (
                <button type="button" onClick={() => setPreview(f)} className="rounded-full p-2 text-ink-3 hover:bg-hover hover:text-ink" title="Aperçu" aria-label={`Aperçu de ${f.name}`}>
                  <Eye size={17} />
                </button>
              )}
              <a href={href(f.id)} className="rounded-full p-2 text-ink-3 hover:bg-hover hover:text-red" title="Télécharger" aria-label={`Télécharger ${f.name}`}>
                <Download size={17} />
              </a>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-line p-4">
        {props.files.length === 1 ? (
          <a href={href(props.files[0].id)} className="flex w-full items-center justify-center gap-2 rounded-btn bg-red py-3 text-sm font-extrabold text-white shadow-btn-red hover:bg-red-700">
            <Download size={16} /> Télécharger
          </a>
        ) : (
          <button
            type="button"
            onClick={() => void downloadAll()}
            disabled={all === "busy"}
            className="flex w-full items-center justify-center gap-2 rounded-btn bg-red py-3 text-sm font-extrabold text-white shadow-btn-red hover:bg-red-700 disabled:opacity-70"
          >
            {all === "busy" ? <Loader2 size={16} className="animate-spin" /> : all === "done" ? <Check size={16} /> : <Download size={16} />}
            {all === "done" ? "Téléchargements lancés" : `Tout télécharger (${formatBytes(props.totalBytes)})`}
          </button>
        )}
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-ink-4">
          <Clock size={12} />
          {props.expiresAt ? `Disponible jusqu'au ${longDate(props.expiresAt)}${daysLeft !== null && daysLeft <= 2 ? " — bientôt expiré" : ""}` : "Disponible sans limite de durée"}
        </p>
      </div>

      {preview && <RemotePreviewModal file={preview} downloadHref={href(preview.id)} onClose={() => setPreview(null)} />}
    </div>
  );
}
