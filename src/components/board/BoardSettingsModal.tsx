"use client";

import { Sparkles, X, PanelLeft, LayoutGrid } from "lucide-react";
import type { BoardPreferences, NavStyle, ContextPanelWidgets } from "@/hooks/board/useBoardPreferences";
import { useNotificationPreferences } from "@/hooks/board/useNotificationPreferences";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-red" : "bg-track"}`}
      role="switch"
      aria-checked={on}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-transform ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

const WIDGET_ROWS: { key: keyof ContextPanelWidgets; title: string; subtitle: string }[] = [
  { key: "today", title: "Aujourd'hui", subtitle: "Vos réunions du jour" },
  { key: "trello", title: "Mes cartes Trello", subtitle: "Cartes assignées à échéance proche" },
  { key: "activity", title: "Activité du Board", subtitle: "Flux inter-applications" },
  { key: "migration", title: "Avancement migration", subtitle: "Applications déjà intégrées" },
];

export function BoardSettingsModal({
  prefs,
  onUpdate,
  onUpdateWidgets,
  onClose,
}: {
  prefs: BoardPreferences;
  onUpdate: (partial: Partial<BoardPreferences>) => void;
  onUpdateWidgets: (partial: Partial<ContextPanelWidgets>) => void;
  onClose: () => void;
}) {
  const setNavStyle = (v: NavStyle) => onUpdate({ navStyle: v });
  const notif = useNotificationPreferences();

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-4 top-[76px] z-50 w-[380px] max-w-[calc(100vw-32px)] rounded-panel border border-line bg-card p-5 shadow-modal">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-gradient-to-br from-navy to-red text-white">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="text-sm font-extrabold text-ink">Paramètres du Board</div>
              <div className="text-xs text-ink-4">Propres à votre compte</div>
            </div>
          </div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
            Navigation des applications
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setNavStyle("rail")}
              className={`flex w-full items-center gap-3 rounded-btn border-2 px-3 py-2.5 text-left ${
                prefs.navStyle === "rail" ? "border-red" : "border-line"
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-subtle text-ink-2">
                <PanelLeft size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">Rail latéral</span>
                <span className="block text-xs text-ink-4">Icônes à gauche, sections en pastilles</span>
              </span>
              {prefs.navStyle === "rail" && <span className="shrink-0 text-red">✓</span>}
            </button>
            <button
              onClick={() => setNavStyle("dock")}
              className={`flex w-full items-center gap-3 rounded-btn border-2 px-3 py-2.5 text-left ${
                prefs.navStyle === "dock" ? "border-red" : "border-line"
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-subtle text-ink-2">
                <LayoutGrid size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">Dock en bas</span>
                <span className="block text-xs text-ink-4">Grandes icônes en bas de l&rsquo;écran</span>
              </span>
              {prefs.navStyle === "dock" && <span className="shrink-0 text-red">✓</span>}
            </button>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">Notifications</div>
          <div className="space-y-3 rounded-btn border border-line p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-2">Notifications par e-mail</div>
                <div className="text-xs text-ink-4">Rappels et demandes envoyés aussi par e-mail</div>
              </div>
              <Toggle on={notif.notifyEmail} onClick={() => notif.setNotifyEmail(!notif.notifyEmail)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-2">Notifications push</div>
                <div className="text-xs text-ink-4">
                  Bientôt disponible — préparé pour la future application mobile
                </div>
              </div>
              <Toggle on={notif.notifyPush} onClick={() => notif.setNotifyPush(!notif.notifyPush)} />
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">Récapitulatif</div>
            <button
              onClick={() => onUpdate({ contextPanelOpen: !prefs.contextPanelOpen })}
              className="text-xs font-semibold text-link hover:underline"
            >
              {prefs.contextPanelOpen ? "Masquer la colonne" : "Afficher la colonne"}
            </button>
          </div>
          <div className="space-y-3 rounded-btn border border-line p-3">
            {WIDGET_ROWS.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink-2">{row.title}</div>
                  <div className="text-xs text-ink-4">{row.subtitle}</div>
                </div>
                <Toggle
                  on={prefs.contextPanelWidgets[row.key]}
                  onClick={() => onUpdateWidgets({ [row.key]: !prefs.contextPanelWidgets[row.key] })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
