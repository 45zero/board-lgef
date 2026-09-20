"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Search, Bell, Moon, Sun, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { BoardApp } from "@/lib/board/tokens";
import type { Theme } from "./BoardShell";

function useCurrentProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<{ firstName: string; lastName: string } | null>(null);

  useEffect(() => {
    if (!user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on logout, no async fetch involved
      setProfile(null);
      return;
    }
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        setProfile({ firstName: data?.first_name ?? "", lastName: data?.last_name ?? "" });
      });
  }, [user?.id]);

  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || user?.email || "";
  const initials =
    [profile?.firstName?.[0], profile?.lastName?.[0]].filter(Boolean).join("").toUpperCase() ||
    name.slice(0, 2).toUpperCase();

  return { name, initials };
}

export function TopBar({
  currentApp,
  theme,
  onToggleTheme,
}: {
  currentApp: BoardApp;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const { name, initials } = useCurrentProfile();

  return (
    <header className="mx-4 mt-4 flex h-[62px] items-center gap-4 rounded-btn border border-line bg-card/80 px-4 shadow-bar backdrop-blur">
      <div className="flex items-center gap-2">
        <Image src="/lgef-logo.png" alt="Ligue Grand Est de Football" width={34} height={34} className="rounded-lg" />

        <div className="leading-tight">
          <div className="text-sm font-extrabold text-ink">Board LGEF</div>
          <div className="font-mono text-[9px] tracking-[0.12em] text-ink-4 uppercase">
            Espace de travail
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-full border border-line bg-subtle px-2.5 py-1 text-xs font-semibold text-ink-2">
        <span className="h-1.5 w-1.5 rounded-full bg-good" />
        {currentApp.label}
        <ChevronRight size={11} className="text-ink-4" />
        <span className="text-ink-3">{currentApp.kicker}</span>
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

      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red text-xs font-bold text-white">
          {initials || "?"}
        </div>
        {name && <span className="hidden text-sm font-semibold text-ink-2 lg:inline">{name}</span>}
      </div>
    </header>
  );
}
