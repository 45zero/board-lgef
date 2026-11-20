"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ExternalLink, X } from "lucide-react";
import { connectMyIcloudAccount } from "@/app/actions/connected-accounts";

/**
 * « Ajouter un compte » : Google (connexion Google habituelle) ou iCloud (adresse + mot de passe
 * pour app, Mail et / ou Agenda). Apple ne propose pas de connexion OAuth pour le mail et l'agenda.
 */
export function AddAccountModal({
  onClose,
  onConnected,
  initial = "choice",
  defaults = { mail: true, calendar: true },
}: {
  onClose: () => void;
  /** Compte iCloud enregistré : l'écran recharge ses comptes. */
  onConnected?: () => void;
  initial?: "choice" | "icloud";
  defaults?: { mail: boolean; calendar: boolean };
}) {
  const [step, setStep] = useState<"choice" | "icloud">(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mail, setMail] = useState(defaults.mail);
  const [calendar, setCalendar] = useState(defaults.calendar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await connectMyIcloudAccount({ email, password, mail, calendar });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onConnected?.();
      onClose();
    } catch {
      setError("La connexion a échoué. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[22px] bg-card p-5 shadow-modal sm:rounded-modal"
        style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          {step === "icloud" && initial === "choice" && (
            <button onClick={() => setStep("choice")} className="rounded-full p-1 text-ink-4 hover:bg-hover" aria-label="Retour">
              <ChevronLeft size={18} />
            </button>
          )}
          <h3 className="flex-1 text-base font-bold text-ink">{step === "choice" ? "Ajouter un compte" : "Connecter un compte iCloud"}</h3>
          <button onClick={onClose} className="rounded-full p-1 text-ink-4 hover:bg-hover" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        {step === "choice" ? (
          <div className="space-y-2">
            <a href="/api/oauth/google/start" className="flex items-center gap-3 rounded-card border border-line p-3 hover:bg-hover">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-subtle text-base font-extrabold text-[#4285F4]">G</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">Google</span>
                <span className="block text-xs text-ink-3">Gmail et Google Agenda</span>
              </span>
            </a>
            <button onClick={() => setStep("icloud")} className="flex w-full items-center gap-3 rounded-card border border-line p-3 text-left hover:bg-hover">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-subtle text-base font-extrabold text-[#3693F3]">i</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">iCloud</span>
                <span className="block text-xs text-ink-3">Mail iCloud et / ou Calendrier iCloud</span>
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-btn bg-subtle p-3 text-xs leading-relaxed text-ink-2">
              Apple ne permet pas de se connecter avec son mot de passe habituel. Créez un <b>mot de passe pour app</b> :
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                <li>
                  Ouvrez{" "}
                  <a href="https://account.apple.com/account/manage" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-link hover:underline">
                    account.apple.com <ExternalLink size={10} />
                  </a>{" "}
                  et connectez-vous.
                </li>
                <li>Connexion et sécurité → Mots de passe pour app → +.</li>
                <li>Nommez-le « Board LGEF », puis copiez le code (xxxx-xxxx-xxxx-xxxx).</li>
              </ol>
              <span className="mt-1.5 block text-ink-4">La double authentification doit être activée sur l&rsquo;identifiant Apple.</span>
            </div>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Adresse iCloud (ex. prenom@icloud.com)"
              className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-navy"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe pour app"
              className="w-full rounded-btn border border-line bg-card px-3 py-2 font-mono text-sm outline-none focus:border-navy"
            />
            <div className="flex gap-4 text-sm text-ink-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /> Mail
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={calendar} onChange={(e) => setCalendar(e.target.checked)} /> Agenda
              </label>
            </div>
            {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-xs font-semibold text-bad">{error}</p>}
            <button
              onClick={() => void submit()}
              disabled={busy || !email.trim() || !password.trim() || (!mail && !calendar)}
              className="w-full rounded-btn bg-navy px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-600 disabled:opacity-50"
            >
              {busy ? "Vérification auprès d'Apple…" : "Connecter"}
            </button>
            <p className="text-[11px] leading-snug text-ink-4">
              Le mot de passe pour app est chiffré et ne sert qu&rsquo;à lire et envoyer vos mails et à gérer votre agenda depuis le board. Vous pouvez le révoquer à tout moment sur account.apple.com.
            </p>
          </div>
        )}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(modal, document.body);
}
