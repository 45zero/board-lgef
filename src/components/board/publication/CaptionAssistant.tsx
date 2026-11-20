"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Undo2, Wand2 } from "lucide-react";
import { proposePublicationCaption } from "@/app/actions/publication-caption";

/**
 * Sous le champ texte d'une publication : Claude propose un texte prêt à publier à partir de ce que
 * le board sait du média (événement, date, lieu, description, nombre de photos / vidéos), ou retouche
 * le texte actuel selon une consigne (« plus court », « ajoute le score 3-1 »…). Texte vide à
 * l'ouverture : une première proposition est préparée tout de suite. « Annuler » remet le texte
 * d'avant la dernière proposition.
 */
export function CaptionAssistant({
  publicationId,
  value,
  onChange,
  networks,
  autoStart = false,
}: {
  publicationId: string;
  value: string;
  onChange: (text: string) => void;
  networks: string[];
  autoStart?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retouching, setRetouching] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [previous, setPrevious] = useState<string | null>(null);
  const [fromClaude, setFromClaude] = useState(false);

  const run = async (opts: { current: string; instruction: string }) => {
    setBusy(true);
    setError(null);
    const res = await proposePublicationCaption(publicationId, { ...opts, networks });
    setBusy(false);
    if (res.error || !res.text) return setError(res.error ?? "Pas de proposition.");
    setPrevious(opts.current);
    setFromClaude(true);
    onChange(res.text);
    setRetouching(false);
    setInstruction("");
  };

  // Première proposition à l'ouverture d'un média sans texte (une seule fois).
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || value.trim()) return;
    started.current = true;
    void run({ current: "", instruction: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uniquement au montage
  }, []);

  const btn =
    "inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-2 hover:bg-hover disabled:opacity-50";

  return (
    <div className="-mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {busy ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-4">
            <Loader2 size={12} className="animate-spin" /> Claude rédige une proposition…
          </span>
        ) : (
          <>
            <button type="button" onClick={() => void run({ current: value, instruction: "" })} className={btn} title="Rédiger un texte à partir des informations du média">
              <Sparkles size={12} /> {value.trim() ? "Nouvelle proposition" : "Proposer un texte"}
            </button>
            {value.trim() && (
              <button type="button" onClick={() => setRetouching((v) => !v)} className={btn} aria-expanded={retouching}>
                <Wand2 size={12} /> Retoucher
              </button>
            )}
            {previous !== null && (
              <button
                type="button"
                onClick={() => {
                  onChange(previous);
                  setPrevious(null);
                  setFromClaude(false);
                }}
                className={btn}
                title="Revenir au texte d'avant la proposition"
              >
                <Undo2 size={12} /> Annuler
              </button>
            )}
            {fromClaude && <span className="text-[10px] text-ink-4">Proposé par Claude : relisez avant de publier.</span>}
          </>
        )}
      </div>
      {retouching && !busy && (
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && instruction.trim()) {
                e.preventDefault();
                void run({ current: value, instruction });
              }
            }}
            placeholder="Ex. : plus court, plus d'emojis, ajoute le score 3-1, cite le club de Metz…"
            className="min-w-0 flex-1 rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none"
          />
          <button
            type="button"
            disabled={!instruction.trim()}
            onClick={() => void run({ current: value, instruction })}
            className="rounded-btn bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Appliquer
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-bad">{error}</p>}
    </div>
  );
}
