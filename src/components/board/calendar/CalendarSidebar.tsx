"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PanelLeftClose, Plus } from "lucide-react";
import { format, addDays, addMonths, subMonths, endOfMonth, endOfWeek, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { CALENDAR_ORG_KEYS } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS, type OrgKey } from "@/lib/board/tokens";
import type { getMyConnectedAccounts } from "@/app/actions/connected-accounts";

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];

/** Mini-calendrier + liste des calendriers (organisations) + compte Google + disponibilité — colonne gauche, comme calendrier.lgef.fr. Repliable (état contrôlé par le parent). */
export function CalendarSidebar({
  anchorDate,
  onSelectDay,
  hiddenOrgs,
  onToggleOrg,
  plannedLabel,
  availabilityPct,
  collapsed,
  onToggleCollapsed,
  onCreateEvent,
  accounts,
  googleAccountId,
  onGoogleAccountChange,
}: {
  anchorDate: Date;
  onSelectDay: (d: Date) => void;
  hiddenOrgs: Set<OrgKey>;
  onToggleOrg: (key: OrgKey) => void;
  plannedLabel: string;
  availabilityPct: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCreateEvent: () => void;
  accounts: Account[] | null;
  googleAccountId: string | null;
  onGoogleAccountChange: (id: string) => void;
}) {
  const [miniMonth, setMiniMonth] = useState(anchorDate);

  const miniDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(miniMonth), { weekStartsOn: 1, locale: fr });
    const gridEnd = endOfWeek(endOfMonth(miniMonth), { weekStartsOn: 1, locale: fr });
    const days: Date[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
    return days;
  }, [miniMonth]);

  if (collapsed) return null;

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col gap-4 overflow-hidden rounded-panel border border-line bg-card p-3 transition-all duration-300 ease-in-out lg:flex">
      <div className="flex items-center justify-between">
        <button
          onClick={onCreateEvent}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-btn bg-navy px-3 py-2 text-sm font-bold text-white hover:bg-navy-600"
        >
          <Plus size={15} /> Nouvel événement
        </button>
        <button
          onClick={onToggleCollapsed}
          className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-btn text-ink-3 hover:bg-hover"
          aria-label="Replier la barre latérale"
          title="Replier"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      <>
        <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold capitalize text-ink">
                {format(miniMonth, "MMMM yyyy", { locale: fr })}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setMiniMonth((m) => subMonths(m, 1))}
                  className="flex h-6 w-6 items-center justify-center rounded-btn text-ink-3 hover:bg-hover"
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  onClick={() => setMiniMonth((m) => addMonths(m, 1))}
                  className="flex h-6 w-6 items-center justify-center rounded-btn text-ink-3 hover:bg-hover"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
                <div key={i} className="font-mono text-[9px] text-ink-4">
                  {d}
                </div>
              ))}
              {miniDays.map((day) => {
                const inMonth = isSameMonth(day, miniMonth);
                const isSelected = isSameDay(day, anchorDate);
                const isToday = isSameDay(day, new Date());
                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => {
                      onSelectDay(day);
                      setMiniMonth(day);
                    }}
                    className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                      isSelected
                        ? "bg-navy font-bold text-white"
                        : isToday
                          ? "font-bold text-red"
                          : inMonth
                            ? "text-ink-2 hover:bg-hover"
                            : "text-ink-4/50"
                    }`}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-[9px] tracking-[0.1em] text-ink-4 uppercase">Mes calendriers</div>
            <div className="flex flex-col gap-1.5">
              {CALENDAR_ORG_KEYS.map((key) => {
                const visible = !hiddenOrgs.has(key);
                const color = ORG_COLORS[key];
                return (
                  <button
                    key={key}
                    onClick={() => onToggleOrg(key)}
                    className="flex items-center gap-2 rounded-btn px-1.5 py-1 text-left hover:bg-hover"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-[3px] border"
                      style={{
                        background: visible ? color.base : "transparent",
                        borderColor: color.base,
                      }}
                    />
                    <span className={`truncate text-xs ${visible ? "text-ink-2" : "text-ink-4 line-through"}`}>
                      {ORG_LABELS[key]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {accounts && accounts.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[9px] tracking-[0.1em] text-ink-4 uppercase">Compte Google</div>
              <select
                value={googleAccountId ?? ""}
                onChange={(e) => onGoogleAccountChange(e.target.value)}
                className="w-full rounded-btn border border-line bg-card px-2 py-1.5 text-xs font-semibold text-ink-2"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || a.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-auto">
            <div className="mb-2 font-mono text-[9px] tracking-[0.1em] text-ink-4 uppercase">Disponibilité</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-track">
              <div className="h-full rounded-full bg-navy" style={{ width: `${availabilityPct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className="font-bold text-ink">{availabilityPct}%</span>
              <span className="text-ink-4">{plannedLabel} planifiées cette semaine.</span>
            </div>
          </div>
      </>
    </aside>
  );
}
