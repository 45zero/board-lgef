// Contexte technique joint aux signalements du centre d'aide (actions/support.ts) : page, appareil,
// version déployée et dernières erreurs du navigateur. Les erreurs sont gardées en mémoire dès
// l'ouverture du board (installSupportErrorCapture, appelé par SupportButton), pour qu'un
// signalement fait après coup contienne ce qui s'est mal passé juste avant.

export type CapturedError = { at: string; kind: "error" | "promise" | "console"; message: string; stack?: string };

export type SupportContext = {
  url: string;
  userAgent: string;
  viewport: string;
  screen: string;
  language: string;
  online: boolean;
  version: string | null;
  sentAt: string;
  errors: CapturedError[];
};

const MAX_ERRORS = 15;
const errors: CapturedError[] = [];
let installed = false;

const text = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

function push(e: Omit<CapturedError, "at">) {
  errors.push({ ...e, message: e.message.slice(0, 1000), stack: e.stack?.slice(0, 2000), at: new Date().toISOString() });
  if (errors.length > MAX_ERRORS) errors.shift();
}

export function installSupportErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => push({ kind: "error", message: e.message || text(e.error), stack: e.error instanceof Error ? e.error.stack : undefined }));
  window.addEventListener("unhandledrejection", (e) => push({ kind: "promise", message: text(e.reason), stack: e.reason instanceof Error ? e.reason.stack : undefined }));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const err = args.find((a): a is Error => a instanceof Error);
    push({ kind: "console", message: args.map(text).join(" "), stack: err?.stack });
    original(...args);
  };
}

export function collectSupportContext(): SupportContext {
  return {
    url: window.location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    screen: `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x`,
    language: navigator.language,
    online: navigator.onLine,
    version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    sentAt: new Date().toISOString(),
    errors: [...errors],
  };
}

/** Ouvre le centre d'aide (sur un ticket précis : clic sur une notification). */
export const OPEN_SUPPORT_EVENT = "board:open-support";
export const openSupport = (ticketId?: string) => window.dispatchEvent(new CustomEvent(OPEN_SUPPORT_EVENT, { detail: { ticketId } }));

export const SUPPORT_STATUS: Record<string, { label: string; tone: string }> = {
  nouveau: { label: "Nouveau", tone: "bg-bad-bg text-bad" },
  en_cours: { label: "En cours", tone: "bg-warn-bg text-warn" },
  regle: { label: "Réglé", tone: "bg-good-bg text-good" },
  sans_suite: { label: "Sans suite", tone: "bg-subtle text-ink-3" },
};
