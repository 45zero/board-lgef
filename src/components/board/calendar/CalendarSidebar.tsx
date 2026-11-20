"use client";

import { useMemo, useState } from "react";
import { Mic, ChevronLeft, ChevronRight, PanelLeftClose, Plus } from "lucide-react";
import { format, addDays, addMonths, subMonths, endOfMonth, endOfWeek, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { CALENDAR_ORG_KEYS } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS, type OrgKey } from "@/lib/board/tokens";
import type { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import type { AccountScope } from "@/hooks/board/useCalendarDefaults";
import { BoxDefaultMenu, boxName, boxTone } from "@/components/board/mail/MailBoxes";

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];

/** Mini-calendrier + liste des calendriers (organisations) + compte Google + disponibilité — colonne gauche, comme calendrier.lgef.fr. Repliable (état contrôlé par le parent). */
export function CalendarSidebar({
  anchorDate,
  onSelectDay,
  hiddenOrgs,
  onToggleOrg,
  mineOnly,
  onToggleMine,
  plannedLabel,
  availabilityPct,
  collapsed,
  onToggleCollapsed,
  onCreateEvent,
  onVoiceEvent,
  accounts,
  googleScope,
  onGoogleScopeChange,
  googleDefaultScope,
  onGoogleDefaultChange,
}: {
  anchorDate: Date;
  onSelectDay: (d: Date) => void;
  hiddenOrgs: Set<OrgKey>;
  onToggleOrg: (key: OrgKey) => void;
  mineOnly: boolean;
  onToggleMine: () => void;
  plannedLabel: string;
  availabilityPct: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCreateEvent: () => void;
  onVoiceEvent: () => void;
  accounts: Account[] | null;
  /** Agendas Google affichés : « all » ou un compte ; clic droit = réglage par défaut. */
  googleScope: AccountScope;
  onGoogleScopeChange: (scope: AccountScope) => void;
  googleDefaultScope: AccountScope;
  onGoogleDefaultChange: (scope: AccountScope) => void;
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
    <aside className="hidden w-[240px] shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain rounded-panel border border-line bg-card p-3 transition-all duration-300 ease-in-out lg:flex [&>*]:shrink-0">
      <div className="flex items-center justify-between">
        <button
          onClick={onCreateEvent}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-btn bg-navy px-3 py-2 text-sm font-bold text-white hover:bg-navy-600"
        >
          <Plus size={15} /> Nouvel événement
        </button>
        <button
          onClick={onVoiceEvent}
          className="ml-1.5 flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-btn border border-line text-navy hover:bg-hover"
          aria-label="Créer un événement à la voix"
          title="Créer un événement à la voix"
        >
          <Mic size={15} />
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

          <button
            onClick={onToggleMine}
            className={`flex items-center justify-between gap-2 rounded-btn border px-3 py-2 text-left text-xs font-semibold ${
              mineOnly ? "border-navy bg-navy text-white" : "border-line text-ink-2 hover:bg-hover"
            }`}
            title="Afficher uniquement les événements où vous êtes sollicité (équipe, comité directeur, captation…)"
          >
            <span>{mineOnly ? "Où je suis sollicité" : "Tous les événements"}</span>
            <span className="text-[10px] font-normal opacity-80">{mineOnly ? "Voir tout" : "Filtrer"}</span>
          </button>

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

          {accounts && accounts.length === 1 && (
            <div>
              <div className="mb-2 font-mono text-[9px] tracking-[0.1em] text-ink-4 uppercase">Compte Google</div>
              <div className="truncate px-1.5 text-xs font-semibold text-ink-2" title={accounts[0].email}>
                {boxName(accounts[0])}
              </div>
            </div>
          )}
          {/* Plusieurs comptes : tous les agendas Google ensemble ou un seul ; clic droit = par défaut. */}
          {accounts && accounts.length > 1 && (
            <div>
              <div className="mb-2 font-mono text-[9px] tracking-[0.1em] text-ink-4 uppercase">Agendas Google</div>
              <BoxDefaultMenu
                accounts={accounts}
                defaultScope={googleDefaultScope}
                onSetDefault={onGoogleDefaultChange}
                title="Agendas Google affichés par défaut"
                allLabel="Tous les agendas"
                className="relative flex flex-col gap-1"
              >
                {(onContextMenu) => (
                  <>
                    {[{ id: "all", label: "Tous les agendas", color: null as string | null, email: "Tous les comptes Google" }, ...accounts.map((a) => ({ id: a.id, label: boxName(a), color: boxTone(accounts, a.id), email: a.email }))].map((o) => {
                      const active = googleScope === o.id;
                      return (
                        <button
                          key={o.id}
                          onClick={() => onGoogleScopeChange(o.id)}
                          onContextMenu={onContextMenu}
                          title={`${o.email} · clic droit : affichage par défaut`}
                          className={`flex items-center gap-2 rounded-btn px-1.5 py-1 text-left text-xs ${
                            active ? "bg-navy font-semibold text-white" : "text-ink-2 hover:bg-hover"
                          }`}
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border"
                            style={{ background: active ? (o.color ?? "#fff") : "transparent", borderColor: active ? "#fff" : (o.color ?? "currentColor") }}
                          />
                          <span className="truncate">{o.label}</span>
                        </button>
                      );
                    })}
                  </>
                )}
              </BoxDefaultMenu>
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
