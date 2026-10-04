"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Tâches longues (envoi de vidéos sur Drive, publication sur les réseaux) exécutées en arrière-plan :
 * elles vivent ici, au-dessus du board, et non dans l'écran qui les a lancées — on peut donc changer
 * de module pendant qu'elles tournent. Le panneau BackgroundTasksPanel en affiche la progression.
 * Tant qu'une tâche tourne, fermer/recharger l'onglet demande confirmation (sinon l'envoi est perdu).
 */

export type BackgroundTask = {
  id: string;
  label: string;
  detail?: string;
  /** 0 → 1 ; absent = progression indéterminée. */
  progress?: number;
  status: "running" | "done" | "error";
  message?: string;
  /** Suite à donner une fois la tâche terminée (ex. « Choisir les réseaux ») : la tâche reste affichée jusque-là. */
  action?: { label: string; run: () => void };
};

export type TaskControl = { setProgress: (progress: number | undefined, detail?: string) => void };

type RunOptions<T> = {
  /** Message affiché une fois la tâche terminée (null = message par défaut). */
  success?: (result: T) => string | null;
  /** Bouton proposé une fois la tâche terminée. */
  action?: (result: T) => { label: string; run: () => void } | null;
};

type Ctx = {
  tasks: BackgroundTask[];
  /** Incrémenté à chaque fin de tâche — les écrans s'en servent pour recharger leurs données. */
  completions: number;
  runTask: <T>(label: string, fn: (ctl: TaskControl) => Promise<T>, options?: RunOptions<T>) => Promise<T | undefined>;
  dismiss: (id: string) => void;
};

const BackgroundTasksContext = createContext<Ctx | null>(null);

const AUTO_DISMISS_MS = 10_000;

export function BackgroundTasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [completions, setCompletions] = useState(0);
  const running = useRef(0);

  const patch = useCallback((id: string, update: Partial<BackgroundTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...update } : t)));
  }, []);

  const dismiss = useCallback((id: string) => setTasks((prev) => prev.filter((t) => t.id !== id)), []);

  const runTask = useCallback<Ctx["runTask"]>(
    async (label, fn, options) => {
      const id = crypto.randomUUID();
      running.current += 1;
      setTasks((prev) => [...prev, { id, label, status: "running" }]);
      try {
        const result = await fn({ setProgress: (progress, detail) => patch(id, { progress, ...(detail !== undefined ? { detail } : {}) }) });
        const message = options?.success?.(result) ?? "Terminé.";
        const action = options?.action?.(result) ?? undefined;
        patch(id, { status: "done", progress: 1, message, action });
        if (!action) setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
        return result;
      } catch (e) {
        patch(id, { status: "error", message: e instanceof Error ? e.message : "Échec." });
        return undefined;
      } finally {
        running.current -= 1;
        setCompletions((c) => c + 1);
      }
    },
    [patch, dismiss]
  );

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (running.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const value = useMemo(() => ({ tasks, completions, runTask, dismiss }), [tasks, completions, runTask, dismiss]);
  return <BackgroundTasksContext.Provider value={value}>{children}</BackgroundTasksContext.Provider>;
}

export function useBackgroundTasks() {
  const ctx = useContext(BackgroundTasksContext);
  if (!ctx) throw new Error("useBackgroundTasks doit être utilisé sous <BackgroundTasksProvider>");
  return ctx;
}
