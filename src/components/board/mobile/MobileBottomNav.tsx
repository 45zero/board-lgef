"use client";

import { Calendar, Home, Mail, Kanban, Clock } from "lucide-react";

export type MobileTab = "calendrier" | "accueil" | "mails" | "trello";

const SLOTS: { id: MobileTab; label: string; icon: typeof Calendar }[] = [
  { id: "calendrier", label: "Calendrier", icon: Calendar },
  { id: "accueil", label: "Dashboard", icon: Home },
];
const SLOTS_RIGHT: { id: MobileTab; label: string; icon: typeof Calendar }[] = [
  { id: "mails", label: "Mails", icon: Mail },
  { id: "trello", label: "Trello", icon: Kanban },
];

export function MobileBottomNav({
  active,
  onSelect,
  onCenterPress,
  centerActive,
}: {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
  onCenterPress: () => void;
  centerActive: boolean;
}) {
  return (
    <div
      className="relative border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      style={{ boxShadow: "0 -10px 30px rgba(11,29,60,0.10)" }}
    >
      <div className="grid h-16 grid-cols-[1fr_1fr_1.1fr_1fr_1fr] items-center px-1">
        {SLOTS.map((slot) => (
          <NavSlot key={slot.id} slot={slot} active={active === slot.id} onClick={() => onSelect(slot.id)} />
        ))}

        <div className="flex items-center justify-center">
          <button
            onClick={onCenterPress}
            className={`flex -translate-y-4 flex-col items-center justify-center gap-0.5 rounded-[22px] shadow-btn-red transition ${
              centerActive ? "bg-red text-white" : "bg-navy text-white"
            }`}
            style={{ width: 62, height: 62 }}
          >
            <Clock size={22} />
            <span className="font-mono text-[8px] uppercase tracking-[0.08em]">
              {centerActive ? "Sortie" : "Pointer"}
            </span>
          </button>
        </div>

        {SLOTS_RIGHT.map((slot) => (
          <NavSlot key={slot.id} slot={slot} active={active === slot.id} onClick={() => onSelect(slot.id)} />
        ))}
      </div>
      <div className="mx-auto mb-1.5 h-1 w-[120px] rounded-full bg-ink-4/30" />
    </div>
  );
}

function NavSlot({
  slot,
  active,
  onClick,
}: {
  slot: { id: MobileTab; label: string; icon: typeof Calendar };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = slot.icon;
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-0.5">
      <Icon size={20} strokeWidth={active ? 2.2 : 1.7} className={active ? "text-navy" : "text-ink-4"} />
      <span className={`text-[10px] font-bold ${active ? "text-navy" : "text-ink-4"}`}>{slot.label}</span>
    </button>
  );
}
