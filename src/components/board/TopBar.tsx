"use client";

import { Search, Bell, Moon, Sun } from "lucide-react";
import type { BoardApp } from "@/lib/board/tokens";
import type { Theme } from "./BoardShell";

export function TopBar({
  currentApp,
  theme,
  onToggleTheme,
}: {
  currentApp: BoardApp;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  return (
    <header className="mx-4 mt-4 flex h-[62px] items-center gap-4 rounded-btn border border-line bg-card/80 px-4 shadow-bar backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-navy text-sm font-extrabold text-white">
          LG
        </div>
        <div className="leading-tight">
          <div className="text-sm font-extrabold text-ink">{currentApp.label}</div>
          <div className="font-mono text-[9px] tracking-[0.12em] text-ink-4 uppercase">
            {currentApp.kicker}
          </div>
        </div>
      </div>

      <div className="ml-2 flex flex-1 items-center gap-2 rounded-btn border border-line bg-subtle px-3 py-2 text-ink-3">
        <Search size={16} />
        <input
          placeholder="Rechercher, créer, lancer une commande..."
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-4"
        />
        <kbd className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-ink-4">
          ⌘K
        </kbd>
      </div>

      <button
        type="button"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-hover"
        aria-label="Notifications"
      >
        <Bell size={17} />
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold text-white ring-2 ring-card">
          5
        </span>
      </button>

      <button
        type="button"
        onClick={onToggleTheme}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-hover"
        aria-label="Changer de thème"
      >
        {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
      </button>

      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red text-xs font-bold text-white">
        GV
      </div>
    </header>
  );
}
