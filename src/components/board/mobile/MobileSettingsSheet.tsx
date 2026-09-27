"use client";

import { useState } from "react";
import { Camera, Video, X, Ban } from "lucide-react";

export type CenterAction = "frais" | "social" | "off";

const KEY = "lgef-board:mobile-center-action";

export const CENTER_ACTIONS: { id: CenterAction; title: string; desc: string; label: string; icon: typeof Camera; bg: string }[] = [
  { id: "frais", title: "Capture de frais", desc: "Scanner un justificatif et le rattacher à un événement.", label: "Frais", icon: Camera, bg: "#E1141B" },
  { id: "social", title: "Publication réseaux", desc: "Ouvrir la caméra puis publier sur les réseaux de la Ligue.", label: "Post", icon: Video, bg: "#12305F" },
  { id: "off", title: "Bouton désactivé", desc: "Barre à quatre modules, sans bouton central.", label: "", icon: Ban, bg: "#0B1D3C" },
];

/** Action du bouton central de la barre mobile, mémorisée sur l'appareil (Capture de frais par défaut). */
export function useCenterAction(): [CenterAction, (a: CenterAction) => void] {
  const [action, setAction] = useState<CenterAction>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === "social" || v === "off" ? v : "frais";
    } catch {
      return "frais";
    }
  });
  const set = (a: CenterAction) => {
    setAction(a);
    try {
      localStorage.setItem(KEY, a);
    } catch {
      // stockage indisponible : le choix vaut pour la session
    }
  };
  return [action, set];
}

/** Feuille « Paramètres » mobile : choix du bouton central (voir handoff, mobile-06-parametres). */
export function MobileSettingsSheet({ value, onChange, onClose }: { value: CenterAction; onChange: (a: CenterAction) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[65] flex flex-col justify-end bg-[rgba(6,14,28,0.5)] backdrop-blur-[3px]" onClick={onClose}>
      <div className="rounded-t-[26px] bg-card px-4 pt-2.5" style={{ paddingBottom: "max(26px, env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3.5 h-1 w-11 rounded-full bg-ink-4/40" />
        <div className="flex items-center">
          <span className="text-base font-extrabold tracking-[-0.3px] text-ink">Paramètres</span>
          <button onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center rounded-[10px] bg-subtle text-ink-2" aria-label="Fermer">
            <X size={15} />
          </button>
        </div>
        <div className="mb-2 mt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-4">Bouton central</div>
        <div className="flex flex-col gap-2">
          {CENTER_ACTIONS.map((a) => {
            const Icon = a.icon;
            const active = value === a.id;
            return (
              <button
                key={a.id}
                onClick={() => onChange(a.id)}
                className={`flex items-center gap-3 rounded-[14px] border p-3 text-left ${active ? "border-red bg-sel-bg" : "border-line"}`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${active ? "text-white" : "bg-subtle text-ink-3"}`}
                  style={active ? { background: a.bg } : undefined}
                >
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">{a.title}</span>
                  <span className="block text-xs text-ink-3">{a.desc}</span>
                </span>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${active ? "border-red" : "border-line-strong"}`}>
                  {active && <span className="h-2.5 w-2.5 rounded-full bg-red" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
