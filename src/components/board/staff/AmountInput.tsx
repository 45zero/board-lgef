"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

/** Saisie d'un montant en euros, enregistrée à la sortie du champ ou sur Entrée. */
export function AmountInput({ value, placeholder, onSave }: { value: number | null; placeholder?: string; onSave: (v: number | null) => Promise<void> }) {
  const [text, setText] = useState(value === null ? "" : String(value).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    const parsed = text.trim() === "" ? null : Number(text.replace(",", ".").replace(/\s|€/g, ""));
    if (parsed !== null && !Number.isFinite(parsed)) return setText(value === null ? "" : String(value).replace(".", ","));
    if (parsed === value) return;
    setBusy(true);
    await onSave(parsed);
    setBusy(false);
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-btn border border-line bg-card px-2 py-1 focus-within:border-line-strong">
      <input
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder={placeholder ?? "—"}
        className="w-16 bg-transparent text-right text-sm font-semibold outline-none"
      />
      <span className="text-xs text-ink-4">€</span>
      {busy && <Loader2 size={11} className="animate-spin text-ink-4" />}
    </span>
  );
}
