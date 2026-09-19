"use client";

import { Bell, Settings } from "lucide-react";

export function MobileHeader({ title, kicker }: { title: string; kicker: string }) {
  return (
    <div
      className="flex items-center justify-between px-4 pb-4 pt-[calc(env(safe-area-inset-top)+12px)] text-white"
      style={{ background: "linear-gradient(160deg, var(--navy) 0%, var(--navy-500) 100%)" }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-btn bg-white/15 text-xs font-extrabold">
          LG
        </div>
        <div>
          <div className="text-[15px] font-extrabold leading-tight">{title}</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">{kicker}</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button className="flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/10" aria-label="Paramètres">
          <Settings size={17} />
        </button>
        <button className="relative flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/10" aria-label="Notifications">
          <Bell size={17} />
          <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red text-[8px] font-bold text-white">
            9+
          </span>
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red text-xs font-bold text-white">
          GV
        </div>
      </div>
    </div>
  );
}
