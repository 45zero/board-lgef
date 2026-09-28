"use client";

import { useEffect, useRef, useState } from "react";
import { BookUser } from "lucide-react";
import { searchDirectoryEmails } from "@/app/actions/cartography";

/**
 * Champ d'adresses (séparées par des virgules) avec suggestions tirées des annuaires du site :
 * on tape un nom, un club ou un début d'email, un clic remplace le mot en cours par l'adresse.
 */
export function DirectoryEmailInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<{ email: string; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const requestRef = useRef(0);

  const current = value.split(",").pop()?.trim() ?? "";

  useEffect(() => {
    if (current.length < 2 || current.includes("@")) return;
    const id = ++requestRef.current;
    const t = setTimeout(async () => {
      const res = await searchDirectoryEmails(current);
      if (id !== requestRef.current) return;
      setSuggestions(res);
      setActive(0);
    }, 200);
    return () => clearTimeout(t);
  }, [current]);

  const visible = open && current.length >= 2 && !current.includes("@") ? suggestions : [];

  const pick = (email: string) => {
    const parts = value.split(",");
    parts[parts.length - 1] = ` ${email}`;
    onChange(parts.join(",").replace(/^\s+/, "") + ", ");
    setSuggestions([]);
  };

  return (
    <div className="relative">
      <input
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (visible.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % visible.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + visible.length) % visible.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(visible[active].email);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={className}
      />
      {visible.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 w-full overflow-hidden rounded-btn border border-line bg-card shadow-card">
          {visible.map((s, i) => (
            <button
              key={s.email}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s.email);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === active ? "bg-hover" : "hover:bg-hover"}`}
            >
              <BookUser size={12} className="shrink-0 text-ink-4" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{s.label}</span>
              <span className="shrink-0 truncate text-[10px] text-ink-4">{s.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
