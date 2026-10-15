"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, Smile } from "lucide-react";
import { toPlain, toggleStyle, type UnicodeStyle } from "@/lib/board/unicodeStyles";

// Barre du texte de publication : gras / italique Unicode (Facebook et Instagram n'ont pas de mise
// en forme, voir unicodeStyles.ts) et emojis, insérés au curseur — plus besoin d'outil extérieur.

const EMOJIS: { label: string; list: string[] }[] = [
  { label: "Foot", list: ["⚽", "🥅", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏟️", "👟", "🧤", "🟨", "🟥", "⏱️", "📣", "🎽"] },
  { label: "Réactions", list: ["🔥", "💪", "👏", "🙌", "👊", "🤝", "🎉", "🥳", "😍", "😎", "🤩", "😱", "😂", "🙏", "❤️", "💙"] },
  { label: "Infos", list: ["📅", "🗓️", "🕒", "📍", "📸", "🎥", "📺", "🎙️", "📰", "🔗", "👉", "👇", "✅", "❌", "⚠️", "ℹ️"] },
  { label: "Symboles", list: ["⭐", "✨", "💥", "⚡", "🚀", "🎯", "📈", "🔝", "🆕", "🔴", "🔵", "⚪", "🇫🇷", "🏁", "➡️", "▶️"] },
];

const STYLES: { style: UnicodeStyle; label: string; title: string }[] = [
  { style: "bold", label: "𝗚", title: "Gras" },
  { style: "italic", label: "𝘐", title: "Italique" },
  { style: "boldItalic", label: "𝙂𝙄", title: "Gras italique" },
];

type Field = HTMLTextAreaElement | HTMLInputElement;

/**
 * Agit sur la sélection du champ `fieldRef` (ou le mot sous le curseur, sans sélection) ; les
 * boutons ne prennent pas le focus, pour garder la sélection.
 */
export function CaptionToolbar({ fieldRef, value, onChange }: { fieldRef: React.RefObject<Field | null>; value: string; onChange: (v: string) => void }) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!emojiOpen) return;
    const away = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setEmojiOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [emojiOpen]);

  /** Remplace [start, end[ par `text`, puis resélectionne (ou place le curseur après). */
  const replace = (start: number, end: number, text: string, select: boolean) => {
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      const el = fieldRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(select ? start : start + text.length, start + text.length);
    });
  };

  /** Sélection du champ ; sans sélection, le mot sous le curseur. */
  const range = () => {
    const el = fieldRef.current;
    let start = el?.selectionStart ?? value.length;
    let end = el?.selectionEnd ?? value.length;
    if (start === end) {
      while (start > 0 && !/\s/.test(value[start - 1])) start--;
      while (end < value.length && !/\s/.test(value[end])) end++;
    }
    return { start, end };
  };

  const applyStyle = (style: UnicodeStyle | null) => {
    const { start, end } = range();
    if (start === end) return;
    const part = value.slice(start, end);
    replace(start, end, style ? toggleStyle(part, style) : toPlain(part), true);
  };

  const insertEmoji = (emoji: string) => {
    const el = fieldRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    replace(start, end, emoji, false);
  };

  const btn = "flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm text-ink-2 hover:bg-hover";
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div ref={panelRef} className="relative mb-1 flex items-center gap-0.5 rounded-btn border border-line bg-subtle px-1 py-0.5">
      {STYLES.map((s) => (
        <button key={s.style} type="button" onMouseDown={keep} onClick={() => applyStyle(s.style)} title={`${s.title} (sélectionnez le texte)`} className={btn}>
          {s.label}
        </button>
      ))}
      <button type="button" onMouseDown={keep} onClick={() => applyStyle(null)} title="Remettre en texte normal" aria-label="Remettre en texte normal" className={btn}>
        <Eraser size={14} />
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <button
        type="button"
        onMouseDown={keep}
        onClick={() => setEmojiOpen((o) => !o)}
        title="Emojis"
        aria-label="Emojis"
        aria-expanded={emojiOpen}
        className={`${btn} ${emojiOpen ? "bg-hover" : ""}`}
      >
        <Smile size={15} />
      </button>
      <span className="ml-auto hidden pr-1 text-[10px] text-ink-4 sm:inline">Gras et italique visibles sur Facebook et Instagram</span>
      {emojiOpen && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[288px] rounded-btn border border-line bg-card p-2 shadow-card">
          {EMOJIS.map((g) => (
            <div key={g.label} className="mb-1.5 last:mb-0">
              <div className="mb-0.5 px-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-4">{g.label}</div>
              <div className="grid grid-cols-8">
                {g.list.map((e) => (
                  <button key={e} type="button" onMouseDown={keep} onClick={() => insertEmoji(e)} className="rounded-md p-1 text-lg leading-none hover:bg-hover">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
