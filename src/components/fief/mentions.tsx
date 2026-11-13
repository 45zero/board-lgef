"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { foldText, useDirectory } from "@/components/fief/directory";

// Mentions @ dans les publications et commentaires FIEF : taper « @ » propose les membres (annuaire) ;
// le nom choisi est inséré « @Prénom Nom » et son identifiant envoyé avec le texte (notification
// « mention », sql/2026-11-14_fief_visibilite_mentions.sql). À l'affichage, les noms mentionnés sont en gras.

export interface Mention {
  id: string;
  name: string;
}

/** Mentions encore présentes dans le texte (une mention effacée du texte n'est plus envoyée). */
export const keptMentions = (body: string, mentions: Mention[]) =>
  mentions.filter((m, i, all) => body.includes(`@${m.name}`) && all.findIndex((x) => x.id === m.id) === i);

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
  mentions: Mention[];
  onMentionsChange: (m: Mention[]) => void;
  excludeId?: string;
};

export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { value, onValueChange, mentions, onMentionsChange, excludeId, onKeyDown, className, ...rest },
  ref
) {
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => area.current!);
  const people = useDirectory();
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [active, setActive] = useState(0);

  const hits = useMemo(() => {
    if (!query || !people) return [];
    const t = foldText(query.text);
    return people.filter((p) => p.user_id !== excludeId && foldText(`${p.first_name} ${p.last_name}`).includes(t)).slice(0, 6);
  }, [query, people, excludeId]);

  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /(^|\s)@([\p{L}' -]{0,30})$/u.exec(before);
    if (m && !/\s{2}/.test(m[2])) {
      setQuery({ text: m[2], start: caret - m[2].length - 1 });
      setActive(0);
    } else setQuery(null);
  };

  const pick = (p: { user_id: string; first_name: string; last_name: string }) => {
    if (!query || !area.current) return;
    const name = `${p.first_name} ${p.last_name}`;
    const caret = area.current.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${name} ${value.slice(caret)}`;
    onValueChange(next);
    onMentionsChange([...mentions.filter((x) => x.id !== p.user_id), { id: p.user_id, name }]);
    setQuery(null);
    const pos = query.start + name.length + 2;
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative w-full">
      <textarea
        {...rest}
        ref={area}
        value={value}
        className={className}
        onChange={(e) => {
          onValueChange(e.target.value);
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          if (query && hits.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(hits[active]);
              return;
            }
            if (e.key === "Escape") {
              setQuery(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
        onBlur={() => window.setTimeout(() => setQuery(null), 150)}
      />
      {query && hits.length > 0 && (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-xl border border-f-border bg-f-surface py-1 shadow-xl">
          {hits.map((p, i) => (
            <button
              key={p.user_id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${i === active ? "bg-f-subtle" : "hover:bg-f-subtle"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/fief/avatar/${p.user_id}`} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-full bg-f-subtle object-cover" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {p.first_name} {p.last_name}
                </span>
                {p.club_name && <span className="block truncate text-xs text-f-muted">{p.club_name}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/** Texte avec les noms mentionnés en gras (« @Prénom Nom »). */
export function TextWithMentions({ body, mentions }: { body: string; mentions: Mention[] }): ReactNode {
  if (!mentions.length) return body;
  const names = mentions.map((m) => m.name).sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return parts.map((part, i) =>
    part.startsWith("@") && names.includes(part.slice(1)) ? (
      <span key={i} className="font-bold text-f-link">
        {part.slice(1)}
      </span>
    ) : (
      part
    )
  );
}
