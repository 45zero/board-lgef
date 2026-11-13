"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, CalendarDays, FileText, Heart, Home, LogOut, Maximize2, MessageCircle, Minus, Monitor, Moon, PlusSquare, Search, Sun, X } from "lucide-react";
import { ChatThread } from "@/components/fief/chat";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/fief/feed";
import { useFiefUnread } from "@/components/fief/notifications";
import { useDirectory } from "@/components/fief/directory";
export { loadDirectory, useDirectory, type DirectoryEntry } from "@/components/fief/directory";
import { Crest, FiefButton, PublicFrame, useFiefHref, useFiefMe, type FiefMe } from "@/components/fief/ui";

// Structure des pages membres de FIEF, dans l'esprit des réseaux sociaux (maquette Instagram fournie le 13/11) :
// ordinateur — barre du haut (recherche, onglets Fil d'actu · Documents, messages, notifications, photo de
// profil et son menu), colonne de gauche (page FIEF, navigation, prochains événements), contenu au centre,
// pastille « Messages » ; mobile — en-tête, onglets, barre du bas (accueil, recherche, publier, calendrier,
// messages, profil). Thème clair / sombre / automatique (couleurs .fief-theme, globals.css).

// ── Thème ─────────────────────────────────────────────────────────────────────────────────────────────

export type FiefThemePref = "light" | "dark" | "system";

function applyTheme(pref: FiefThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.fiefTheme = dark ? "dark" : "light";
}

