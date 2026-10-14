"use client";

import { Calendar, Home, Kanban, Camera, Send, Receipt, Megaphone } from "lucide-react";
import type { ComponentType } from "react";
import { MailBrandIcon } from "@/components/board/mail/MailBrandIcon";
import type { MobileTab } from "@/components/board/mobile/MobileBottomNav";
import { canShowModule, useVisibleModules } from "@/hooks/board/useVisibleModules";

type Target = MobileTab | "frais" | "audiovisuel";

/** `module` : identifiant des droits d'accès (module_access), ex. « trello » pour l'Espace Team. */
const ITEMS: { id: Target; module: string; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: "calendrier", module: "calendrier", label: "Calendrier", icon: Calendar },
  { id: "accueil", module: "accueil", label: "Dashboard", icon: Home },
  { id: "mails", module: "mails", label: "Mails", icon: MailBrandIcon },
  { id: "team", module: "trello", label: "Espace Team", icon: Kanban },
  { id: "weekend", module: "weekend", label: "Week-end", icon: Camera },
  { id: "transfer", module: "transfer", label: "Transferts", icon: Send },
  { id: "frais", module: "frais", label: "Frais", icon: Receipt },
  { id: "audiovisuel", module: "audiovisuel", label: "Publication réseaux", icon: Megaphone },
];

/** Menu déroulé sous l'en-tête (logo) : accès aux modules qui n'ont pas de place dans la barre du bas. */
export function MobileModulesMenu({
  active,
  canPublish,
  onSelect,
  onClose,
}: {
  active: MobileTab;
  canPublish: boolean;
  onSelect: (target: Target) => void;
  onClose: () => void;
}) {
  const visible = useVisibleModules();
  const items = ITEMS.filter((i) => canShowModule(visible, i.module) && (i.id !== "audiovisuel" || canPublish));
  return (
    <>
      <div className="absolute inset-0 z-30 bg-black/30" onClick={onClose} />
      <div className="absolute inset-x-0 top-0 z-40 max-h-[80%] overflow-y-auto rounded-b-modal border-b border-line bg-card pb-3 shadow-modal">
        <div className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Modules</div>
        <div className="grid grid-cols-3 gap-2 px-3 pt-1">
          {items.map((i) => {
            const Icon = i.icon;
            const current = i.id === active;
            return (
              <button
                key={i.id}
                onClick={() => onSelect(i.id)}
                className={`flex flex-col items-center gap-1.5 rounded-btn px-2 py-3 text-xs font-semibold ${
                  current ? "bg-sel-bg text-link" : "bg-subtle text-ink-2 active:bg-hover"
                }`}
              >
                <Icon size={20} />
                {i.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
