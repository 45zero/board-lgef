"use client";

import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Loader2, X } from "lucide-react";
import { getMyExpenseExport } from "@/app/actions/expenses";
import { monthLabel } from "@/lib/board/expenseCategories";

/** Zone de signature au doigt / à la souris ; `onChange` reçoit le PNG, ou null tant qu'elle est vide. */
function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1b33";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d")!;
    const [x, y] = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const [x, y] = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(ref.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <div className="relative rounded-panel border border-line bg-white">
        <canvas
          ref={ref}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="block h-40 w-full cursor-crosshair touch-none"
        />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-4">Signez ici</span>}
      </div>
      <button type="button" onClick={clear} className="mt-1.5 text-xs font-semibold text-ink-3 hover:underline">
        Effacer
      </button>
    </div>
  );
}

/** Export de la fiche individuelle de frais d'un mois : Excel, ou PDF signé avec les justificatifs à la suite. */
export function ExpenseExportModal({ months, initialMonth, onClose }: { months: string[]; initialMonth: string; onClose: () => void }) {
  const [month, setMonth] = useState(initialMonth);
  const [step, setStep] = useState<"choose" | "sign">("choose");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "pdf" | "xlsx") => {
    setBusy(kind);
    setError(null);
    try {
      const [data, lib] = await Promise.all([getMyExpenseExport(month), import("@/lib/board/expenseExport")]);
      if (!data.lines.length) throw new Error("Aucun frais saisi sur ce mois.");
      if (kind === "pdf") await lib.exportExpensesPdf(data, signature!);
      else await lib.exportExpensesXlsx(data);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export impossible.");
    } finally {
      setBusy(null);
    }
  };

  const btn = "flex flex-1 items-center justify-center gap-2 rounded-btn px-3 py-2.5 text-sm font-bold disabled:opacity-50";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Exporter</div>
            <h3 className="mt-1 text-base font-extrabold">Fiche individuelle de frais</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block">
            <span className="text-xs font-bold text-ink-2">Mois</span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              disabled={!!busy}
              className="mt-1 w-full rounded-btn border border-line bg-card px-2 py-2 text-sm outline-none"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>

          {step === "choose" ? (
            <div className="flex gap-2">
              <button onClick={() => void run("xlsx")} disabled={!!busy} className={`${btn} border border-line bg-card text-ink-2 hover:bg-hover`}>
                {busy === "xlsx" ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} Excel
              </button>
              <button onClick={() => setStep("sign")} disabled={!!busy} className={`${btn} bg-red text-white shadow-btn-red`}>
                <FileText size={16} /> PDF signé
              </button>
            </div>
          ) : (
            <>
              <div>
                <div className="mb-1.5 text-xs font-bold text-ink-2">Signature</div>
                <SignaturePad onChange={setSignature} />
                <p className="mt-1 text-[11px] text-ink-4">Elle apparaît en bas de la fiche ; les justificatifs du mois sont ajoutés à la suite, dans le même PDF.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep("choose")} disabled={!!busy} className={`${btn} border border-line bg-card text-ink-2 hover:bg-hover`}>
                  Retour
                </button>
                <button onClick={() => void run("pdf")} disabled={!signature || !!busy} className={`${btn} bg-red text-white shadow-btn-red`}>
                  {busy === "pdf" ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                  {busy === "pdf" ? "Génération…" : "Valider et exporter"}
                </button>
              </div>
            </>
          )}

          {error && <div className="rounded-btn bg-bad-bg px-3 py-2 text-xs font-semibold text-bad">{error}</div>}
        </div>
      </div>
    </div>
  );
}
