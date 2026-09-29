"use client";

import { Calendar, Home, Mail, Camera } from "lucide-react";
import { CENTER_ACTIONS, type CenterAction } from "@/components/board/mobile/MobileSettingsSheet";
import { useAppBadges, type AppBadge } from "@/hooks/board/useAppBadges";
import { AppBadgePills } from "@/components/board/AppBadgePills";

export type MobileTab = "calendrier" | "accueil" | "mails" | "weekend";

const SLOTS: { id: MobileTab; label: string; icon: typeof Calendar }[] = [
  { id: "calendrier", label: "Calendrier", icon: Calendar },
  { id: "accueil", label: "Dashboard", icon: Home },
];
const SLOTS_RIGHT: { id: MobileTab; label: string; icon: typeof Calendar }[] = [
  { id: "mails", label: "Mails", icon: Mail },
  { id: "weekend", label: "Week-end", icon: Camera },
];

export function MobileBottomNav({
  active,
  onSelect,
  onCenterPress,
  center = "frais",
}: {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
  onCenterPress: () => void;
  /** Action du bouton central (réglable dans Paramètres) ; « off » : barre à quatre modules. */
  center?: CenterAction;
}) {
  const badges = useAppBadges();
  const action = CENTER_ACTIONS.find((a) => a.id === center) ?? CENTER_ACTIONS[0];
  const CenterIcon = action.icon;
  return (
    <div
      className="relative border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      style={{ boxShadow: "0 -10px 30px rgba(11,29,60,0.10)" }}
    >
      <div className={`grid h-16 items-center px-1 ${center === "off" ? "grid-cols-4" : "grid-cols-[1fr_1fr_1.1fr_1fr_1fr]"}`}>
        {SLOTS.map((slot) => (
          <NavSlot key={slot.id} slot={slot} badges={badges[slot.id]} active={active === slot.id} onClick={() => onSelect(slot.id)} />
        ))}

        {center !== "off" && (
          <div className="flex items-center justify-center">
            <button
              onClick={onCenterPress}
              aria-label={action.title}
              className="flex -translate-y-4 flex-col items-center justify-center gap-0.5 rounded-[22px] text-white"
              style={{ width: 62, height: 62, background: action.bg, boxShadow: `0 14px 28px ${center === "frais" ? "rgba(225,20,27,0.38)" : "rgba(11,29,60,0.38)"}` }}
            >
              <CenterIcon size={22} />
              <span className="font-mono text-[8px] uppercase tracking-[0.08em]">{action.label}</span>
            </button>
          </div>
        )}

        {SLOTS_RIGHT.map((slot) => (
          <NavSlot key={slot.id} slot={slot} badges={badges[slot.id]} active={active === slot.id} onClick={() => onSelect(slot.id)} />
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
  slot: { id: MobileTab; label: string; icon: typeof Calendar };
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
