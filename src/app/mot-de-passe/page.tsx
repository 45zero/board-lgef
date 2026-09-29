"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const field = "w-full rounded-btn border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-line-strong";

/**
 * Lien reçu par e-mail après acceptation d'une demande d'accès (voir approveAccessRequest) :
 * `token_hash` + `type` (invite ou recovery) ouvrent la session, puis on choisit son mot de passe.
 */
function SetPassword() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const [verified, setVerified] = useState<"verifying" | "ready" | "invalid">("verifying");
  const status = tokenHash ? verified : "invalid";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const type = params.get("type") === "recovery" ? "recovery" : "invite";
  // Lien à usage unique : une seule vérification, même si l'effet est rejoué (mode strict).
  const verifiedToken = useRef<string | null>(null);
  useEffect(() => {
    if (!tokenHash || verifiedToken.current === tokenHash) return;
    verifiedToken.current = tokenHash;
    createClient()
      .auth.verifyOtp({ token_hash: tokenHash, type })
      .then(({ error: e }) => setVerified(e ? "invalid" : "ready"));
  }, [tokenHash, type]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("8 caractères minimum.");
    if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
    setSaving(true);
    const { error: e2 } = await createClient().auth.updateUser({ password });
    setSaving(false);
    if (e2) return setError(e2.message);
    router.replace("/");
  };

  return (
    <div className="w-full max-w-[380px] rounded-panel border border-line bg-card p-8 shadow-card">
      <div className="font-mono text-[10px] tracking-[0.12em] text-ink-4 uppercase">Board LGEF</div>
      <h1 className="mt-2 text-xl font-extrabold text-ink">Choisir mon mot de passe</h1>
      {status === "verifying" && <p className="mt-2 text-sm text-ink-3">Vérification du lien…</p>}
      {status === "invalid" && (
        <p className="mt-2 text-sm text-ink-3">
          Ce lien n&apos;est plus valide (déjà utilisé ou expiré). Demandez à la Ligue de vous renvoyer une invitation.
        </p>
      )}
      {status === "ready" && (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nouveau mot de passe" className={field} />
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirmer" className={field} />
          {error && <p className="text-xs font-semibold text-bad">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-btn bg-red px-4 py-3 text-sm font-bold text-white shadow-btn-red transition hover:bg-red-700 disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Enregistrer et accéder au board"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-shell p-6">
      <Suspense>
        <SetPassword />
      </Suspense>
    </div>
  );
}
