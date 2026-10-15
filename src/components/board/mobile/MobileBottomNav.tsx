"use client";

import { useRef, useState } from "react";
import { Calendar, Home, Kanban, Camera, Send } from "lucide-react";
import type { ComponentType } from "react";
import { MailBrandIcon } from "@/components/board/mail/MailBrandIcon";
import { CENTER_ACTIONS, type CenterAction } from "@/components/board/mobile/MobileSettingsSheet";
import { useAppBadges, type AppBadge } from "@/hooks/board/useAppBadges";
import { AppBadgePills } from "@/components/board/AppBadgePills";
import { canShowModule, useVisibleModules } from "@/hooks/board/useVisibleModules";

/** Écrans de la coque mobile (Week-end et Transferts s'ouvrent depuis le menu de l'en-tête). */
export type MobileTab = "calendrier" | "accueil" | "mails" | "weekend" | "team" | "transfer";

/** `module` : identifiant du module (droits d'accès, pastilles), ex. « trello » pour l'Espace Team. */
export type NavSlotDef = { id: MobileTab; module: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }> };
export const NAV_SLOTS: NavSlotDef[] = [
  { id: "calendrier", module: "calendrier", label: "Calendrier", icon: Calendar },
  { id: "accueil", module: "accueil", label: "Dashboard", icon: Home },
  { id: "mails", module: "mails", label: "Mails", icon: MailBrandIcon },
  { id: "team", module: "trello", label: "Team", icon: Kanban },
  { id: "weekend", module: "weekend", label: "Week-end", icon: Camera },
  { id: "transfer", module: "transfer", label: "Transferts", icon: Send },
];

const START_KEY = "lgef-board:mobile-start-tab";

/** Page ouverte au lancement de l'appli, choisie dans Paramètres (Calendrier par défaut), mémorisée sur l'appareil. */
export function useStartTab(): [MobileTab, (tab: MobileTab) => void] {
  const [tab, setTab] = useState<MobileTab>(() => {
    try {
      const v = localStorage.getItem(START_KEY) as MobileTab | null;
      return v && NAV_SLOTS.some((s) => s.id === v) ? v : "calendrier";
    } catch {
      return "calendrier";
    }
  });
  const set = (next: MobileTab) => {
    setTab(next);
    try {
      localStorage.setItem(START_KEY, next);
    } catch {
      // stockage indisponible : le choix vaut pour la session
    }
  };
  return [tab, set];
}

/** Modules dans la barre du bas (les autres restent dans le menu de l'en-tête). */
export const NAV_BAR_SIZE = 4;
const NAV_KEY = "lgef-board:mobile-nav-order";
const DEFAULT_ORDER: MobileTab[] = NAV_SLOTS.map((s) => s.id);

/**
 * Ordre des modules de la barre du bas, choisi par chacun dans Paramètres et mémorisé sur
 * l'appareil : les quatre premiers (accessibles) occupent la barre, de gauche à droite.
 */
export function useNavOrder(): [MobileTab[], (order: MobileTab[]) => void] {
  const [order, setOrder] = useState<MobileTab[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(NAV_KEY) ?? "null") as MobileTab[] | null;
      if (!Array.isArray(stored)) return DEFAULT_ORDER;
      const known = stored.filter((id) => DEFAULT_ORDER.includes(id));
      // Module ajouté depuis le dernier réglage : placé à la fin.
      return [...new Set([...known, ...DEFAULT_ORDER])];
    } catch {
      return DEFAULT_ORDER;
    }
  });
  const set = (next: MobileTab[]) => {
    setOrder(next);
    try {
      localStorage.setItem(NAV_KEY, JSON.stringify(next));
    } catch {
      // stockage indisponible : le choix vaut pour la session
    }
  };
  return [order, set];
}

export function MobileBottomNav({
  active,
  onSelect,
  onCenterPress,
  onCenterLongPress,
  center = "frais",
  order,
}: {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
  onCenterPress: () => void;
  /** Appui long sur le bouton central : bascule Frais / Publication réseaux. */
  onCenterLongPress?: () => void;
  /** Action du bouton central (réglable dans Paramètres) ; « off » : barre à quatre modules. */
  center?: CenterAction;
  /** Ordre choisi dans Paramètres (voir useNavOrder). */
  order: MobileTab[];
}) {
  const badges = useAppBadges();
  const visible = useVisibleModules();
  const slots = order
    .map((id) => NAV_SLOTS.find((s) => s.id === id)!)
    .filter((slot) => slot && canShowModule(visible, slot.module))
    .slice(0, NAV_BAR_SIZE);
  const half = Math.ceil(slots.length / 2);
  const action = CENTER_ACTIONS.find((a) => a.id === center) ?? CENTER_ACTIONS[0];
  const CenterIcon = action.icon;
  // Appui long (0,5 s) : l'appui court qui suit le relâchement est ignoré.
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);
  const cancelHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const startHold = () => {
    held.current = false;
    if (!onCenterLongPress) return;
    cancelHold();
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      holdTimer.current = null;
      navigator.vibrate?.(30);
      onCenterLongPress();
    }, 500);
  };
  return (
    <div
      className="relative border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      style={{ boxShadow: "0 -10px 30px rgba(11,29,60,0.10)" }}
    >
      <div className={`grid h-16 items-center px-1 ${center === "off" ? "grid-cols-4" : "grid-cols-[1fr_1fr_1.1fr_1fr_1fr]"}`}>
        {(center === "off" ? slots : slots.slice(0, half)).map((slot) => (
          <NavSlot key={slot.id} slot={slot} badges={badges[slot.module]} active={active === slot.id} onClick={() => onSelect(slot.id)} />
        ))}

        {center !== "off" && (
          <div className="flex items-center justify-center">
            <button
              onClick={() => {
                if (held.current) {
                  held.current = false;
                  return;
                }
                onCenterPress();
              }}
              onPointerDown={startHold}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={onCenterLongPress ? `${action.title} (appui long : changer de raccourci)` : action.title}
              className="flex -translate-y-4 select-none flex-col items-center justify-center gap-0.5 rounded-[22px] text-white [-webkit-touch-callout:none]"
              style={{ width: 62, height: 62, background: action.bg, boxShadow: `0 14px 28px ${center === "frais" ? "rgba(225,20,27,0.38)" : "rgba(11,29,60,0.38)"}` }}
            >
              <CenterIcon size={22} />
              <span className="font-mono text-[8px] uppercase tracking-[0.08em]">{action.label}</span>
            </button>
          </div>
        )}

        {center !== "off" && slots.slice(half).map((slot) => (
          <NavSlot key={slot.id} slot={slot} badges={badges[slot.module]} active={active === slot.id} onClick={() => onSelect(slot.id)} />
        ))}
      </div>
      <div className="mx-auto mb-1.5 h-1 w-[120px] rounded-full bg-ink-4/30" />
    </div>
  );
}

function NavSlot({
  slot,
  active,
  badges,
  onClick,
}: {
  slot: NavSlotDef;
  active: boolean;
  badges?: AppBadge[];
  onClick: () => void;
}) {
  const Icon = slot.icon;
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-0.5">
      <span className="relative">
        <Icon size={20} strokeWidth={active ? 2.2 : 1.7} className={active ? "text-navy" : "text-ink-4"} />
        <AppBadgePills badges={badges} className="absolute -right-3 -top-2" />
      </span>
      <span className={`text-[10px] font-bold ${active ? "text-navy" : "text-ink-4"}`}>{slot.label}</span>
    </button>
  );
}
