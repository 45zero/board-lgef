"use client";

import { useRef } from "react";
import { DEFAULT_TIMING, TEXT_MOTIONS, type TextMotion, type TextTiming } from "@/lib/board/textTiming";

const chip = (active: boolean) =>
  `shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${active ? "bg-navy text-white" : "bg-subtle text-ink-3"}`;
const num = "w-16 rounded-btn border border-line bg-card px-2 py-1 text-xs outline-none focus:border-link";
const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Apparition d'un texte dans une vidéo : frise (début et fin déplaçables au doigt, rampes d'entrée et
 * de sortie), valeurs précises en secondes, animation d'entrée et de sortie avec leur durée.
 */
export function TextTimingEditor({
  value,
  onChange,
  duration,
}: {
  value: TextTiming | null | undefined;
  onChange: (t: TextTiming) => void;
  /** Durée représentée par la frise (s) : celle de la vidéo, ou une durée type dans l'administration. */
  duration: number;
}) {
  const tm = value ?? DEFAULT_TIMING;
  const total = Math.max(1, duration, tm.end ?? 0, tm.start + 0.5);
  const end = tm.end ?? total;
  const set = (p: Partial<TextTiming>) => onChange({ ...tm, ...p });
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const move = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    const t = round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * total);
    if (dragging.current === "start") set({ start: Math.min(t, round(end - 0.2)) });
    // Poignée de fin tout au bout : « jusqu'à la fin ».
    else if (dragging.current === "end") set({ end: t >= total - 0.05 ? null : Math.max(t, round(tm.start + 0.2)) });
  };

  const pct = (t: number) => `${(t / total) * 100}%`;
  const span = Math.max(end - tm.start, 0.01);
  const inLen = tm.in === "aucune" ? 0 : Math.min(tm.inDuration, span);
  const outLen = tm.end === null || tm.out === "aucune" ? 0 : Math.min(tm.outDuration, span);

  const motionRow = (label: string, motion: TextMotion, d: number, onMotion: (m: TextMotion) => void, onDuration: (v: number) => void, disabled = false) => (
    <div className={disabled ? "opacity-40" : ""}>
      <div className="mb-1 flex min-h-7 items-center justify-between gap-2 text-xs text-ink-3">
        <span className="font-semibold">{label}</span>
        {motion !== "aucune" && (
          <label className="flex items-center gap-1">
            durée
            <input
              type="number"
              min={0.1}
              max={5}
              step={0.1}
              value={d}
              disabled={disabled}
              onChange={(e) => onDuration(Math.min(5, Math.max(0.1, Number(e.target.value) || 0.1)))}
              className={num}
            />
            s
          </label>
        )}
      </div>
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {TEXT_MOTIONS.map((m) => (
          <button key={m.id} type="button" disabled={disabled} onClick={() => onMotion(m.id)} className={chip(motion === m.id)}>
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-2.5">
      {/* Frise : zone d'apparition, rampes d'entrée / sortie, poignées de début et de fin. */}
      <div
        ref={bar}
        className="relative h-9 touch-none select-none rounded-btn bg-subtle"
        onPointerMove={(e) => dragging.current && move(e.clientX)}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
      >
        <div className="absolute inset-y-1.5 overflow-hidden rounded bg-navy/25" style={{ left: pct(tm.start), width: pct(end - tm.start) }}>
          {inLen > 0 && <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-card/80 to-transparent" style={{ width: `${(inLen / span) * 100}%` }} />}
          {outLen > 0 && <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-card/80 to-transparent" style={{ width: `${(outLen / span) * 100}%` }} />}
        </div>
        {(["start", "end"] as const).map((h) => (
          <button
            key={h}
            type="button"
            aria-label={h === "start" ? "Début d'apparition" : "Fin d'apparition"}
            onPointerDown={(e) => {
              bar.current!.setPointerCapture(e.pointerId);
              dragging.current = h;
            }}
            className="absolute top-1/2 h-7 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white bg-navy shadow"
            style={{ left: pct(h === "start" ? tm.start : end) }}
          />
        ))}
        <span className="pointer-events-none absolute bottom-0.5 left-1.5 font-mono text-[9px] text-ink-4">0</span>
        <span className="pointer-events-none absolute bottom-0.5 right-1.5 font-mono text-[9px] text-ink-4">{round(total)} s</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-3">
        <label className="flex items-center gap-1">
          Début
          <input type="number" min={0} step={0.1} value={tm.start} onChange={(e) => set({ start: Math.max(0, Number(e.target.value) || 0) })} className={num} />s
        </label>
        <label className="flex items-center gap-1">
          Fin
          <input
            type="number"
            min={0}
            step={0.1}
            value={tm.end ?? ""}
            placeholder="—"
            disabled={tm.end === null}
            onChange={(e) => set({ end: Math.max(round(tm.start + 0.1), Number(e.target.value) || 0) })}
            className={`${num} disabled:opacity-50`}
          />
          s
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={tm.end === null} onChange={(e) => set({ end: e.target.checked ? null : round(Math.min(total, tm.start + 3)) })} />
          jusqu&rsquo;à la fin
        </label>
      </div>

      {motionRow("Entrée", tm.in, tm.inDuration, (m) => set({ in: m }), (v) => set({ inDuration: v }))}
      {motionRow("Sortie", tm.out, tm.outDuration, (m) => set({ out: m }), (v) => set({ outDuration: v }), tm.end === null)}
      {tm.end === null && <p className="text-[11px] text-ink-4">Pour animer la sortie, fixez une fin (décochez « jusqu&rsquo;à la fin »).</p>}
    </div>
  );
}
