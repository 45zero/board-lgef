"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { AtSign } from "lucide-react";
import type { TeamPerson } from "@/lib/board/team";
import { Avatar } from "./TeamUi";

// Mentions @ dans une carte de l'Espace Team (commentaires, checklist, description) : taper « @ »
// propose les personnes du board ; le nom choisi est inséré « @Prénom Nom ». À l'envoi, les ids des
// personnes dont le nom figure dans le texte partent avec (mentionIdsIn) : le serveur les prévient et
// ajoute à la carte celles qui n'en sont pas membres (src/app/actions/team.ts).

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Personnes identifiées dans un texte (« @Prénom Nom ») — les noms les plus longs d'abord. */
export function mentionIdsIn(text: string, people: TeamPerson[]): string[] {
  let rest = text;
  const ids: string[] = [];
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const tag = `@${p.name}`;
    if (!rest.includes(tag)) continue;
    ids.push(p.id);
    rest = rest.split(tag).join(" ");
  }
  return ids;
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
  people: TeamPerson[];
  /** Membres actuels de la carte : les autres personnes identifiées seront ajoutées (signalé sous le champ). */
  memberIds: string[];
  meId: string;
};

export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { value, onValueChange, people, memberIds, meId, onKeyDown, className, ...rest },
  ref
) {
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => area.current!);
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [active, setActive] = useState(0);

  const hits = useMemo(() => {
    if (!query) return [];
    const t = fold(query.text);
    return people
      .filter((p) => p.id !== meId && (fold(p.name).includes(t) || fold(p.email ?? "").startsWith(t)))
      // Membres de la carte d'abord.
      .sort((a, b) => Number(memberIds.includes(b.id)) - Number(memberIds.includes(a.id)))
      .slice(0, 6);
  }, [query, people, meId, memberIds]);

  const outsiders = useMemo(() => {
    const ids = mentionIdsIn(value, people);
    return people.filter((p) => ids.includes(p.id) && !memberIds.includes(p.id) && p.id !== meId);
  }, [value, people, memberIds, meId]);

  const detect = (text: string, caret: number) => {
    const m = /(^|\s)@([\p{L}' .-]{0,30})$/u.exec(text.slice(0, caret));
    if (m && !/\s{2}/.test(m[2])) {
      setQuery({ text: m[2], start: caret - m[2].length - 1 });
      setActive(0);
    } else setQuery(null);
  };

  const pick = (p: TeamPerson) => {
    if (!query || !area.current) return;
    const caret = area.current.selectionStart ?? value.length;
    onValueChange(`${value.slice(0, query.start)}@${p.name} ${value.slice(caret)}`);
    setQuery(null);
    const pos = query.start + p.name.length + 2;
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
              e.stopPropagation();
              setQuery(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
        onBlur={() => window.setTimeout(() => setQuery(null), 150)}
      />
      {query && hits.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-btn border border-line bg-card py-1 shadow-modal">
          <p className="px-3 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Identifier une personne</p>
          {hits.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${i === active ? "bg-hover" : "hover:bg-hover"}`}
            >
              <Avatar person={p} size={24} />
              <span className="min-w-0 flex-1 truncate text-ink-2">{p.name}</span>
              {!memberIds.includes(p.id) && <span className="shrink-0 text-[10px] text-ink-4">pas membre</span>}
            </button>
          ))}
        </div>
      )}
      {outsiders.length > 0 && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-ink-4">
          <AtSign size={11} className="mt-0.5 shrink-0" />
          {outsiders.map((p) => p.name).join(", ")} {outsiders.length > 1 ? "seront ajoutés" : "sera ajouté(e)"} à la carte pour pouvoir la voir.
        </p>
      )}
    </div>
  );
});

/** Texte avec les personnes identifiées en gras (« @Prénom Nom » → Prénom Nom). */
export function MentionText({ text, people }: { text: string; people: TeamPerson[] }): ReactNode {
  const names = people
    .filter((p) => text.includes(`@${p.name}`))
    .map((p) => p.name)
    .sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return text.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g")).map((part, i) =>
    part.startsWith("@") && names.includes(part.slice(1)) ? (
      <span key={i} className="font-bold text-link">
        {part.slice(1)}
      </span>
    ) : (
      part
    )
  );
}
