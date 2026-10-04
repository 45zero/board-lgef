"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, CircleHelp, Loader2 } from "lucide-react";
import { checkInstagramHandle, getInstagramHandles, type HandleCheck, type HandleSuggestion } from "@/app/actions/instagram-mentions";

// Comptes déjà cités et vérifications partagés par tous les champs de la page.
let suggestionsPromise: Promise<HandleSuggestion[]> | null = null;
const loadSuggestions = () =>
  (suggestionsPromise ??= getInstagramHandles().then((r) => {
    if (r.ok) return r.data;
    suggestionsPromise = null;
    return [];
  }));
const checks = new Map<string, HandleCheck | "error">();

/** « @nom » en cours de frappe juste avant le curseur. */
function activeToken(value: string, caret: number) {
  const m = /(^|[\s(])@([A-Za-z0-9._]*)$/.exec(value.slice(0, caret));
  return m ? { query: m[2], start: caret - m[2].length - 1 } : null;
}

const followers = (n: number | null) =>
  n === null ? "" : n >= 1000 ? `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k abonnés` : `${n} abonnés`;

/**
 * Champ texte (légende) ou ligne (identifications) avec aide au « @ » Instagram : propose les
 * comptes déjà cités qui commencent pareil (↑ ↓ Entrée) et vérifie le nom tapé — photo, nom,
 * abonnés, ou « introuvable » (Instagram ne vérifie que les comptes professionnels ou créateurs).
 */
export function InstagramMentionField({
  value,
  onChange,
  multiline = false,
  rows,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<HandleSuggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [, setVersion] = useState(0); // relit `checks` quand une vérification arrive

  const token = focused ? activeToken(value, caret) : null;
  const query = token?.query.toLowerCase() ?? "";

  const matches = useMemo(
    () => (token ? suggestions.filter((s) => s.username.startsWith(query) && s.username !== query).slice(0, 6) : []),
    [suggestions, token, query]
  );

  // Vérification du nom tapé, après une courte pause.
  useEffect(() => {
    if (query.length < 2 || checks.has(query)) return;
    const t = window.setTimeout(() => {
      checkInstagramHandle(query).then((r) => {
        checks.set(query, r.ok ? r.data : "error");
        setVersion((v) => v + 1);
      });
    }, 700);
    return () => window.clearTimeout(t);
  }, [query]);
  const check = query.length >= 2 ? checks.get(query) : undefined;

  const syncCaret = () => setCaret(ref.current?.selectionStart ?? value.length);

  const pick = (username: string) => {
    if (!token) return;
    const before = value.slice(0, token.start);
    const after = value.slice(caret).replace(/^[A-Za-z0-9._]*/, "");
    const inserted = `@${username} `;
    const next = before + inserted + after.replace(/^\s+/, "");
    onChange(next);
    const pos = before.length + inserted.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!token || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(matches[Math.min(highlight, matches.length - 1)].username);
    } else if (e.key === "Escape") {
      setFocused(false);
    }
  };

  const common = {
    ref,
    value,
    placeholder,
    className,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      onChange(e.target.value);
      setCaret(e.target.selectionStart ?? e.target.value.length);
      setHighlight(0);
    },
    onSelect: syncCaret,
    onKeyDown,
    onFocus: () => {
      setFocused(true);
      void loadSuggestions().then(setSuggestions);
    },
    onBlur: () => window.setTimeout(() => setFocused(false), 150),
  };

  const showPanel = !!token && (matches.length > 0 || query.length >= 2);

  return (
    <div className="relative">
      {multiline ? <textarea rows={rows} {...common} /> : <input {...common} />}
      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-btn border border-line bg-card shadow-card">
          {query.length >= 2 && (
            <div className="flex items-center gap-2 border-b border-line px-2.5 py-2 text-xs">
              {check === undefined && (
                <>
                  <Loader2 size={13} className="animate-spin text-ink-4" /> <span className="text-ink-3">Vérification de @{query}…</span>
                </>
              )}
              {check === "error" && <span className="text-ink-4">Vérification indisponible pour le moment.</span>}
              {check && check !== "error" && check.status === "found" && (
                <>
                  {check.profile.pictureUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- photo de profil Instagram (URL du CDN Meta)
                    <img src={check.profile.pictureUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-bold text-ink">
                      {check.profile.name ?? `@${check.profile.username}`} <BadgeCheck size={12} className="text-good" />
                    </span>
                    <span className="text-ink-4">
                      @{check.profile.username} · {followers(check.profile.followers)}
                    </span>
                  </span>
                </>
              )}
              {check && check !== "error" && check.status === "not_found" && (
                <>
                  <CircleHelp size={13} className="shrink-0 text-warn" />
                  <span className="text-ink-3">
                    <strong className="text-warn">@{query} introuvable</strong> — vérifiez l&apos;orthographe. Un compte personnel ne peut pas être
                    vérifié, mais peut quand même être identifié.
                  </span>
                </>
              )}
            </div>
          )}
          {matches.map((s, i) => (
            <button
              key={s.username}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s.username)}
              className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs ${
                i === highlight ? "bg-sel-bg" : "hover:bg-hover"
              }`}
            >
              <span className="font-semibold text-ink">@{s.username}</span>
              <span className="text-[10px] text-ink-4">cité {s.count} fois</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
