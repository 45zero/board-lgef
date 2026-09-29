"use client";

import { useState } from "react";
import Link from "next/link";
import { submitAccessRequest, type AccessKind } from "@/app/actions/account-requests";

const field = "w-full rounded-btn border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-line-strong";
const label = "mb-1 block text-xs font-semibold text-ink-2";

const KINDS: { id: AccessKind; label: string }[] = [
  { id: "salarie", label: "Salarié" },
  { id: "arbitre", label: "Arbitre" },
  { id: "photographe", label: "Photographe" },
  { id: "videaste", label: "Vidéaste" },
  { id: "partenaire", label: "Partenaire" },
  { id: "media", label: "Média" },
  { id: "autre", label: "Autre" },
];

/** Demande d'accès publique (photographes, vidéastes… extérieurs à la Ligue) — validée par un administrateur. */
export default function AccessRequestPage() {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", organization: "", kind: "photographe" as AccessKind, reason: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await submitAccessRequest(form).catch(() => ({ ok: false as const, error: "La demande n'a pas pu être envoyée. Réessayez plus tard." }));
    setSubmitting(false);
    if (res.ok) setDone(true);
    else setError(res.error);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell p-6">
      <div className="w-full max-w-[460px] rounded-panel border border-line bg-card p-8 shadow-card">
        <div className="font-mono text-[10px] tracking-[0.12em] text-ink-4 uppercase">Board LGEF</div>
        {done ? (
          <>
            <h1 className="mt-2 text-xl font-extrabold text-ink">Demande envoyée</h1>
            <p className="mt-2 text-sm text-ink-3">
              Merci {form.firstName}. Votre demande sera examinée par la Ligue ; vous recevrez un e-mail à <strong>{form.email}</strong> avec le lien
              pour choisir votre mot de passe dès qu&apos;elle sera acceptée.
            </p>
            <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-link hover:underline">
              Retour à la connexion
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 className="mt-2 text-xl font-extrabold text-ink">Demander un accès</h1>
            <p className="mt-1 text-sm text-ink-3">Salariés, arbitres, photographes, vidéastes, partenaires, médias… Votre demande est examinée par la Ligue Grand Est de Football.</p>

            <div className="mt-6 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="firstName" className={label}>Prénom</label>
                  <input id="firstName" required autoComplete="given-name" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className={field} />
                </div>
                <div>
                  <label htmlFor="lastName" className={label}>Nom</label>
                  <input id="lastName" required autoComplete="family-name" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className={field} />
                </div>
              </div>
              <div>
                <label htmlFor="email" className={label}>E-mail</label>
                <input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="phone" className={label}>Téléphone</label>
                <input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={field} />
              </div>
              <div>
                <span className={label}>Vous êtes</span>
                <div className="flex flex-wrap gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => set("kind", k.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${form.kind === k.id ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"}`}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="organization" className={label}>Club ou structure (facultatif)</label>
                <input id="organization" value={form.organization} onChange={(e) => set("organization", e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="reason" className={label}>Pourquoi souhaitez-vous un accès ?</label>
                <textarea
                  id="reason"
                  required
                  rows={4}
                  value={form.reason}
                  onChange={(e) => set("reason", e.target.value)}
                  className={field}
                  placeholder="Ex. : photographe dans le Bas-Rhin, je couvre déjà des matchs pour la Ligue…"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-xs font-semibold text-bad">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 w-full rounded-btn bg-red px-4 py-3 text-sm font-bold text-white shadow-btn-red transition hover:bg-red-700 disabled:opacity-60"
            >
              {submitting ? "Envoi…" : "Envoyer ma demande"}
            </button>
            <Link href="/login" className="mt-4 block text-center text-xs font-semibold text-ink-3 hover:underline">
              J&apos;ai déjà un compte
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
