"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, FileText, Loader2, Sparkles, Upload, Video, X } from "lucide-react";
import { classifyDropImages, type DropKind } from "@/app/actions/drop-classify";
import { ExpenseImport, type ExpenseImportHandle } from "@/components/board/expenses/ExpenseImport";
import { pdfToJpegFiles } from "@/lib/board/pdfToImages";
import { canShowModule, useVisibleModules } from "@/hooks/board/useVisibleModules";
import { useCanPublish } from "@/hooks/board/useCanPublish";

// Chargée à la demande : le centre de publication est un gros module, inutile sur l'accueil tant
// qu'aucun média n'est déposé.
const NewPublicationDialog = dynamic(() => import("@/components/board/screens/PublicationScreen").then((m) => m.NewPublicationDialog), {
  ssr: false,
});

type Item = { id: string; file: File; kind: DropKind | null; thumb: string | null; detecting: boolean };

const isImage = (f: File) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name);
const isVideo = (f: File) => f.type.startsWith("video/");
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isSheet = (f: File) => /\.(xlsx|csv|txt)$/i.test(f.name);
const newId = () => Math.random().toString(36).slice(2);

/** Aperçu JPEG réduit (384 px) pour le tri par Claude ; null si le navigateur ne lit pas l'image (HEIC…). */
async function smallPreview(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 384 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

/**
 * Dépôt rapide (barre du haut, ordinateur) : une pastille « Déposer » où l'on glisse — ou choisit —
 * des fichiers. Une facture, un ticket ou une feuille de frais part dans l'import de Frais (lecture
 * par Claude, événement rapproché, vérification puis ajout) ; une photo ou une vidéo devient une
 * publication « À publier » (rattachée ou non à un événement). Les photos sont triées par Claude, la
 * personne peut corriger. Le tri et les frais à vérifier s'affichent dans un volet sous la pastille.
 * Sur mobile, rien : « Photo » et « Post » y mènent déjà aux frais et au centre de publication.
 */
export function QuickDrop() {
  // Frais si le module Frais est ouvert à la personne, médias si elle peut publier.
  const canExpense = canShowModule(useVisibleModules(), "frais");
  const canMedia = useCanPublish() === true;
  if (!canExpense && !canMedia) return null;
  return <QuickDropInner canExpense={canExpense} canMedia={canMedia} />;
}

function QuickDropInner({ canExpense, canMedia }: { canExpense: boolean; canMedia: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [mediaFiles, setMediaFiles] = useState<File[] | null>(null);
  const [routing, setRouting] = useState(false);
  const importRef = useRef<ExpenseImportHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Volet ancré sous la pastille, rendu dans <body> : le flou de la barre piégerait un élément fixe.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setAnchor({ top: r.bottom + 10, right: Math.max(16, window.innerWidth - r.right - 120) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Fichiers glissés n'importe où sur l'accueil : le bandeau s'allume pour indiquer où déposer.
  useEffect(() => {
    let depth = 0;
    const visible = () => !!rootRef.current?.offsetParent;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || !visible()) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const end = () => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
    };
  }, []);

  // Libère les miniatures au démontage.
  useEffect(() => () => itemsRef.current.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb)), []);

  const clear = () => {
    items.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb));
    setItems([]);
  };

  /** Envoie chaque fichier vers son parcours : frais (import habituel) ou publication. */
  const route = async (list: Item[]) => {
    const receipts = list.filter((i) => i.kind === "receipt").map((i) => i.file);
    const media = list.filter((i) => i.kind === "media").map((i) => i.file);
    list.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb));
    setItems([]);
    if (receipts.length) importRef.current?.addFiles(receipts);
    if (!media.length) return;
    setRouting(true);
    try {
      // Un PDF classé en média devient une galerie : une photo par page (comme dans le centre de publication).
      const expanded: File[] = [];
      for (const f of media) expanded.push(...(isPdf(f) ? await pdfToJpegFiles(f) : [f]));
      setMediaFiles(expanded);
    } catch (e) {
      setHint(e instanceof Error ? `PDF illisible : ${e.message}` : "PDF illisible.");
    } finally {
      setRouting(false);
    }
  };

  const addFiles = async (files: File[]) => {
    setHint(null);
    const accepted: Item[] = [];
    const refused: string[] = [];
    for (const file of files) {
      const media = isImage(file) || isVideo(file);
      const doc = isPdf(file) || isSheet(file);
      if (!media && !doc) {
        refused.push(file.name);
        continue;
      }
      // Sans accès à l'un des deux parcours, pas de tri : tout va vers celui qui est ouvert.
      let kind: DropKind | null = isVideo(file) ? "media" : doc ? "receipt" : null;
      if (!canMedia) kind = isVideo(file) ? null : "receipt";
      if (!canExpense) kind = media || isPdf(file) ? "media" : null;
      if (kind === null && (!canMedia || !canExpense)) {
        refused.push(file.name);
        continue;
      }
      accepted.push({ id: newId(), file, kind, thumb: isImage(file) ? URL.createObjectURL(file) : null, detecting: kind === null });
    }
    if (refused.length) setHint(`Non pris en charge ici : ${refused.join(", ")}`);
    if (!accepted.length) return;

    // Rien à deviner (factures PDF, vidéos…) : direction le bon parcours, sans étape de plus.
    if (accepted.every((i) => i.kind !== null)) {
      void route(accepted);
      return;
    }

    setItems((prev) => [...prev, ...accepted]);
    const toDetect = accepted.filter((i) => i.kind === null);
    const previews = await Promise.all(toDetect.map((i) => smallPreview(i.file)));
    const readable = toDetect.filter((_, k) => previews[k]);
    const kinds = readable.length ? await classifyDropImages(previews.filter((p): p is string => !!p)) : [];
    const result = new Map(readable.map((i, k) => [i.id, kinds[k] ?? null]));
    setItems((prev) => prev.map((i) => (i.detecting && toDetect.some((t) => t.id === i.id) ? { ...i, kind: result.get(i.id) ?? null, detecting: false } : i)));
  };

  const setKind = (id: string, kind: DropKind) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, kind } : i)));

  const detecting = items.some((i) => i.detecting);
  const undecided = items.some((i) => !i.detecting && i.kind === null);
  const nReceipts = items.filter((i) => i.kind === "receipt").length;
  const nMedia = items.filter((i) => i.kind === "media").length;

  const label = canExpense && canMedia ? "Facture ou média" : canExpense ? "Justificatif" : "Média";
  const tooltip = [canExpense && "Facture, ticket → frais", canMedia && "photo, vidéo → prête à publier"].filter(Boolean).join(" · ");
  const accept = [canExpense && "image/*,application/pdf,.pdf,.xlsx,.csv,.heic,.heif", canMedia && "image/*,video/*,application/pdf,.heic,.heif"].filter(Boolean).join(",");

  return (
    <>
      <div
        ref={rootRef}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = [...e.dataTransfer.files];
          if (files.length) void addFiles(files);
        }}
        className="shrink-0"
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title={`Glisser ou cliquer — ${tooltip}`}
          className={`flex h-9 items-center gap-2 rounded-full border border-dashed pl-1 pr-3.5 text-xs font-bold transition-all ${
            dragging ? "scale-105 border-link bg-sel-bg text-link ring-4 ring-link/15" : "border-line-strong text-ink-2 hover:border-link hover:bg-hover hover:text-ink"
          }`}
        >
          <span className={`flex h-7 w-7 items-center justify-center rounded-full ${dragging ? "bg-link text-white" : "bg-subtle text-ink-3"}`}>
            {routing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          </span>
          <span className="whitespace-nowrap">{dragging ? "Déposez ici" : <>Déposer<span className="hidden font-semibold text-ink-4 xl:inline"> · {label}</span></>}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void addFiles(files);
          }}
        />
      </div>

      {anchor &&
        createPortal(
          <div className="fixed z-[55] w-[min(480px,calc(100vw-32px))] space-y-2" style={{ top: anchor.top, right: anchor.right }}>
            {hint && (
              <p className="flex items-center gap-1 rounded-card border border-line bg-card px-3 py-2 text-[11px] text-warn shadow-modal">
                <span className="min-w-0 flex-1">{hint}</span>
                <button onClick={() => setHint(null)} className="text-ink-4 hover:text-ink">
                  <X size={12} />
                </button>
              </p>
            )}

            {items.length > 0 && (
              <div className="rounded-card border border-line bg-card shadow-modal">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs font-bold text-ink-2">
                  {detecting ? (
                    <>
                      <Loader2 size={12} className="animate-spin text-link" /> Claude trie vos fichiers…
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} className="text-link" /> Vérifiez le tri, puis continuez
                    </>
                  )}
                </div>
                <div className="max-h-64 divide-y divide-line overflow-y-auto">
                  {items.map((i) => (
                    <div key={i.id} className="flex items-center gap-2.5 px-3 py-1.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-subtle text-ink-4">
                        {i.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:)
                          <img src={i.thumb} alt="" className="h-full w-full object-cover" />
                        ) : isVideo(i.file) ? (
                          <Video size={14} />
                        ) : (
                          <FileText size={14} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{i.file.name || "Photo"}</span>
                      {i.detecting ? (
                        <Loader2 size={13} className="shrink-0 animate-spin text-ink-4" />
                      ) : (
                        <span className={`flex shrink-0 rounded-full p-0.5 ${i.kind === null ? "bg-warn-bg" : "bg-subtle"}`}>
                          {(["receipt", "media"] as const).map((k) => (
                            <button
                              key={k}
                              onClick={() => setKind(i.id, k)}
                              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-colors ${
                                i.kind === k ? "bg-navy text-white" : "text-ink-3 hover:text-ink"
                              }`}
                            >
                              {k === "receipt" ? "Frais" : "Média"}
                            </button>
                          ))}
                        </span>
                      )}
                      <button
                        onClick={() => {
                          if (i.thumb) URL.revokeObjectURL(i.thumb);
                          setItems((prev) => prev.filter((x) => x.id !== i.id));
                        }}
                        title="Retirer"
                        className="shrink-0 rounded-full p-1 text-ink-4 hover:text-bad"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
                  <span className="text-[11px] text-ink-4">
                    {undecided
                      ? "Choisissez Frais ou Média pour chaque fichier."
                      : [nReceipts && `${nReceipts} frais`, nMedia && `${nMedia} média${nMedia > 1 ? "s" : ""} à publier`].filter(Boolean).join(" · ")}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={clear} className="text-xs font-semibold text-ink-4 hover:text-bad">
                      Annuler
                    </button>
                    <button
                      disabled={detecting || undecided}
                      onClick={() => void route(items)}
                      className="flex items-center gap-1 rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      Continuer <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Frais : même parcours que l'import du module Frais (lecture, événement, vérification). */}
            {canExpense && (
              <div className="max-h-[70vh] overflow-y-auto rounded-panel shadow-modal empty:hidden">
                <ExpenseImport ref={importRef} hideDropzone onAdded={() => undefined} />
              </div>
            )}
          </div>,
          document.body
        )}

      {mediaFiles && <NewPublicationDialog initialFiles={mediaFiles} onClose={() => setMediaFiles(null)} />}
    </>
  );
}
