"use client";

import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";

/**
 * Tâches en arrière-plan (envois, publications) — coin inférieur droit, visible depuis n'importe quel
 * module ; sur mobile, au-dessus de la barre de navigation.
 */
export function BackgroundTasksPanel({ mobile }: { mobile?: boolean }) {
  const { tasks, dismiss } = useBackgroundTasks();
  if (tasks.length === 0) return null;

  return (
    <div
      className={`pointer-events-none fixed z-[90] flex flex-col gap-2 ${mobile ? "inset-x-3" : "bottom-4 right-4 w-80 max-w-[calc(100vw-2rem)]"}`}
      style={mobile ? { bottom: "calc(env(safe-area-inset-bottom) + 84px)" } : undefined}
    >
      {tasks.map((t) => (
        <div key={t.id} className="pointer-events-auto rounded-panel border border-line bg-card p-3 shadow-modal">
          <div className="flex items-start gap-2">
            {t.status === "running" ? (
              <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-link" />
            ) : t.status === "done" ? (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good" />
            ) : (
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-bad" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold text-ink">{t.label}</div>
              {t.status === "running" && t.detail && <div className="truncate text-[11px] text-ink-4">{t.detail}</div>}
              {t.status !== "running" && t.message && (
                <div className={`whitespace-pre-line text-[11px] ${t.status === "error" ? "text-bad" : "text-ink-3"}`}>{t.message}</div>
              )}
            </div>
            {t.status !== "running" && (
              <button onClick={() => dismiss(t.id)} className="shrink-0 text-ink-4 hover:text-ink" title="Fermer">
                <X size={13} />
              </button>
            )}
          </div>
          {t.status === "done" && t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              className="mt-2 w-full rounded-btn bg-red py-2.5 text-sm font-extrabold text-white shadow-btn-red"
            >
              {t.action.label}
            </button>
          )}
          {t.status === "running" && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-subtle">
              {t.progress === undefined ? (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-link" />
              ) : (
                <div className="h-full rounded-full bg-link transition-all" style={{ width: `${Math.round(t.progress * 100)}%` }} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
