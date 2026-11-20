"use client";

import { useEffect, useState } from "react";
import { UserRound, X } from "lucide-react";
import { getMyProfile } from "@/app/actions/profile";
import { MyProfileModal } from "@/components/board/profile/MyProfileModal";

// « Plus tard » vaut pour la session du navigateur : la fenêtre revient à la prochaine ouverture du board.
const LATER_KEY = "board-lgef:profile-completion-later";

const laterThisSession = () => {
  try {
    return window.sessionStorage.getItem(LATER_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Au lancement du board : un salarié sans N+1 est invité à le renseigner, et toute personne qui a
 * droit aux indemnités kilométriques sans adresse à indiquer son domicile et son véhicule de fonction.
 * « Renseigner maintenant » ouvre Mon profil ; « Plus tard » remet à la prochaine ouverture.
 */
export function ProfileCompletionPrompt() {
  const [need, setNeed] = useState<{ manager: boolean; address: boolean } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    if (laterThisSession()) return;
    let cancelled = false;
    // Laisse le board s'afficher d'abord.
    const timer = window.setTimeout(() => {
      getMyProfile()
        .then((r) => {
          if (cancelled || !r.ok) return;
          const manager = !!r.data.needsManager;
          const address = !!r.data.needsAddress;
          if (manager || address) setNeed({ manager, address });
        })
        .catch(() => undefined);
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const later = () => {
    try {
      window.sessionStorage.setItem(LATER_KEY, "1");
    } catch {
      // Stockage indisponible (navigation privée) : la fenêtre se ferme simplement.
    }
    setNeed(null);
  };

  if (profileOpen) {
    return (
      <MyProfileModal
        onClose={() => {
          setProfileOpen(false);
          later();
        }}
      />
    );
  }
  if (!need) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={later}>
      <div className="w-full max-w-md overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div className="flex items-center gap-2">
            <UserRound size={18} />
            <h3 className="text-base font-extrabold">{need.manager ? "Veuillez renseigner votre N+1" : "Complétez votre profil"}</h3>
          </div>
          <button onClick={later} className="rounded-full p-1 text-white/80 hover:bg-white/10" aria-label="Plus tard">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-2 p-5 text-sm text-ink-2">
          {need.manager && <p>Votre N+1 valide vos frais, factures et pointages. Choisissez votre service ou la personne concernée.</p>}
          {need.address && (
            <p>
              Indiquez {need.manager ? "aussi " : ""}l&apos;adresse de votre domicile et si vous avez un véhicule de fonction : vos indemnités kilométriques
              (0,45 €/km aller-retour) seront calculées automatiquement dans vos frais.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={later} className="rounded-btn px-3 py-2 text-sm font-semibold text-ink-3 hover:bg-hover">
            Plus tard
          </button>
          <button onClick={() => setProfileOpen(true)} className="rounded-btn bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-600">
            Renseigner maintenant
          </button>
        </div>
      </div>
    </div>
  );
}