function readThemePref(): FiefThemePref {
  try {
    const v = localStorage.getItem("fief-theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function useFiefTheme() {
  const [pref, setPref] = useState<FiefThemePref>(() => (typeof window === "undefined" ? "system" : readThemePref()));
  useEffect(() => {
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
  const choose = (p: FiefThemePref) => {
    try {
      if (p === "system") localStorage.removeItem("fief-theme");
      else localStorage.setItem("fief-theme", p);
    } catch {
      // stockage indisponible : le choix vaut pour cette visite
    }
    setPref(p);
  };
  return { pref, choose };
}

export function ThemeChoice() {
  const { pref, choose } = useFiefTheme();
  const options: { id: FiefThemePref; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "Clair", icon: Sun },
    { id: "dark", label: "Sombre", icon: Moon },
    { id: "system", label: "Auto", icon: Monitor },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-f-subtle p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => choose(o.id)}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold ${pref === o.id ? "bg-f-surface text-f-text shadow-sm" : "text-f-muted"}`}
        >
          <o.icon size={14} /> {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Données partagées (annuaire, conversations, événements) ───────────────────────────────────────────

interface ConversationLite {
  id: string;
  other: { id: string; name: string; team: boolean; club: string | null };
  unread: number;
  last_body: string | null;
  last_at: string;
  last_mine: boolean;
}

function useConversations() {
  const [convs, setConvs] = useState<ConversationLite[]>([]);
  const [tick, setTick] = useState(0);
  const pathname = usePathname();
  useEffect(() => {
    let alive = true;
    const load = () =>
      createClient()
        .rpc("fief_my_conversations")
        .then(({ data }) => {
          if (alive) setConvs((data ?? []) as ConversationLite[]);
        });
    void load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [pathname, tick]);
  return { convs, refresh: () => setTick((t) => t + 1) };
}

interface UpcomingEvent {
  id: string;
  title: string;
  start_date: string;
  location: string | null;
  online_meeting: boolean;
}

function useUpcoming() {
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  useEffect(() => {
    const now = Date.now();
    createClient()
      .rpc("fief_my_events", { p_from: new Date(now - 3600_000).toISOString(), p_to: new Date(now + 90 * 86_400_000).toISOString() })
      .then(({ data }) => setEvents(((data ?? []) as UpcomingEvent[]).slice(0, 4)));
  }, []);
  return events;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ── Recherche (membres, documents partagés) ───────────────────────────────────────────────────────────

interface DocHit {
  id: string;
  name: string;
  folder_name: string | null;
}

export function SearchPanel({ autoFocus = false, onNavigate }: { autoFocus?: boolean; onNavigate?: () => void }) {
  const href = useFiefHref();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(autoFocus);
  const [docs, setDocs] = useState<DocHit[] | null>(null);
  const people = useDirectory();
  const me = useAuth().user?.id;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || docs) return;
    createClient()
      .rpc("fief_documents_list", { p_scope: "shared", p_folder: null })
      .then(({ data }) => setDocs((data ?? []) as DocHit[]));
  }, [open, docs]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!autoFocus && box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [autoFocus]);

  const term = fold(q.trim());
  const peopleHits = term ? (people ?? []).filter((p) => p.user_id !== me && fold(`${p.first_name} ${p.last_name} ${p.club_name ?? ""}`).includes(term)).slice(0, 6) : [];
  const docHits = term ? (docs ?? []).filter((d) => fold(`${d.name} ${d.folder_name ?? ""}`).includes(term)).slice(0, 6) : [];
  const done = () => {
    setOpen(false);
    setQ("");
    onNavigate?.();
  };

  return (
    <div ref={box} className="relative w-full">
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-f-faint" />
        <input
          autoFocus={autoFocus}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher une membre, un club, un document…"
          className="w-full rounded-xl bg-f-subtle py-2.5 pl-10 pr-9 text-sm text-f-text outline-none placeholder:text-f-faint focus:ring-2 focus:ring-f-accent/30"
        />
        {q && (
          <button onClick={() => setQ("")} aria-label="Effacer" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-f-faint hover:text-f-text">
            <X size={14} />
          </button>
        )}
      </div>
      {open && term && (
        <div className={`${autoFocus ? "mt-3" : "absolute left-0 right-0 top-full z-40 mt-2 shadow-xl"} max-h-[70dvh] overflow-y-auto rounded-2xl border border-f-border bg-f-surface p-2`}>
          {!peopleHits.length && !docHits.length && <p className="px-3 py-4 text-sm text-f-muted">Aucun résultat pour « {q.trim()} ».</p>}
          {peopleHits.length > 0 && <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-f-faint">Membres</p>}
          {peopleHits.map((p) => (
            <Link key={p.user_id} href={href(`/messages?to=${p.user_id}`)} onClick={done} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-f-subtle">
              <Avatar author={{ id: p.user_id, team: false, name: `${p.first_name} ${p.last_name}` }} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {p.first_name} {p.last_name}
                </span>
                {p.club_name && <span className="block truncate text-xs text-f-muted">{p.club_name}</span>}
              </span>
              <MessageCircle size={16} className="text-f-faint" />
            </Link>
          ))}
          {docHits.length > 0 && <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-f-faint">Documents</p>}
          {docHits.map((d) => (
            <a key={d.id} href={`/api/fief/documents/${d.id}?inline=1`} target="_blank" rel="noopener" onClick={done} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-f-subtle">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-f-subtle text-f-link">
                <FileText size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{d.name}</span>
                <span className="block truncate text-xs text-f-muted">{d.folder_name ?? "Divers"}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Morceaux de la structure ──────────────────────────────────────────────────────────────────────────

function useCurrentPath() {
  return usePathname().replace(/^\/fief/, "") || "/";
}

/** Onglets Fil d'actu · Documents (barre du haut, et sous l'en-tête sur mobile). */
function FeedDocTabs({ className = "" }: { className?: string }) {
  const href = useFiefHref();
  const current = useCurrentPath();
  const tabs = [
    { path: "/", label: "Fil d'actu" },
    { path: "/documents", label: "Documents" },
  ];
  return (
    <nav className={`flex items-center gap-6 ${className}`}>
      {tabs.map((t) => (
        <Link key={t.path} href={href(t.path)} className={`relative py-1 text-[15px] font-bold transition ${current === t.path ? "text-f-text" : "text-f-faint hover:text-f-muted"}`}>
          {t.label}
          {current === t.path && <span className="absolute -bottom-2 left-0 right-0 h-[2px] rounded-full bg-f-text lg:-bottom-[13px]" />}
        </Link>
      ))}
    </nav>
  );
}

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[#D7262E] px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-f-surface">{n > 9 ? "9+" : n}</span>
  );
}

function ProfileMenu({ me }: { me: FiefMe }) {
  const href = useFiefHref();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Mon compte" className="rounded-full ring-2 ring-transparent hover:ring-f-border">
        <Avatar author={{ id: me.userId, team: false, name: `${me.firstName} ${me.lastName}` }} size={34} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-f-border bg-f-surface p-2 shadow-2xl">
          <Link href={href("/profil")} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-f-subtle">
            <Avatar author={{ id: me.userId, team: false }} size={44} />
            <span className="min-w-0">
              <span className="block truncate font-bold">
                {me.firstName} {me.lastName}
              </span>
              <span className="block truncate text-xs text-f-muted">Voir mon profil</span>
            </span>
          </Link>
          <div className="my-1 border-t border-f-border" />
          <Link href={href("/notifications")} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold hover:bg-f-subtle">
            <Bell size={17} /> Notifications
          </Link>
          <div className="px-2.5 py-2">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-f-faint">Apparence</p>
            <ThemeChoice />
          </div>
          <div className="my-1 border-t border-f-border" />
          <button onClick={() => void logout()} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold text-f-danger hover:bg-f-subtle">
            <LogOut size={17} /> Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

const ICON_TABS = [
  { path: "/", label: "Fil d'actu", icon: Home },
  { path: "/documents", label: "Documents", icon: FileText },
  { path: "/calendrier", label: "Calendrier", icon: CalendarDays },
];

function TopBar({ me, unreadMessages, unreadNotifs }: { me: FiefMe; unreadMessages: number; unreadNotifs: number }) {
  const href = useFiefHref();
  const current = useCurrentPath();
  return (
    <header className="sticky top-0 z-30 hidden border-b border-f-border bg-f-surface shadow-sm lg:block">
      <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-4 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={href("/")} aria-label="FIEF — accueil" className="shrink-0">
            <Crest size={36} />
          </Link>
          <div className="w-full max-w-[290px]">
            <SearchPanel />
          </div>
        </div>
        <nav className="flex h-14 items-stretch">
          {ICON_TABS.map((t) => {
            const active = current === t.path;
            return (
              <Link key={t.path} href={href(t.path)} title={t.label} aria-label={t.label} className="group relative flex w-[110px] items-center justify-center xl:w-[128px]">
                <span className={`flex h-12 w-full items-center justify-center rounded-lg ${active ? "text-f-accent" : "text-f-muted group-hover:bg-f-subtle"}`}>
                  <t.icon size={26} strokeWidth={active ? 2.4 : 1.9} />
                </span>
                {active && <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-t-full bg-f-accent" />}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-end gap-2">
          <Link href={href("/messages")} aria-label="Messages" className="relative flex h-10 w-10 items-center justify-center rounded-full bg-f-subtle text-f-text hover:brightness-95">
            <MessageCircle size={20} />
            <Badge n={unreadMessages} />
          </Link>
          <Link href={href("/notifications")} aria-label="Notifications" className="relative flex h-10 w-10 items-center justify-center rounded-full bg-f-subtle text-f-text hover:brightness-95">
            <Bell size={20} />
            <Badge n={unreadNotifs} />
          </Link>
          <ProfileMenu me={me} />
        </div>
      </div>
    </header>
  );
}

const NAV = [
  { path: "/", label: "Fil d'actu", icon: Home, color: "#1877F2" },
  { path: "/calendrier", label: "Calendrier", icon: CalendarDays, color: "#D7262E" },
  { path: "/messages", label: "Messages", icon: MessageCircle, color: "#7C3AED" },
  { path: "/documents", label: "Documents", icon: FileText, color: "#E0A12A" },
  { path: "/notifications", label: "Notifications", icon: Bell, color: "#0F766E" },
];

function LeftSidebar({ me, unreadMessages, unreadNotifs }: { me: FiefMe; unreadMessages: number; unreadNotifs: number }) {
  const href = useFiefHref();
  const current = useCurrentPath();
  const events = useUpcoming();
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[300px] shrink-0 flex-col overflow-y-auto py-4 pr-2 lg:flex">
      <Link href={href("/profil")} className={`flex items-center gap-3 rounded-lg px-2 py-2 ${current === "/profil" ? "bg-f-subtle" : "hover:bg-f-subtle"}`}>
        <Avatar author={{ id: me.userId, team: false, name: `${me.firstName} ${me.lastName}` }} size={36} />
        <span className="truncate text-[15px] font-semibold">
          {me.firstName} {me.lastName}
        </span>
      </Link>
      {NAV.map((n) => {
        const active = current === n.path;
        const count = n.path === "/messages" ? unreadMessages : n.path === "/notifications" ? unreadNotifs : 0;
        return (
          <Link key={n.path} href={href(n.path)} className={`flex items-center gap-3 rounded-lg px-2 py-2 ${active ? "bg-f-subtle" : "hover:bg-f-subtle"}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: `${n.color}1f`, color: n.color }}>
              <n.icon size={20} strokeWidth={2.2} />
            </span>
            <span className={`flex-1 text-[15px] ${active ? "font-bold" : "font-semibold"}`}>{n.label}</span>
            {count > 0 && <span className="rounded-full bg-[#D7262E] px-1.5 text-[11px] font-bold leading-5 text-white">{count > 9 ? "9+" : count}</span>}
          </Link>
        );
      })}

      <div className="my-3 border-t border-f-border" />
      <div className="mb-2 flex items-center justify-between px-2">
        <p className="text-[17px] font-bold text-f-muted">Prochains événements</p>
        <Link href={href("/calendrier")} className="text-sm font-semibold text-f-link hover:underline">
          Tout voir
        </Link>
      </div>
      {events === null && <p className="px-2 text-sm text-f-muted">Chargement…</p>}
      {events?.length === 0 && <p className="px-2 text-sm text-f-muted">Aucun événement à venir.</p>}
      {events?.map((e) => {
        const d = new Date(e.start_date);
        return (
          <Link key={e.id} href={href(`/calendrier?event=${e.id}`)} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-f-subtle">
            <span className="flex w-10 shrink-0 flex-col items-center rounded-lg bg-f-danger-bg py-1">
              <span className="text-[9px] font-bold uppercase text-[#D7262E]">{d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</span>
              <span className="text-base font-black leading-none">{d.getDate()}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{e.title}</span>
              <span className="block truncate text-xs text-f-muted">
                {d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                {e.online_meeting ? " · En ligne" : e.location ? ` · ${e.location}` : ""}
              </span>
            </span>
          </Link>
        );
      })}
      <div className="mt-auto flex items-center gap-2 px-2 pt-6 text-[11px] text-f-faint">
        <Crest size={18} /> FIEF · Ligue du Grand Est de Football
      </div>
    </aside>
  );
}

