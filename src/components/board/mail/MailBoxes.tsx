"use client";

import { Inbox } from "lucide-react";
import { DefaultMenu } from "@/components/board/calendar/DefaultMenu";
import { unreadLabel } from "@/hooks/board/useAccountScope";
import type { AccountScope } from "@/hooks/board/useCalendarDefaults";

// Plusieurs comptes Google connectés : choix de la boîte (« Toutes les boîtes » ou une adresse),
// pastille de non lus sur chacune, clic droit = boîte affichée par défaut. Partagé par Mails
// (ordinateur, mobile) et le tableau de bord.

export type BoxAccount = { id: string; email: string; label?: string | null };

/** Couleur d'une boîte (ordre de connexion) : repère du compte sur chaque mail en « Toutes les boîtes ». */
const TONES = ["#1d4ed8", "#be185d", "#047857", "#b45309", "#6d28d9", "#0e7490"];
export const boxTone = (accounts: BoxAccount[], id: string) => TONES[Math.max(0, accounts.findIndex((a) => a.id === id)) % TONES.length];
export const boxName = (a: BoxAccount) => a.label || a.email;
/** Nom court affiché sur un mail : libellé, sinon la partie avant @. */
export const boxShort = (a: BoxAccount) => a.label || a.email.split("@")[0];

export function UnreadBubble({ count, className = "" }: { count: number | undefined; className?: string }) {
  const label = unreadLabel(count);
  if (!label) return null;
  return <span className={`shrink-0 rounded-full bg-red px-1.5 text-[10px] font-bold leading-[16px] text-white ${className}`}>{label}</span>;
}

/** Repère de la boîte d'un mail (liste « Toutes les boîtes »). */
export function BoxTag({ accounts, accountId }: { accounts: BoxAccount[]; accountId: string }) {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return null;
  const tone = boxTone(accounts, accountId);
  return (
    <span
      className="inline-flex max-w-[120px] shrink-0 items-center gap-1 truncate rounded-full border px-1.5 text-[9.5px] font-semibold leading-[15px]"
      style={{ color: tone, borderColor: `${tone}55` }}
      title={acc.email}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
      <span className="truncate">{boxShort(acc)}</span>
    </span>
  );
}

/** Menu du clic droit : boîte affichée par défaut. */
export function BoxDefaultMenu({
  accounts,
  defaultScope,
  onSetDefault,
  title = "Boîte affichée par défaut",
  allLabel = "Toutes les boîtes",
  className,
  children,
}: {
  accounts: BoxAccount[];
  defaultScope: AccountScope;
  onSetDefault: (scope: AccountScope) => void;
  title?: string;
  allLabel?: string;
  className?: string;
  children: (onContextMenu: (e: React.MouseEvent) => void) => React.ReactNode;
}) {
  return (
    <DefaultMenu
      atCursor
      className={className}
      title={title}
      footnote="Le clic simple change pour cette session seulement."
      options={[
        { label: allLabel, selected: defaultScope === "all", onSelect: () => onSetDefault("all") },
        ...accounts.map((a) => ({ label: boxName(a), selected: defaultScope === a.id, onSelect: () => onSetDefault(a.id) })),
      ]}
    >
      {children}
    </DefaultMenu>
  );
}

/**
 * Petites pastilles de boîtes (tableau de bord, mobile) : « Toutes », puis chaque adresse avec son
 * nombre de non lus. Rien avec un seul compte.
 */
export function BoxChips({
  accounts,
  scope,
  onScope,
  defaultScope,
  onSetDefault,
  unread,
  size = "sm",
  wrap = false,
}: {
  accounts: BoxAccount[];
  scope: AccountScope;
  onScope: (scope: AccountScope) => void;
  defaultScope: AccountScope;
  onSetDefault: (scope: AccountScope) => void;
  unread?: Record<string, number>;
  size?: "sm" | "md";
  /** Pastilles sur plusieurs lignes au lieu d'un défilement horizontal (colonne étroite). */
  wrap?: boolean;
}) {
  if (accounts.length < 2) return null;
  const total = accounts.reduce((n, a) => n + (unread?.[a.id] ?? 0), 0);
  const chip = (active: boolean) =>
    `flex shrink-0 items-center gap-1 rounded-full border font-semibold ${size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-3 py-1.5 text-xs"} ${
      active ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-3 hover:bg-hover"
    }`;
  const hint = " · clic droit : boîte par défaut";
  return (
    <BoxDefaultMenu accounts={accounts} defaultScope={defaultScope} onSetDefault={onSetDefault} className="relative min-w-0">
      {(onContextMenu) => (
        <div className={`flex min-w-0 items-center gap-1 ${wrap ? "flex-wrap" : "overflow-x-auto [scrollbar-width:none]"}`}>
          <button type="button" onClick={() => onScope("all")} onContextMenu={onContextMenu} className={chip(scope === "all")} title={`Toutes les boîtes${hint}`}>
            <Inbox size={size === "sm" ? 11 : 13} /> Toutes
            <UnreadBubble count={total} className={scope === "all" ? "!bg-white !text-navy" : ""} />
          </button>
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onScope(a.id)}
              onContextMenu={onContextMenu}
              className={`${chip(scope === a.id)} max-w-[170px]`}
              title={`${a.email}${hint}`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: boxTone(accounts, a.id) }} />
              <span className="truncate">{boxShort(a)}</span>
              <UnreadBubble count={unread?.[a.id]} className={scope === a.id ? "!bg-white !text-navy" : ""} />
            </button>
          ))}
        </div>
      )}
    </BoxDefaultMenu>
  );
}
