"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock,
  CornerDownLeft,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Mail,
  MessageSquare,
  Receipt,
  Search,
  Send,
  SquareKanban,
  Trophy,
  User,
  X,
} from "lucide-react";
import { globalSearch, personActivity, type PersonActivity, type SearchHit, type SearchPerson, type SearchResults } from "@/app/actions/global-search";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";
import { useOpenTeamCard } from "@/components/board/team/TeamCardOpener";
import { canShowModule, useVisibleModules } from "@/hooks/board/useVisibleModules";
import { useAppLabel } from "@/hooks/board/useFraisFlavor";
import { BOARD_APPS, ORG_COLORS } from "@/lib/board/tokens";
import { BUILT_MODULES } from "@/lib/board/modules";
import { EVENT_TYPE_TO_ORG, type DbEventType } from "@/lib/board/calendar";

const RECENT_KEY = "lgef-board:recent-searches";
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const KIND_META: Record<SearchHit["kind"], { label: string; icon: typeof CalendarDays }> = {
  event: { label: "Événements", icon: CalendarDays },
  card: { label: "Espace Team", icon: SquareKanban },
  publication: { label: "Publications", icon: ImageIcon },
  tournoi: { label: "Tournois", icon: Trophy },
  transfer: { label: "Transferts", icon: Send },
  invoice: { label: "Factures", icon: FileText },
  expense: { label: "Frais", icon: Receipt },
  comment: { label: "Commentaires", icon: MessageSquare },
};
const KIND_ORDER: SearchHit["kind"][] = ["event", "card", "tournoi", "publication", "invoice", "expense", "transfer", "comment"];

