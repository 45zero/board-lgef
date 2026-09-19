"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const supabase = createClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInErr) {
      setError("Identifiants invalides.");
      setSubmitting(false);
      return;
    }

    router.push("/");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[380px] rounded-panel border border-line bg-card p-8 shadow-card"
      >
        <div className="font-mono text-[10px] tracking-[0.12em] text-ink-4 uppercase">
          Board LGEF
        </div>
        <h1 className="mt-2 text-xl font-extrabold text-ink">Connexion</h1>
        <p className="mt-1 text-sm text-ink-3">
          Utilisez vos identifiants habituels de la Ligue Grand Est de Football.
        </p>

        <div className="mt-6 space-y-3">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-semibold text-ink-2">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-btn border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-line-strong"
              placeholder="prenom.nom@lgef.fr"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-semibold text-ink-2">
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-btn border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-line-strong"
              placeholder="••••••••"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs font-semibold text-bad">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-btn bg-red px-4 py-3 text-sm font-bold text-white shadow-btn-red transition hover:bg-red-700 disabled:opacity-60"
        >
          {submitting ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
