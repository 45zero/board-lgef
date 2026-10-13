"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Save, ImagePlus, MousePointerClick, Eye, ExternalLink } from "lucide-react";
import { unwrap } from "@/lib/board/actionResult";
import { uploadFileToTransfer } from "@/lib/transfer/uploadClient";
import { deleteTransferAd, listTransferAds, saveTransferAd, type TransferAdRow } from "@/app/actions/transfers";

// Pubs de LGEF Transfer (admins) : image ou vidéo, lien cliquable, fond plein écran ou bannière,
// pages d'envoi et/ou de téléchargement, période, poids ; affichages et clics comptés.

type Draft = Omit<TransferAdRow, "id" | "impressions" | "clicks"> & { id: string | null };

const EMPTY: Draft = {
  id: null,
  title: "",
  advertiser: "",
  mediaType: "image",
  mediaDriveFileId: "",
  linkUrl: "",
  format: "wallpaper",
  placements: ["upload", "download"],
  startsAt: null,
  endsAt: null,
  active: true,
  weight: 1,
};

const today = () => new Date().toISOString().slice(0, 10);
const isLive = (a: TransferAdRow) => a.active && (!a.startsAt || a.startsAt <= today()) && (!a.endsAt || a.endsAt >= today());
const ctr = (a: TransferAdRow) => (a.impressions ? `${((a.clicks / a.impressions) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—");
const mediaUrl = (id: string, fileId: string) => `/api/transfer/ads/${id}/media?v=${encodeURIComponent(fileId)}`;

export function TransferAdsAdmin() {
  const [ads, setAds] = useState<TransferAdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "upload" | null>(null);
  const [progress, setProgress] = useState(0);

  const load = useCallback(() => {
    listTransferAds()
      .then((r) => setAds(unwrap(r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);
  useEffect(load, [load]);
  useEffect(
    () => () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    },
    [localUrl]
  );

  const open = (a?: TransferAdRow) => {
    setError(null);
    setLocalUrl(null);
    setDraft(a ? { ...a, linkUrl: a.linkUrl ?? "" } : { ...EMPTY });
  };

  const upload = async (file: File) => {
    if (!draft) return;
    if (!/^(image|video)\//.test(file.type)) return setError("Choisissez une image ou une vidéo.");
    setBusy("upload");
    setError(null);
    setProgress(0);
    try {
      const init = await fetch("/api/transfer/ads/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, mimeType: file.type, size: file.size }),
      }).then((r) => r.json());
      if (!init.ok) throw new Error(init.error);
      const id = await uploadFileToTransfer({
        file,
        target: { uploadUrl: init.uploadUrl, relay: init.relay },
        scope: { id: "ads", token: init.token },
        onProgress: (n) => setProgress(Math.round((n / Math.max(1, file.size)) * 100)),
      });
      setLocalUrl(URL.createObjectURL(file));
      setDraft((d) => d && { ...d, mediaDriveFileId: id, mediaType: file.type.startsWith("video/") ? "video" : "image" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError(null);
    try {
      unwrap(await saveTransferAd({ ...draft, linkUrl: draft.linkUrl || null }));
      setDraft(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Supprimer cette pub ? Son visuel ira à la corbeille du Drive.")) return;
    try {
      unwrap(await deleteTransferAd(id));
      setDraft(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  };

  const togglePlacement = (p: "upload" | "download") =>
    setDraft((d) => d && { ...d, placements: d.placements.includes(p) ? d.placements.filter((x) => x !== p) : [...d.placements, p] });

  const mediaSrc = localUrl ?? (draft?.id && draft.mediaDriveFileId ? mediaUrl(draft.id, draft.mediaDriveFileId) : null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3">Une pub en ligne est tirée au sort à chaque visite (selon son poids). Sur téléphone, le fond plein écran s&rsquo;affiche en bannière.</p>
        <button onClick={() => open()} className="flex shrink-0 items-center gap-1.5 rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white">
          <Plus size={13} /> Nouvelle pub
        </button>
      </div>

      {error && !draft && <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
      {!ads && !error && <Loader2 size={18} className="animate-spin text-ink-4" />}

      {ads && ads.length === 0 && (
        <div className="rounded-card border border-dashed border-line-strong bg-card px-4 py-10 text-center text-sm text-ink-4">Aucune pub : les pages LGEF Transfer s&rsquo;affichent sur fond bleu LGEF.</div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ads?.map((a) => (
          <button key={a.id} onClick={() => open(a)} className="overflow-hidden rounded-card border border-line bg-card text-left hover:border-line-strong">
            <div className="relative aspect-video bg-black/80">
              {a.mediaType === "video" ? (
                <video src={mediaUrl(a.id, a.mediaDriveFileId)} muted loop autoPlay playsInline className="h-full w-full object-cover" />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element -- visuel servi par notre relais */
                <img src={mediaUrl(a.id, a.mediaDriveFileId)} alt="" className="h-full w-full object-cover" />
              )}
              <span className={`absolute left-2 top-2 rounded-chip px-2 py-0.5 text-[10px] font-bold ${isLive(a) ? "bg-good-bg text-good" : "bg-chip-bg text-ink-3"}`}>{isLive(a) ? "En ligne" : "Hors ligne"}</span>
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-bold text-ink">{a.title}</p>
              <p className="truncate text-xs text-ink-3">
                {a.advertiser || "—"} · {a.format === "wallpaper" ? "Fond" : "Bannière"} · {a.placements.map((p) => (p === "upload" ? "envoi" : "téléchargement")).join(" + ")}
              </p>
              <div className="mt-2 flex gap-3 text-xs text-ink-2">
                <span className="flex items-center gap-1" title="Affichages">
                  <Eye size={12} /> {a.impressions.toLocaleString("fr-FR")}
                </span>
                <span className="flex items-center gap-1" title="Clics">
                  <MousePointerClick size={12} /> {a.clicks.toLocaleString("fr-FR")}
                </span>
                <span className="text-ink-4">Taux de clic {ctr(a)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDraft(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Pub">
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <div className="space-y-2">
                <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-card bg-black/80 text-white/70">
                  {mediaSrc ? (
                    draft.mediaType === "video" ? (
                      <video src={mediaSrc} muted loop autoPlay playsInline className="h-full w-full object-cover" />
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element -- aperçu du visuel */
                      <img src={mediaSrc} alt="" className="h-full w-full object-cover" />
                    )
                  ) : (
                    <ImagePlus size={32} />
                  )}
                  {busy === "upload" && <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-bold text-white">{progress} %</span>}
                </div>
                <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-btn border border-dashed border-line-strong py-2 text-xs font-bold text-ink-2 hover:bg-hover">
                  <ImagePlus size={14} /> {draft.mediaDriveFileId ? "Changer le visuel" : "Image ou vidéo"}
                  <input
                    type="file"
                    accept="image/*,video/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <p className="text-[11px] text-ink-4">Fond : 1920 × 1080 conseillé. Bannière : 1600 × 500. Vidéo : courte, sans son (lue en boucle).</p>
              </div>

              <div className="space-y-2">
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Nom de la campagne" className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none" />
                <input
                  value={draft.advertiser}
                  onChange={(e) => setDraft({ ...draft, advertiser: e.target.value })}
                  placeholder="Annonceur (affiché « Publicité · … »)"
                  className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none"
                />
                <div className="flex items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-2">
                  <ExternalLink size={13} className="text-ink-4" />
                  <input value={draft.linkUrl ?? ""} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} placeholder="https://… (lien au clic)" className="w-full bg-transparent text-sm outline-none" />
                </div>
                <div className="flex gap-1 rounded-btn bg-subtle p-0.5">
                  {(
                    [
                      ["wallpaper", "Fond plein écran"],
                      ["banner", "Bannière"],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} onClick={() => setDraft({ ...draft, format: id })} className={`flex-1 rounded-btn py-1.5 text-xs font-bold ${draft.format === id ? "bg-navy text-white" : "text-ink-3"}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={draft.placements.includes("upload")} onChange={() => togglePlacement("upload")} /> Page d&rsquo;envoi
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={draft.placements.includes("download")} onChange={() => togglePlacement("download")} /> Page de téléchargement
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-ink-4">
                    Du
                    <input type="date" value={draft.startsAt ?? ""} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value || null })} className="mt-0.5 w-full rounded-btn border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none" />
                  </label>
                  <label className="text-[11px] text-ink-4">
                    Au
                    <input type="date" value={draft.endsAt ?? ""} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value || null })} className="mt-0.5 w-full rounded-btn border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none" />
                  </label>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-ink-2">
                  <label className="flex items-center gap-1.5" title="Plus le poids est élevé, plus la pub est affichée souvent face aux autres">
                    Poids
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={draft.weight}
                      onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) || 1 })}
                      className="w-16 rounded-btn border border-line bg-card px-2 py-1 text-right text-sm outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active
                  </label>
                </div>
              </div>
            </div>
            {error && <p className="mx-5 mb-3 rounded-btn bg-bad-bg px-3 py-2 text-xs text-bad">{error}</p>}
            <div className="flex items-center gap-2 border-t border-line px-5 py-3">
              <button onClick={() => void save()} disabled={!!busy} className="flex items-center gap-1.5 rounded-btn bg-red px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
                {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Enregistrer
              </button>
              <button onClick={() => setDraft(null)} className="rounded-btn px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-hover">
                Annuler
              </button>
              {draft.id && (
                <button onClick={() => void remove(draft.id!)} className="ml-auto flex items-center gap-1 rounded-btn px-2 py-2 text-xs font-semibold text-bad hover:bg-bad-bg">
                  <Trash2 size={13} /> Supprimer
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