/** Chat en bas à droite (ordinateur), façon Messenger : pastille → liste des discussions → fenêtre de conversation. */
function ChatDock({ me, convs, unread, onChanged }: { me: FiefMe; convs: ConversationLite[]; unread: number; onChanged: () => void }) {
  const href = useFiefHref();
  const current = useCurrentPath();
  const [panel, setPanel] = useState(false);
  const [active, setActive] = useState<ConversationLite | null>(null);
  if (current === "/messages") return null;

  if (active)
    return (
      <div className="fixed bottom-0 right-6 z-40 hidden h-[480px] w-[340px] flex-col overflow-hidden rounded-t-2xl border border-f-border bg-f-surface shadow-2xl lg:flex">
        <ChatThread
          compact
          meId={me.userId}
          conversation={{ id: active.id, other: active.other }}
          draftTo={null}
          onSent={onChanged}
          onRead={onChanged}
          header={
            <div className="flex items-center gap-2.5 border-b border-f-border px-3 py-2 shadow-sm">
              <Avatar author={active.other} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{active.other.name}</span>
                {active.other.club && <span className="block truncate text-[11px] text-f-muted">{active.other.club}</span>}
              </span>
              <Link href={href(`/messages?c=${active.id}`)} aria-label="Agrandir" title="Ouvrir dans Messages" className="rounded-full p-1.5 text-f-accent hover:bg-f-subtle">
                <Maximize2 size={16} />
              </Link>
              <button onClick={() => setActive(null)} aria-label="Réduire" title="Réduire" className="rounded-full p-1.5 text-f-accent hover:bg-f-subtle">
                <Minus size={18} />
              </button>
              <button
                onClick={() => {
                  setActive(null);
                  setPanel(false);
                }}
                aria-label="Fermer"
                className="rounded-full p-1.5 text-f-accent hover:bg-f-subtle"
              >
                <X size={18} />
              </button>
            </div>
          }
        />
      </div>
    );

  return (
    <div className="fixed bottom-6 right-6 z-40 hidden flex-col items-end gap-3 lg:flex">
      {panel && (
        <div className="flex max-h-[min(520px,calc(100dvh-10rem))] w-[340px] flex-col overflow-hidden rounded-2xl border border-f-border bg-f-surface shadow-2xl">
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <p className="text-xl font-extrabold">Discussions</p>
            <Link href={href("/messages")} title="Ouvrir Messages" aria-label="Ouvrir Messages" className="rounded-full p-2 hover:bg-f-subtle">
              <Maximize2 size={16} />
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {convs.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-f-muted">
                Aucune discussion.{" "}
                <Link href={href("/messages")} className="font-semibold text-f-link hover:underline">
                  Écrire à une membre
                </Link>
              </p>
            )}
            {convs.map((c) => (
              <button key={c.id} onClick={() => setActive(c)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-f-subtle">
                <Avatar author={c.other} size={48} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[15px] ${c.unread ? "font-extrabold" : "font-semibold"}`}>{c.other.name}</span>
                  <span className={`block truncate text-[13px] ${c.unread ? "font-bold text-f-text" : "text-f-muted"}`}>
                    {c.last_mine ? "Vous : " : ""}
                    {c.last_body ?? "Nouvelle conversation"}
                  </span>
                </span>
                {c.unread > 0 && <span className="h-3 w-3 shrink-0 rounded-full bg-f-accent" />}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={() => setPanel((v) => !v)}
        className="flex items-center gap-3 rounded-full border border-f-border bg-f-surface py-2.5 pl-5 pr-3 shadow-2xl transition hover:-translate-y-0.5"
      >
        <span className="relative">
          <MessageCircle size={22} />
          <Badge n={unread} />
        </span>
        <span className="font-extrabold">Messages</span>
        <span className="flex -space-x-2">
          {convs.slice(0, 3).map((c) => (
            <span key={c.id} className="rounded-full ring-2 ring-f-surface">
              <Avatar author={c.other} size={28} />
            </span>
          ))}
        </span>
      </button>
    </div>
  );
}

function MobileHeader({ unreadNotifs }: { unreadNotifs: number }) {
  const href = useFiefHref();
  const current = useCurrentPath();
  const showTabs = current === "/" || current === "/documents";
  return (
    <header className="sticky top-0 z-30 border-b border-f-border bg-f-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link href={href("/")} className="flex items-center gap-2">
          <Crest size={28} />
          <span className="text-2xl font-black italic leading-none tracking-tight">FIEF</span>
        </Link>
        <Link href={href("/notifications")} aria-label="Notifications" className="relative ml-auto rounded-full p-2 hover:bg-f-subtle">
          <Heart size={25} />
          <Badge n={unreadNotifs} />
        </Link>
      </div>
      {showTabs && <FeedDocTabs className="px-4 pb-2.5" />}
    </header>
  );
}

function MobileBottomNav({ me, unreadMessages }: { me: FiefMe; unreadMessages: number }) {
  const href = useFiefHref();
  const current = useCurrentPath();
  const items = [
    { path: "/", label: "Accueil", icon: Home },
    { path: "/recherche", label: "Rechercher", icon: Search },
    { path: "/?publier=1", label: "Publier", icon: PlusSquare },
    { path: "/calendrier", label: "Calendrier", icon: CalendarDays },
    { path: "/messages", label: "Messages", icon: MessageCircle },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-f-border bg-f-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-6">
        {items.map((t) => {
          const active = current === t.path;
          return (
            <Link key={t.path} href={href(t.path)} aria-label={t.label} className={`relative flex justify-center py-3 ${active ? "text-f-text" : "text-f-muted"}`}>
              <span className="relative">
                <t.icon size={26} strokeWidth={active ? 2.5 : 1.8} />
                {t.path === "/messages" && <Badge n={unreadMessages} />}
              </span>
            </Link>
          );
        })}
        <Link href={href("/profil")} aria-label="Profil" className="flex justify-center py-2.5">
          <span className={`rounded-full ${current === "/profil" ? "ring-2 ring-f-text" : ""}`}>
            <Avatar author={{ id: me.userId, team: false }} size={28} />
          </span>
        </Link>
      </div>
    </nav>
  );
}

/** Espace connecté : barre du haut + colonne de gauche (ordinateur), en-tête + barre du bas (mobile). */
export function MemberShell({ me, children }: { me: FiefMe; children: ReactNode }) {
  const unreadNotifs = useFiefUnread();
  const { convs, refresh: refreshConvs } = useConversations();
  const unreadMessages = convs.filter((c) => c.unread > 0).length;
  useFiefTheme(); // applique le thème choisi (et suit le téléphone en « Auto »)
  return (
    <div className="min-h-dvh bg-f-bg pb-20 text-f-text lg:pb-0">
      <TopBar me={me} unreadMessages={unreadMessages} unreadNotifs={unreadNotifs} />
      <MobileHeader unreadNotifs={unreadNotifs} />
      <div className="flex gap-6 px-0 sm:px-4 lg:pl-2 lg:pr-4">
        <LeftSidebar me={me} unreadMessages={unreadMessages} unreadNotifs={unreadNotifs} />
        <main className="min-w-0 flex-1 px-3 py-4 sm:px-0 lg:py-4">{children}</main>
      </div>
      <ChatDock me={me} convs={convs} unread={unreadMessages} onChanged={refreshConvs} />
      <MobileBottomNav me={me} unreadMessages={unreadMessages} />
    </div>
  );
}

/** Accès membre : redirige vers l'accueil public si pas connectée, message si la fiche n'est pas active. */
export function MemberGate({ children }: { children: (me: FiefMe) => ReactNode }) {
  const { user, loading, me } = useFiefMe();
  const href = useFiefHref();
  const router = useRouter();
  const { logout } = useAuth();
  const home = href("/");
  useEffect(() => {
    if (!loading && !user) router.replace(home);
  }, [loading, user, home, router]);
  if (loading || !user)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-f-bg">
        <Crest size={72} className="animate-pulse" />
      </div>
    );
  if (!me || me.status !== "active")
    return (
      <PublicFrame>
        <h1 className="text-xl font-extrabold">{me?.status === "suspended" ? "Accès suspendu" : "Pas encore membre"}</h1>
        <p className="mt-2 text-sm text-f-muted">
          {me?.status === "suspended"
            ? "Votre accès à FIEF est suspendu. Contactez l'équipe FIEF de la Ligue pour en savoir plus."
            : "Ce compte n'est pas encore membre de FIEF. Faites une demande d'adhésion : l'équipe FIEF vous répondra par e-mail."}
        </p>
        <div className="mt-5 space-y-2">
          {!me && (
            <Link href={href("/adhesion")} className="flex w-full items-center justify-center rounded-xl bg-f-accent px-4 py-3 text-[15px] font-bold text-white">
              Demander une adhésion
            </Link>
          )}
          <FiefButton variant="outline" onClick={() => void logout()}>
            Se déconnecter
          </FiefButton>
        </div>
      </PublicFrame>
    );
  return <MemberShell me={me}>{children(me)}</MemberShell>;
}

// ── Accueil : « stories » et membres ───────────────────────────────────────────────────────────────────

/** Rangée façon « stories » : publier, puis les dernières arrivées (toucher = écrire). */
export function StoriesRow({ me, onPublish }: { me: FiefMe; onPublish: () => void }) {
  const href = useFiefHref();
  const people = useDirectory();
  const newest = useMemo(
    () =>
      (people ?? [])
        .filter((p) => p.user_id !== me.userId)
        .sort((a, b) => b.joined_at.localeCompare(a.joined_at))
        .slice(0, 15),
    [people, me.userId]
  );
  return (
    <div className="-mx-3 flex gap-4 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <button onClick={onPublish} className="flex w-[74px] shrink-0 flex-col items-center gap-1.5">
        <span className="relative">
          <span className="block rounded-full p-[5px]">
            <Avatar author={{ id: me.userId, team: false }} size={62} />
          </span>
          <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-f-bg bg-f-accent text-lg font-bold leading-none text-white">+</span>
        </span>
        <span className="w-full truncate text-center text-xs">Publier</span>
      </button>
      {newest.map((p) => (
        <Link key={p.user_id} href={href(`/messages?to=${p.user_id}`)} className="flex w-[74px] shrink-0 flex-col items-center gap-1.5" title={`Écrire à ${p.first_name}`}>
          <Avatar author={{ id: p.user_id, team: false, name: p.first_name }} size={62} ring />
          <span className="w-full truncate text-center text-xs">{p.first_name}</span>
        </Link>
      ))}
    </div>
  );
}

interface Ad {
  id: string;
  title: string;
  body: string | null;
  link_url: string | null;
  link_label: string | null;
  advertiser: string | null;
  has_image: boolean;
}

/** Colonne de droite de l'accueil : publicités « Sponsorisé », alimentées par l'équipe FIEF (board → FIEF → Publicités). */
export function AdsAside() {
  const [ads, setAds] = useState<Ad[] | null>(null);
  useEffect(() => {
    createClient()
      .rpc("fief_active_ads")
      .then(({ data }) => setAds((data ?? []) as Ad[]));
  }, []);
  return (
    <aside className="sticky top-[4.5rem] hidden h-fit w-[320px] shrink-0 xl:block">
      {!!ads?.length && (
        <>
          <p className="mb-2 px-2 text-[17px] font-bold text-f-muted">Sponsorisé</p>
          <div className="space-y-1">
            {ads.map((ad) => {
              const content = (
                <>
                  {ad.has_image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/fief/ads/${ad.id}`} alt="" loading="lazy" className="h-[120px] w-[120px] shrink-0 rounded-lg bg-f-subtle object-cover" />
                  )}
                  <span className="min-w-0 self-center">
                    <span className="line-clamp-3 text-[15px] font-semibold leading-snug">{ad.title}</span>
                    {ad.body && <span className="mt-0.5 line-clamp-2 block text-sm text-f-muted">{ad.body}</span>}
                    {(ad.advertiser || ad.link_label) && <span className="mt-1 block truncate text-xs text-f-faint">{ad.advertiser ?? ad.link_label}</span>}
                  </span>
                </>
              );
              return ad.link_url ? (
                <a key={ad.id} href={`/api/fief/ads/${ad.id}?go=1`} target="_blank" rel="noopener sponsored" className="flex gap-3 rounded-lg p-2 hover:bg-f-subtle">
                  {content}
                </a>
              ) : (
                <div key={ad.id} className="flex gap-3 rounded-lg p-2">
                  {content}
                </div>
              );
            })}
          </div>
          <div className="my-3 border-t border-f-border" />
        </>
      )}
      <p className="px-2 text-[11px] text-f-faint">FIEF · Femmes Investies dans l&apos;Environnement du Football · S&apos;engager • Partager • Grandir</p>
    </aside>
  );
}
