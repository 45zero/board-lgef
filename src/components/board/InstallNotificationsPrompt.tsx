"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { isNativeApp, webPushIssue, isWebPushEnabled, enableWebPush } from "@/lib/web/webPush";
import { sendTestWebPush } from "@/app/actions/web-push";

const DISMISS_KEY = "board-lgef:install-notif-prompt";

/** Board ouvert comme appli installée (Safari > Ajouter au Dock, Chrome/Edge > Installer, écran d'accueil). */
function isInstalledApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const dismissed = () => {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * À l'installation du board (première ouverture en appli), propose d'autoriser les notifications sur
 * cet ordinateur. Bouton obligatoire : Safari n'accepte la demande d'autorisation qu'après un clic.
 * « Plus tard » est mémorisé sur l'appareil ; le réglage reste dans Paramètres > Notifications.
 */
export function InstallNotificationsPrompt({ mobile = false }: { mobile?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isNativeApp() || webPushIssue() !== null || !isInstalledApp() || dismissed()) return;
    if (Notification.permission === "denied") return;
    let cancelled = false;
    isWebPushEnabled()
      .then((enabled) => {
        if (!cancelled && !enabled) setVisible(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  const close = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // stockage indisponible : la proposition reviendra au prochain lancement
    }
    setVisible(false);
  };

  const allow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enableWebPush();
      if (result === "ok") {
        await sendTestWebPush().catch(() => false);
        setVisible(false);
      } else if (result === "denied") {
        setMessage("Refusé : réactivez-les dans Réglages Système › Notifications.");
      }
    } catch (e) {
      setMessage(`Activation impossible : ${e instanceof Error ? e.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`fixed z-[95] rounded-panel border border-line bg-card p-3 shadow-modal ${
        mobile ? "inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)]" : "bottom-4 left-4 w-80 max-w-[calc(100vw-2rem)]"
      }`}
      role="dialog"
      aria-label="Activer les notifications"
    >
      <div className="flex items-start gap-2.5">
        <Bell size={18} className="mt-0.5 shrink-0 text-red" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-ink">Activer les notifications ?</div>
          <div className="mt-0.5 text-xs text-ink-4">
            {message ?? "Rappels, mails et Espace Team sur cet ordinateur, même board fermé."}
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={allow}
              disabled={busy}
              className="rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              Autoriser
            </button>
            <button type="button" onClick={close} className="rounded-btn px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-panel">
              Plus tard
            </button>
          </div>
        </div>
        <button type="button" onClick={close} aria-label="Fermer" className="shrink-0 text-ink-4 hover:text-ink">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
