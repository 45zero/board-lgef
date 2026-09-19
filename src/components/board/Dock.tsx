"use client";

import { Home, Mail, Kanban, Calendar, Gamepad2, Clock } from "lucide-react";
import type { ComponentType } from "react";

const PINNED = ["accueil", "mails", "trello", "calendrier", "quiz", "pointage"];

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  accueil: Home,
  mails: Mail,
  trello: Kanban,
  calendrier: Calendar,
  quiz: Gamepad2,
  pointage: Clock,
};

export function Dock({
  activeApp,
  onSelectApp,
}: {
  activeApp: string;
  onSelectApp: (id: string) => void;
}) {
  return (
    <div className="mx-4 mb-4 flex items-center justify-center gap-2 rounded-btn border border-line bg-card/80 px-3 py-2 shadow-bar backdrop-blur">
      {PINNED.map((id) => {
        const Icon = ICONS[id] ?? Home;
        const isActive = id === activeApp;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelectApp(id)}
            className={`flex h-10 w-10 items-center justify-center rounded-btn transition-colors ${
              isActive ? "bg-navy text-white" : "text-ink-2 hover:bg-hover"
            }`}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </div>
  );
}
