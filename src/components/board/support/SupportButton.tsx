"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LifeBuoy } from "lucide-react";
import { useUserRole } from "@/hooks/board/useUserRole";
import { installSupportErrorCapture, OPEN_SUPPORT_EVENT } from "@/lib/board/supportContext";
import { SupportModal } from "./SupportModal";

/**
 * Bouée « Signaler un problème » des barres du haut (ordinateur et mobile). Ouvre le centre d'aide,
 * aussi depuis une notification (openSupport). Démarre la capture des erreurs du navigateur.
 */
export function SupportButton({ app, variant = "desktop" }: { app: string | null; variant?: "desktop" | "mobile" }) {
  const role = useUserRole();
  const [open, setOpen] = useState<{ ticketId?: string } | null>(null);

  useEffect(() => {
    installSupportErrorCapture();
    // Lien de l'e-mail de notification : /?support=<ticket>, lu une fois puis retiré de l'adresse.
    const url = new URL(window.location.href);
    if (url.searchParams.has("support")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique de l'adresse au montage
      setOpen({ ticketId: url.searchParams.get("support") || undefined });
      url.searchParams.delete("support");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    const onOpen = (e: Event) => setOpen({ ticketId: (e as CustomEvent<{ ticketId?: string }>).detail?.ticketId });
    window.addEventListener(OPEN_SUPPORT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SUPPORT_EVENT, onOpen);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen({})}
        title="Signaler un problème"
        aria-label="Signaler un problème"
        className={
          variant === "mobile"
            ? "flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/10"
            : "flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-hover"
        }
      >
        <LifeBuoy size={variant === "mobile" ? 17 : 16} />
      </button>
      {/* Hors de la barre du haut : son backdrop-blur piégerait la fenêtre (position fixed). Rendue
          dans la coque (data-theme) pour garder le thème clair / sombre. */}
      {open &&
        createPortal(
          <SupportModal key={open.ticketId ?? "new"} app={app} isStaff={role.isAdmin || role.isSuperUser} focusTicketId={open.ticketId} onClose={() => setOpen(null)} />,
          document.querySelector("[data-theme]") ?? document.body
        )}
    </>
  );
}