type Module = { id: string; label: string; kicker: string };
type Row = { key: string; type: "module"; module: Module } | { key: string; type: "person"; person: SearchPerson } | { key: string; type: "hit"; hit: SearchHit };

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const dayTime = (iso: string) => {
  const t = new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${day(iso)}${t !== "00:00" ? ` · ${t}` : ""}`;
};
const euros = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n));
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function pushRecent(q: string) {
  try {
    const list = [q, ...readRecent().filter((r) => fold(r) !== fold(q))].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // stockage indisponible : pas d'historique
  }
}

function Avatar({ person, size = 28 }: { person: SearchPerson; size?: number }) {
  return person.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- photo du bucket Supabase
    <img src={person.avatarUrl} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-white">
      {initials(person.name) || <User size={12} />}
    </span>
  );
}

/**
 * Recherche globale de la barre du haut (⌘K / Ctrl+K) : modules, personnes, événements, cartes de
 * l'Espace Team, publications, tournois, transferts, factures, frais et commentaires — sans accents
 * ni casse, plusieurs mots possibles (« léa metz »). Une personne trouvée affiche à droite tout ce
 * qui la concerne : ses événements à venir et passés, ses cartes, publications, frais, factures,
 * transferts et commentaires (selon les droits de la personne connectée). Clavier : ↑ ↓, Entrée, Échap.
 */
export function GlobalSearch({ onNavigate }: { onNavigate?: (app: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [activity, setActivity] = useState<{ id: string; data: PersonActivity | null } | null>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const activityCache = useRef(new Map<string, PersonActivity | null>());
  const { open: openEvent } = useOpenEvent();
  const { open: openTeamCard } = useOpenTeamCard();
  const visible = useVisibleModules();
  const appLabel = useAppLabel();
  const [isMac] = useState(() => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent));

  // ⌘K / Ctrl+K : ouvre la recherche depuis n'importe quel module.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fermeture au clic en dehors (champ et volet).
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Volet aligné sous le champ, plus large que lui pour la fiche personne.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(Math.max(r.width, 780), window.innerWidth - 32);
      setBox({ top: r.bottom + 8, left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)), width });
    };
    place();
    queueMicrotask(() => setRecent(readRecent()));
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // Recherche (220 ms après la dernière frappe) ; une réponse plus ancienne n'écrase jamais la dernière.
  const trimmed = query.trim();
  const searchable = fold(trimmed).replace(/[^a-z0-9]/g, "").length >= 2;
  useEffect(() => {
    const id = ++reqId.current;
    if (!searchable) {
      queueMicrotask(() => {
        setResults(null);
        setLoading(false);
      });
      return;
    }
    queueMicrotask(() => setLoading(true));
    const t = window.setTimeout(() => {
      globalSearch(trimmed)
        .then((r) => {
          if (id !== reqId.current) return;
          setResults(r);
          setActive(0);
        })
        .catch(() => id === reqId.current && setResults({ people: [], hits: [] }))
        .finally(() => id === reqId.current && setLoading(false));
    }, 220);
    return () => window.clearTimeout(t);
  }, [trimmed, searchable]);

  // Modules : filtrés localement (accès de la personne), affichés aussi sans recherche.
  const modules = useMemo<Module[]>(() => {
    const all = BOARD_APPS.filter((a) => BUILT_MODULES.has(a.id) && canShowModule(visible, a.id)).map((a) => ({ id: a.id, ...appLabel(a) }));
    if (!trimmed) return all;
    const q = fold(trimmed);
    return all.filter((m) => fold(`${m.label} ${m.kicker}`).includes(q)).slice(0, 4);
  }, [visible, appLabel, trimmed]);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (trimmed) for (const m of modules) list.push({ key: `m-${m.id}`, type: "module", module: m });
    for (const p of results?.people ?? []) list.push({ key: `p-${p.id}`, type: "person", person: p });
    const hits = results?.hits ?? [];
    for (const kind of KIND_ORDER) for (const h of hits.filter((x) => x.kind === kind)) list.push({ key: `${h.kind}-${h.id}`, type: "hit", hit: h });
    return list;
  }, [modules, results, trimmed]);

  const current = rows[active] ?? null;
  // Personne survolée / sélectionnée, sinon la première trouvée : « Léa » montre tout de suite tout sur Léa.
  const focusPerson = trimmed ? (current?.type === "person" ? current.person : (results?.people[0] ?? null)) : null;
  const focusId = focusPerson?.id ?? null;

  useEffect(() => {
    if (!focusId) return;
    const cached = activityCache.current.get(focusId);
    if (cached !== undefined) {
      queueMicrotask(() => setActivity({ id: focusId, data: cached }));
      return;
    }
    queueMicrotask(() => setActivity({ id: focusId, data: null }));
    const t = window.setTimeout(() => {
      personActivity(focusId)
        .then((d) => {
          activityCache.current.set(focusId, d);
          setActivity((prev) => (prev?.id === focusId ? { id: focusId, data: d } : prev));
        })
        .catch(() => undefined);
    }, 120);
    return () => window.clearTimeout(t);
  }, [focusId]);

  const finish = () => {
    if (trimmed) pushRecent(trimmed);
    setOpen(false);
    inputRef.current?.blur();
  };
  const goApp = (app: string, extra = "") => {
    finish();
    if (!extra && onNavigate) onNavigate(app);
    else window.location.assign(`/?app=${app}${extra}`);
  };
  const goEvent = (id: string) => {
    finish();
    void openEvent(id);
  };
  const goCard = (id: string) => {
    finish();
    openTeamCard(id);
  };

  const openHit = (h: SearchHit) => {
    switch (h.kind) {
      case "event":
        return goEvent(h.id);
      case "comment":
        return goEvent(h.eventId);
      case "card":
        return goCard(h.id);
      case "publication":
        return goApp("audiovisuel");
      case "tournoi":
        return goApp("tournois", `&openTournoi=${h.id}`);
      case "transfer":
        return goApp("transfer", `&openTransfer=${h.id}`);
      case "invoice":
      case "expense":
        return h.eventId ? goEvent(h.eventId) : goApp("frais");
    }
  };
  const openRow = (r: Row) => {
    if (r.type === "module") goApp(r.module.id);
    else if (r.type === "hit") openHit(r.hit);
    else setActive(rows.indexOf(r));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query) setQuery("");
      else finish();
      return;
    }
    if (!rows.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      openRow(current);
    }
  };

  // Garde la ligne active visible pendant la navigation au clavier.
  useEffect(() => {
    panelRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const noResult = !!results && !loading && rows.length === 0;

  return (
    <>
      <div
        ref={wrapRef}
        className={`ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-btn border px-3 py-2 text-ink-3 transition-colors ${
          open ? "border-link bg-card ring-2 ring-link/15" : "border-line bg-subtle"
        }`}
      >
        {loading ? <Loader2 size={16} className="shrink-0 animate-spin text-link" /> : <Search size={16} className="shrink-0" />}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Rechercher une personne, un événement, un club, une facture…"
          aria-label="Recherche dans le board"
          className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
        />
        {query ? (
          <button onClick={() => setQuery("")} aria-label="Effacer" className="shrink-0 rounded-full p-0.5 text-ink-4 hover:text-ink">
            <X size={14} />
          </button>
        ) : (
          <kbd className="shrink-0 rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-ink-4">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        )}
      </div>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: box.top, left: box.left, width: box.width }}
            className="fixed z-[70] flex max-h-[min(640px,calc(100vh-110px))] overflow-hidden rounded-modal border border-line bg-card shadow-modal"
          >
            {/* Colonne gauche : résultats */}
            <div className={`min-w-0 overflow-y-auto py-2 ${focusPerson ? "w-[46%] border-r border-line" : "w-full"}`}>
              {!trimmed && (
                <>
                  {recent.length > 0 && (
                    <Section title="Recherches récentes">
                      {recent.map((r) => (
                        <button key={r} onClick={() => setQuery(r)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-ink-2 hover:bg-hover">
                          <Clock size={14} className="shrink-0 text-ink-4" /> <span className="truncate">{r}</span>
                        </button>
                      ))}
                    </Section>
                  )}
                  <Section title="Aller à">
                    <div className="grid grid-cols-3 gap-0.5 px-1.5">
                      {modules.map((m) => (
                        <button key={m.id} onClick={() => goApp(m.id)} className="flex items-center gap-2 rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover">
                          <LayoutGrid size={13} className="shrink-0 text-ink-4" /> <span className="truncate">{m.label}</span>
                        </button>
                      ))}
                    </div>
                  </Section>
                  <p className="px-3 pt-2 text-[11px] leading-relaxed text-ink-4">
                    Un prénom suffit pour retrouver tout ce qui concerne une personne. Plusieurs mots affinent (« léa metz », « tournoi u11 »), sans se soucier des accents.
                  </p>
                </>
              )}

              {trimmed && !searchable && <p className="px-3 py-6 text-center text-xs text-ink-4">Tapez au moins 2 caractères.</p>}
              {searchable && loading && !results && <p className="px-3 py-6 text-center text-xs text-ink-4">Recherche dans le board…</p>}
              {noResult && (
                <p className="px-3 py-6 text-center text-sm text-ink-3">
                  Aucun résultat pour « {trimmed} ».
                  <span className="mt-1 block text-[11px] text-ink-4">Essayez un seul mot, un prénom ou un nom de club.</span>
                </p>
              )}

              {trimmed &&
                groupRows(rows).map((g) => (
                  <Section key={g.title} title={g.title} count={g.rows.length}>
                    {g.rows.map((r) => {
                      const i = rows.indexOf(r);
                      return <RowButton key={r.key} row={r} index={i} active={i === active} onHover={() => setActive(i)} onClick={() => openRow(r)} />;
                    })}
                  </Section>
                ))}

              {trimmed && rows.length > 0 && (
                <div className="mt-1 flex items-center gap-3 border-t border-line px-3 pt-2 text-[10px] text-ink-4">
                  <span>↑ ↓ naviguer</span>
                  <span className="flex items-center gap-0.5">
                    <CornerDownLeft size={10} /> ouvrir
                  </span>
                  <span>Échap fermer</span>
                </div>
              )}
            </div>

            {/* Colonne droite : tout sur la personne */}
            {focusPerson && (
              <div className="min-w-0 flex-1 overflow-y-auto bg-subtle/40 p-4">
                <PersonPanel
                  person={focusPerson}
                  activity={activity?.id === focusPerson.id ? activity.data : null}
                  onEvent={goEvent}
                  onCard={goCard}
                  onApp={(app) => goApp(app)}
                  onFinish={finish}
                />
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

function groupRows(rows: Row[]) {
  const groups: { title: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const title = r.type === "module" ? "Modules" : r.type === "person" ? "Personnes" : KIND_META[r.hit.kind].label;
    const g = groups.find((x) => x.title === title);
    if (g) g.rows.push(r);
    else groups.push({ title, rows: [r] });
  }
  return groups;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="pb-1.5">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">
        {title}
        {count != null && <span className="rounded-full bg-subtle px-1.5 text-[9px] font-bold">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function RowButton({ row, index, active, onHover, onClick }: { row: Row; index: number; active: boolean; onHover: () => void; onClick: () => void }) {
  const base = `flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${active ? "bg-sel-bg" : "hover:bg-hover"}`;
  if (row.type === "module")
    return (
      <button data-row={index} onMouseMove={onHover} onClick={onClick} className={base}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-subtle text-ink-3">
          <LayoutGrid size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{row.module.label}</span>
          <span className="block truncate text-[10px] uppercase tracking-wide text-ink-4">{row.module.kicker}</span>
        </span>
        <ArrowRight size={13} className="shrink-0 text-ink-4" />
      </button>
    );
  if (row.type === "person")
    return (
      <button data-row={index} onMouseMove={onHover} onClick={onClick} className={base}>
        <Avatar person={row.person} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{row.person.name}</span>
          <span className="block truncate text-[11px] text-ink-4">{[row.person.service, row.person.email].filter(Boolean).join(" · ")}</span>
        </span>
        <ChevronRight size={13} className={`shrink-0 ${active ? "text-link" : "text-ink-4"}`} />
      </button>
    );
  const h = row.hit;
  const Icon = KIND_META[h.kind].icon;
  const org = h.kind === "event" && h.eventType ? EVENT_TYPE_TO_ORG[h.eventType as DbEventType] : null;
  const color = org ? ORG_COLORS[org]?.base : null;
  return (
    <button data-row={index} onMouseMove={onHover} onClick={onClick} className={base}>
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-subtle text-ink-3">
        <Icon size={14} />
        {color && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card" style={{ background: color }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{h.title}</span>
        <span className="block truncate text-[11px] text-ink-4">{h.subtitle}</span>
      </span>
    </button>
  );
}

function Block({ title, icon: Icon, children, empty }: { title: string; icon: typeof CalendarDays; children: React.ReactNode; empty?: boolean }) {
  if (empty) return null;
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">
        <Icon size={12} /> {title}
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-card">{children}</div>
    </div>
  );
}

function Line({ title, meta, onClick, badge }: { title: string; meta?: string; onClick?: () => void; badge?: string }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left last:border-b-0 enabled:hover:bg-hover">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-ink">{title}</span>
        {meta && <span className="block truncate text-[10px] text-ink-4">{meta}</span>}
      </span>
      {badge && <span className="shrink-0 rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-bold text-ink-3">{badge}</span>}
    </button>
  );
}

function PersonPanel({
  person,
  activity: a,
  onEvent,
  onCard,
  onApp,
  onFinish,
}: {
  person: SearchPerson;
  activity: PersonActivity | null;
  onEvent: (id: string) => void;
  onCard: (id: string) => void;
  onApp: (app: string) => void;
  onFinish: () => void;
}) {
  const nothing =
    a && !a.upcoming.length && !a.past.length && !a.cards.length && !a.publications.length && !a.expenses?.length && !a.invoices?.length && !a.transfers.length && !a.comments.length;
  const first = person.name.split(" ")[0];
  const roleLabel = person.role === "admin" ? "Administrateur" : person.role === "super_user" ? "Super user" : null;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar person={person} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-extrabold text-ink">{person.name}</div>
          <div className="truncate text-[11px] text-ink-4">{[person.service, roleLabel].filter(Boolean).join(" · ") || "Membre du board"}</div>
        </div>
        {person.email && (
          <a
            href={`mailto:${person.email}`}
            onClick={onFinish}
            title={person.email}
            className="flex shrink-0 items-center gap-1 rounded-btn border border-line bg-card px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 hover:bg-hover"
          >
            <Mail size={12} /> E-mail
          </a>
        )}
      </div>

      {!a ? (
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-4">
          <Loader2 size={14} className="animate-spin" /> Tout ce qui concerne {first}…
        </div>
      ) : nothing ? (
        <p className="mt-6 text-center text-xs text-ink-4">Rien de visible pour vous concernant {first}.</p>
      ) : (
        <>
          <Block title="Prochains événements" icon={CalendarDays} empty={!a.upcoming.length}>
            {a.upcoming.map((e) => (
              <Line key={e.id} title={e.title} meta={[dayTime(e.start), e.location].filter(Boolean).join(" · ")} onClick={() => onEvent(e.id)} />
            ))}
          </Block>
          <Block title="Cartes Espace Team" icon={SquareKanban} empty={!a.cards.length}>
            {a.cards.map((c) => (
              <Line key={c.id} title={c.title} meta={c.due ? `Échéance ${day(c.due)}` : undefined} badge={c.list ?? undefined} onClick={() => onCard(c.id)} />
            ))}
          </Block>
          <Block title="Frais" icon={Receipt} empty={!a.expenses?.length}>
            {a.expenses?.map((x) => (
              <Line key={x.id} title={x.label} meta={`${euros(x.amount)} · ${day(x.date)}`} badge={x.status} onClick={() => (x.eventId ? onEvent(x.eventId) : onApp("frais"))} />
            ))}
          </Block>
          <Block title="Factures" icon={FileText} empty={!a.invoices?.length}>
            {a.invoices?.map((i) => (
              <Line
                key={i.id}
                title={i.label}
                meta={[euros(i.amount), day(i.date)].filter(Boolean).join(" · ")}
                badge={i.status}
                onClick={() => (i.eventId ? onEvent(i.eventId) : onApp("frais"))}
              />
            ))}
          </Block>
          <Block title="Publications" icon={ImageIcon} empty={!a.publications.length}>
            {a.publications.map((p) => (
              <Line key={p.id} title={p.title} meta={day(p.date)} badge={p.status} onClick={() => onApp("audiovisuel")} />
            ))}
          </Block>
          <Block title="Transferts envoyés" icon={Send} empty={!a.transfers.length}>
            {a.transfers.map((t) => (
              <Line key={t.id} title={t.title} meta={`${t.files} fichier(s) · ${day(t.date)}`} onClick={() => onApp("transfer")} />
            ))}
          </Block>
          <Block title="Derniers commentaires" icon={MessageSquare} empty={!a.comments.length}>
            {a.comments.map((c) => (
              <Line key={c.id} title={c.body} meta={`${c.eventTitle} · ${day(c.date)}`} onClick={() => onEvent(c.eventId)} />
            ))}
          </Block>
          <Block title="Événements passés" icon={CalendarDays} empty={!a.past.length}>
            {a.past.map((e) => (
              <Line key={e.id} title={e.title} meta={[day(e.start), e.location].filter(Boolean).join(" · ")} onClick={() => onEvent(e.id)} />
            ))}
          </Block>
        </>
      )}
    </div>
  );
}
