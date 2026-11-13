"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { requestFiefPasswordReset } from "@/app/actions/fief-public";
import { FiefButton, FiefLabel, fiefInput, PublicFrame, useFiefHref } from "@/components/fief/ui";

// Connexion FIEF (e-mail + mot de passe) et « Mot de passe oublié » (lien FIEF par e-mail).

export default function FiefLoginPage() {
  const href = useFiefHref();
  const [mode, setMode] = useState<"login" | "reset" | "sent">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: err } = await createClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (err) {
      setBusy(false);
      setError(err.message.includes("Invalid") ? "E-mail ou mot de passe incorrect." : "Connexion impossible pour le moment.");
      return;
    }
    window.location.replace(href("/"));
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const r = await requestFiefPasswordReset(email);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setMode("sent");
  };

  return (
    <PublicFrame>
      {mode === "sent" ? (
        <>
          <h1 className="text-xl font-extrabold">Vérifiez vos e-mails</h1>
          <p className="mt-2 text-sm text-[#5B6B86]">
            Si un compte FIEF existe pour <strong>{email}</strong>, un lien pour choisir un nouveau mot de passe vient de vous être envoyé.
          </p>
          <FiefButton variant="outline" className="mt-5" onClick={() => setMode("login")}>
            Retour à la connexion
          </FiefButton>
        </>
      ) : (
        <form onSubmit={mode === "login" ? login : reset} className="space-y-4">
          <div>
            <h1 className="text-xl font-extrabold">{mode === "login" ? "Se connecter" : "Mot de passe oublié"}</h1>
            <p className="mt-1 text-sm text-[#5B6B86]">
              {mode === "login" ? "Accédez à votre espace FIEF." : "Indiquez votre e-mail : nous vous envoyons un lien pour choisir un nouveau mot de passe."}
            </p>
          </div>
          <label className="block">
            <FiefLabel>E-mail</FiefLabel>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fiefInput} />
          </label>
          {mode === "login" && (
            <label className="block">
              <FiefLabel>Mot de passe</FiefLabel>
              <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fiefInput} />
            </label>
          )}
          {error && <p className="rounded-xl bg-[#FDECEC] px-3 py-2 text-sm text-[#B91F26]">{error}</p>}
          <FiefButton type="submit" disabled={busy}>
            {busy ? "Un instant…" : mode === "login" ? "Se connecter" : "Recevoir le lien"}
          </FiefButton>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setError("");
                setMode(mode === "login" ? "reset" : "login");
              }}
              className="font-semibold text-[#1B3A73] hover:underline"
            >
              {mode === "login" ? "Mot de passe oublié ?" : "Retour à la connexion"}
            </button>
            <Link href={href("/adhesion")} className="font-semibold text-[#D7262E] hover:underline">
              Demander une adhésion
            </Link>
          </div>
        </form>
      )}
    </PublicFrame>
  );
}
