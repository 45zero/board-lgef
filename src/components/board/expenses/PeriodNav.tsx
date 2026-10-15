"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Search } from "lucide-react";
import { formatEuros } from "@/components/board/expenses/ExpenseStatus";

// Navigation par période (année → mois, total et nombre de fiches de chacun) et éléments de liste
// communs aux onglets du module Frais / Factures / GED.

/** Période choisie (année, mois ou toute l'année), commune aux onglets. */
export type Period = { year: number; monthIdx: number | null; setYear: (y: number) => void; setMonthIdx: (m: number | null) => void };

/** Appli mobile : la période se choisit dans un menu déroulé depuis l'en-tête (comme les dossiers de Mails). */
export type MobileMenu = { host: HTMLElement | null; open: boolean; onClose: () => void };
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export const monthKey = (iso: string) => iso.slice(0, 7);
export const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
};
export const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Recherche + mois (+ personne) : barre de filtres commune à « Mes frais » et « À valider ». */
export function FiltersRow({
  query,
  onQuery,
  months,
  month,
  onMonth,
  people,
  person,
  onPerson,
  children,
}: {
  query: string;
  onQuery: (v: string) => void;
  months?: string[];
  month?: string;
  onMonth?: (v: string) => void;
  people?: { id: string; name: string }[];
  person?: string;
  onPerson?: (v: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-btn border border-line bg-card px-2.5 py-1.5">
        <Search size={13} className="text-ink-4" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Rechercher…" className="w-full bg-transparent text-sm outline-none" />
      </div>
      {months && onMonth && (
        <select value={month} onChange={(e) => onMonth(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none">
          <option value="">Tous les mois</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      )}
      {people && onPerson && (
        <select value={person} onChange={(e) => onPerson(e.target.value)} className="max-w-[200px] rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none">
          <option value="">Toutes les personnes</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {children}
    </div>
  );
}

export const MONTH_LONG = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
export const yearOf = (iso: string) => Number(iso.slice(0, 4));
export const monthIndexOf = (iso: string) => Number(iso.slice(5, 7)) - 1;

/**
 * Navigation commune de Frais, en colonne à gauche : l'année, puis ses mois (total et nombre de
 * fiches de chacun) ; « Toute l'année » sans mois choisi.
 */
export function YearMonthBar({
  year,
  onYear,
  month,
  onMonth,
  stats,
}: {
  year: number;
  onYear: (y: number) => void;
  month: number | null;
  onMonth: (m: number | null) => void;
  stats: (m: number | null) => { count: number; total: number };
}) {
  const row = (active: boolean, empty: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-btn px-3 py-2 text-left text-[13px] ${
      active ? "bg-navy font-bold text-white" : empty ? "text-ink-4 hover:bg-hover" : "font-semibold text-ink-2 hover:bg-hover"
    }`;
  const figure = (active: boolean, st: { count: number; total: number }) => (
    <span className={`shrink-0 text-right font-mono text-[10px] leading-tight ${active ? "text-white/80" : "text-ink-4"}`}>
      {st.count ? (
        <>
          {formatEuros(st.total)}
          <span className="block">
            {st.count} fiche{st.count > 1 ? "s" : ""}
          </span>
        </>
      ) : (
        "—"
      )}
    </span>
  );
  const all = stats(null);
  return (
    <>
      <MobileYearMonthBar year={year} onYear={onYear} month={month} onMonth={onMonth} stats={stats} />
    <aside className="sticky top-0 hidden w-[200px] shrink-0 self-start rounded-panel border border-line bg-card p-2 md:block">
      <div className="mb-2 flex items-center justify-between rounded-btn bg-subtle px-1 py-1">
        <button onClick={() => onYear(year - 1)} aria-label="Année précédente" className="rounded-md p-1 text-ink-3 hover:bg-hover">
          <ChevronRight size={14} className="rotate-180" />
        </button>
        <span className="text-base font-extrabold text-ink">{year}</span>
        <button onClick={() => onYear(year + 1)} aria-label="Année suivante" className="rounded-md p-1 text-ink-3 hover:bg-hover">
          <ChevronRight size={14} />
        </button>
      </div>
      <button onClick={() => onMonth(null)} className={row(month === null, all.count === 0)}>
        <span>Toute l&rsquo;année</span>
        {figure(month === null, all)}
      </button>
      <div className="my-1 border-t border-line" />
      {MONTH_LONG.map((label, i) => {
        const st = stats(i);
        return (
          <button key={label} onClick={() => onMonth(i)} className={row(month === i, st.count === 0)}>
            <span>{label}</span>
            {figure(month === i, st)}
          </button>
        );
      })}
    </aside>
    </>
  );
}

/** Mobile : menu déroulé sous l'en-tête — l'année, puis « Toute l'année » et les douze mois avec leurs totaux. */
export function PeriodMenu({
  menu,
  period,
  stats,
}: {
  menu: MobileMenu;
  period: Period;
  stats: (m: number | null) => { count: number; total: number };
}) {
  if (!menu.host || !menu.open) return null;
  const { year, monthIdx, setYear, setMonthIdx } = period;
  const row = (key: string, active: boolean, label: string, st: { count: number; total: number }, onClick: () => void) => (
    <button
      key={key}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-btn px-3 py-2.5 text-left text-sm font-semibold ${
        active ? "bg-sel-bg text-link" : st.count ? "text-ink-2 active:bg-hover" : "text-ink-4 active:bg-hover"
      }`}
    >
      <span>{label}</span>
      <span className="font-mono text-[11px] font-normal">
        {st.count ? `${formatEuros(st.total)} · ${st.count} fiche${st.count > 1 ? "s" : ""}` : "—"}
      </span>
    </button>
  );
  const pick = (m: number | null) => {
    setMonthIdx(m);
    menu.onClose();
  };
  return createPortal(
    <>
      <div className="absolute inset-0 z-30 bg-black/30" onClick={menu.onClose} />
      <div className="absolute inset-x-0 top-0 z-40 max-h-[80%] overflow-y-auto rounded-b-modal border-b border-line bg-card pb-3 shadow-modal">
        <div className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Année</div>
        <div className="mx-4 flex items-center justify-between rounded-btn bg-subtle px-1 py-1">
          <button onClick={() => setYear(year - 1)} aria-label="Année précédente" className="rounded-md p-2 text-ink-3">
            <ChevronRight size={16} className="rotate-180" />
          </button>
          <span className="text-base font-extrabold text-ink">{year}</span>
          <button onClick={() => setYear(year + 1)} aria-label="Année suivante" className="rounded-md p-2 text-ink-3">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Mois</div>
        <div className="px-2">
          {row("all", monthIdx === null, "Toute l'année", stats(null), () => pick(null))}
          {MONTH_LONG.map((label, i) => row(label, monthIdx === i, label, stats(i), () => pick(i)))}
        </div>
      </div>
    </>,
    menu.host
  );
}

const MONTH_SHORT = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

/** Mobile : l'année (flèches + total), puis les mois en bandeau qui défile, le mois choisi centré. */
export function MobileYearMonthBar({
  year,
  onYear,
  month,
  onMonth,
  stats,
}: {
  year: number;
  onYear: (y: number) => void;
  month: number | null;
  onMonth: (m: number | null) => void;
  stats: (m: number | null) => { count: number; total: number };
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [month, year]);
  const all = stats(null);
  const chip = (key: string, active: boolean, label: string, st: { count: number; total: number }, onClick: () => void) => (
    <button
      key={key}
      data-active={active}
      onClick={onClick}
      className={`flex shrink-0 flex-col items-center rounded-btn px-3 py-1.5 ${
        active ? "bg-navy text-white" : st.count ? "bg-card text-ink-2 ring-1 ring-line" : "bg-card text-ink-4 ring-1 ring-line"
      }`}
    >
      <span className="text-xs font-bold">{label}</span>
      <span className={`font-mono text-[10px] ${active ? "text-white/80" : "text-ink-4"}`}>{st.count ? formatEuros(st.total) : "—"}</span>
    </button>
  );
  return (
    <div className="space-y-2 md:hidden">
      <div className="flex items-center justify-between rounded-btn border border-line bg-card px-1 py-1">
        <button onClick={() => onYear(year - 1)} aria-label="Année précédente" className="rounded-md p-2 text-ink-3">
          <ChevronRight size={16} className="rotate-180" />
        </button>
        <div className="text-center">
          <div className="text-base font-extrabold text-ink">{year}</div>
          <div className="font-mono text-[10px] text-ink-4">
            {all.count ? `${formatEuros(all.total)} · ${all.count} fiche${all.count > 1 ? "s" : ""}` : "Aucune fiche"}
          </div>
        </div>
        <button onClick={() => onYear(year + 1)} aria-label="Année suivante" className="rounded-md p-2 text-ink-3">
          <ChevronRight size={16} />
        </button>
      </div>
      <div ref={stripRef} className="-mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5">
        {chip("all", month === null, "Année", all, () => onMonth(null))}
        {MONTH_SHORT.map((label, i) => chip(label, month === i, label, stats(i), () => onMonth(i)))}
      </div>
    </div>
  );
}

export function GroupHeader({ label, total, count }: { label: string; total: number; count: number }) {
  return (
    <div className="flex items-center justify-between bg-subtle px-4 py-1.5 text-[11px] font-bold text-ink-3">
      <span>{label}</span>
      <span>
        {count} fiche{count > 1 ? "s" : ""} · {formatEuros(total)}
      </span>
    </div>
  );
}

export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

