"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FiefButton, FiefLabel, fiefInput, PublicFrame, useFiefHref } from "@/components/fief/ui";

// Lien reçu par e-mail (bienvenue après validation, ou mot de passe oublié) : `token_hash` + `type`
// ouvrent la session, puis la membre choisit son mot de passe.

function SetPassword() {
  const href = useFiefHref();
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const type = params.get("type") === "recovery" ? "recovery" : "invite";
  const [verifiedState, setVerifiedState] = useState<"verifying" | "ready" | "invalid">("verifying");
  const status = tokenHash ? verifiedState : "invalid";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Lien à usage unique : une seule vérification, même si l'effet est rejoué (mode strict).
  const verified = useRef<string | null>(null);
  useEffect(() => {
    if (!tokenHash || verified.current === tokenHash) return;
    verified.current = tokenHash;
    createClient()
      .auth.verifyOtp({ token_hash: tokenHash, type })
      .then(({ error: e }) => setVerifiedState(e ? "invalid" : "ready"));
  }, [tokenHash, type]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("8 caractères minimum.");
    if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
    setSaving(true);
    const { error: err } = await createClient().auth.updateUser({ password });
    if (err) {
      setSaving(false);
      return setError(err.message.includes("different") ? "Choisissez un mot de passe différent de l'ancien." : "Enregistrement impossible. Réessayez.");
    }
    window.location.replace(href("/"));
  };

  if (status === "verifying") return <p className="text-center text-sm text-f-muted">Vérification du lien…</p>;
  if (status === "invalid")
    return (
      <>
        <h1 className="text-xl font-extrabold">Lien expiré</h1>
        <p className="mt-2 text-sm text-f-muted">Ce lien n&apos;est plus valable (il ne sert qu&apos;une fois). Demandez-en un nouveau depuis la page de connexion.</p>
        <a href={href("/connexion")} className="mt-5 flex w-full items-center justify-center rounded-xl bg-f-accent px-4 py-3 text-[15px] font-bold text-white">
          Aller à la connexion
        </a>
      </>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold">{type === "invite" ? "Bienvenue sur FIEF !" : "Nouveau mot de passe"}</h1>
        <p className="mt-1 text-sm text-f-muted">Choisissez votre mot de passe (8 caractères minimum).</p>
      </div>
      <label className="block">
        <FiefLabel>Mot de passe</FiefLabel>
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fiefInput} />
      </label>
      <label className="block">
        <FiefLabel>Confirmer</FiefLabel>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={fiefInput} />
      </label>
      {error && <p className="rounded-xl bg-f-danger-bg px-3 py-2 text-sm text-f-danger">{error}</p>}
      <FiefButton type="submit" disabled={saving}>
        {saving ? "Enregistrement…" : "Enregistrer et entrer"}
      </FiefButton>
    </form>
  );
}

export default function FiefPasswordPage() {
  return (
    <PublicFrame>
      <Suspense fallback={null}>
        <SetPassword />
      </Suspense>
    </PublicFrame>
  );
}
