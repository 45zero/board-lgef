"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MapPin, Search, X } from "lucide-react";
import { getFiefSignupConfig, searchFiefClubs, submitFiefApplication } from "@/app/actions/fief-public";
import { eligibility, type FiefClub, type FiefFunction, type FiefSettings } from "@/lib/fief/shared";
import { FiefButton, FiefLabel, fiefInput, PublicFrame, useFiefHref } from "@/components/fief/ui";

// Demande d'adhésion FIEF : identité, club (liste des clubs du board), fonctions, charte ; accord
// parental si l'âge l'exige (réglages de l'équipe FIEF). La demande part ensuite à Claire.

export default function FiefApplyPage() {
  const href = useFiefHref();
  const [config, setConfig] = useState<{ settings: FiefSettings; functions: FiefFunction[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [done, setDone] = useState<null | { awaitingParent: boolean }>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [club, setClub] = useState<{ clubNumber: string | null; clubName: string } | null>(null);
  const [noClub, setNoClub] = useState(false);
  const [functions, setFunctions] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [charter, setCharter] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFiefSignupConfig().then((r) => (r.ok ? setConfig(r.data) : setLoadError(r.error)));
  }, []);

  const elig = useMemo(() => (config && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? eligibility(birthDate, config.settings) : null), [config, birthDate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (elig && !elig.ok) return setError(elig.reason);
    if (!charter) return setError("Merci d'accepter la charte FIEF.");
    setBusy(true);
    const r = await submitFiefApplication({
      firstName,
      lastName,
      email,
      phone,
      birthDate,
      club,
      noClub,
      functions,
      message,
      parentName,
      parentEmail,
      charter: true,
      website,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (done)
    return (
      <PublicFrame>
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#E6F4EC] text-[#1F7A4D]">
          <Check size={30} strokeWidth={3} />
        </span>
        <h1 className="text-center text-xl font-extrabold">Demande envoyée !</h1>
        <p className="mt-2 text-center text-sm text-[#5B6B86]">
          {done.awaitingParent
            ? "Nous avons envoyé un e-mail à votre parent ou responsable légal. Dès qu'il aura donné son accord, l'équipe FIEF examinera votre demande et vous répondra par e-mail."
            : "L'équipe FIEF de la Ligue va examiner votre demande. Vous recevrez un e-mail dès qu'elle sera acceptée, avec le lien pour choisir votre mot de passe."}
        </p>
        <Link href={href("/")} className="mt-6 flex w-full items-center justify-center rounded-xl border-2 border-[#0E2754] px-4 py-3 text-[15px] font-bold text-[#0E2754]">
          Retour à l&apos;accueil
        </Link>
      </PublicFrame>
    );

  return (
    <PublicFrame wide>
      <h1 className="text-2xl font-extrabold">Demander une adhésion</h1>
      <p className="mt-1 text-sm text-[#5B6B86]">
        FIEF réunit les femmes engagées dans le football du Grand Est : joueuses, dirigeantes, éducatrices, arbitres, bénévoles… Votre demande est examinée par l&apos;équipe FIEF de la Ligue.
      </p>
      {loadError && <p className="mt-4 rounded-xl bg-[#FDECEC] px-3 py-2 text-sm text-[#B91F26]">{loadError}</p>}

      <form onSubmit={submit} className="relative mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <FiefLabel required>Prénom</FiefLabel>
            <input required autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fiefInput} />
          </label>
          <label className="block">
            <FiefLabel required>Nom</FiefLabel>
            <input required autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fiefInput} />
          </label>
          <label className="block">
            <FiefLabel required>E-mail</FiefLabel>
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fiefInput} />
          </label>
          <label className="block">
            <FiefLabel>Téléphone</FiefLabel>
            <input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={fiefInput} placeholder="06 12 34 56 78" />
          </label>
          <label className="block">
            <FiefLabel required>Date de naissance</FiefLabel>
            <input required type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={fiefInput} />
          </label>
        </div>
        {elig && !elig.ok && <p className="rounded-xl bg-[#FDECEC] px-3 py-2 text-sm text-[#B91F26]">{elig.reason}</p>}

        <div>
          <FiefLabel required>Club</FiefLabel>
          {noClub ? (
            <p className="flex items-center justify-between rounded-xl bg-[#EEF2F8] px-3.5 py-3 text-sm">
              Je ne suis pas rattachée à un club
              <button type="button" onClick={() => setNoClub(false)} className="font-semibold text-[#1B3A73] hover:underline">
                Choisir un club
              </button>
            </p>
          ) : club ? (
            <p className="flex items-center justify-between gap-3 rounded-xl bg-[#EEF2F8] px-3.5 py-3 text-sm">
              <span>
                <strong>{club.clubName}</strong>
                {club.clubNumber ? <span className="text-[#5B6B86]"> · n° {club.clubNumber}</span> : <span className="text-[#5B6B86]"> · saisi à la main</span>}
              </span>
              <button type="button" onClick={() => setClub(null)} aria-label="Changer de club" className="rounded-full p-1 text-[#5B6B86] hover:bg-white">
                <X size={16} />
              </button>
            </p>
          ) : (
            <ClubPicker onPick={setClub} onNoClub={() => setNoClub(true)} />
          )}
        </div>

        <div>
          <FiefLabel required>Votre rôle dans le football</FiefLabel>
          <div className="flex flex-wrap gap-2">
            {(config?.functions ?? []).map((f) => {
              const on = functions.includes(f.slug);
              return (
                <button
                  key={f.slug}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFunctions((prev) => (on ? prev.filter((s) => s !== f.slug) : [...prev, f.slug]))}
                  className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${on ? "border-[#0E2754] bg-[#0E2754] text-white" : "border-[#DCE3EF] bg-white text-[#0E2754] hover:border-[#0E2754]"}`}
                >
                  {on && <Check size={14} className="-ml-0.5 mr-1 inline" />}
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {elig?.ok && elig.needsParent && (
          <div className="space-y-4 rounded-2xl border border-[#F3C9CB] bg-[#FFF6F6] p-4">
            <p className="text-sm text-[#0E2754]">
              <strong>Accord parental.</strong> Comme vous êtes mineure, un parent ou responsable légal doit donner son accord : nous lui envoyons un e-mail.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <FiefLabel required>Nom du parent</FiefLabel>
                <input required value={parentName} onChange={(e) => setParentName(e.target.value)} className={fiefInput} />
              </label>
              <label className="block">
                <FiefLabel required>E-mail du parent</FiefLabel>
                <input required type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} className={fiefInput} />
              </label>
            </div>
          </div>
        )}

        <label className="block">
          <FiefLabel>Un mot pour l&apos;équipe FIEF (facultatif)</FiefLabel>
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={fiefInput} placeholder="Votre parcours, ce que vous attendez du réseau…" />
        </label>

        {/* Champ piège pour les robots : invisible pour les personnes. */}
        <input
          tabIndex={-1}
          autoComplete="off"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute -left-[9999px] h-0 w-0 opacity-0"
          aria-hidden
        />

        <div className="rounded-2xl bg-[#F3F6FB] p-4">
          <p className="mb-2 text-[13px] font-bold uppercase tracking-wide text-[#5B6B86]">Charte FIEF</p>
          <p className="whitespace-pre-line text-sm text-[#0E2754]">{config?.settings.charterText}</p>
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm font-semibold">
            <input type="checkbox" checked={charter} onChange={(e) => setCharter(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#0E2754]" />
            J&apos;ai lu et j&apos;accepte la charte FIEF
          </label>
        </div>

        {error && <p className="rounded-xl bg-[#FDECEC] px-3 py-2 text-sm text-[#B91F26]">{error}</p>}
        <FiefButton type="submit" disabled={busy || !config || (elig !== null && !elig.ok)}>
          {busy ? "Envoi…" : "Envoyer ma demande"}
        </FiefButton>
        <p className="text-center text-xs text-[#5B6B86]">Vos informations servent uniquement à la gestion du réseau FIEF par la Ligue du Grand Est de Football.</p>
      </form>
    </PublicFrame>
  );
}

function ClubPicker({ onPick, onNoClub }: { onPick: (c: { clubNumber: string | null; clubName: string }) => void; onNoClub: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; clubs: FiefClub[] }>({ q: "", clubs: [] });
  const seq = useRef(0);
  const query = q.trim();

  useEffect(() => {
    if (query.length < 2) return;
    const id = ++seq.current;
    const t = window.setTimeout(() => {
      searchFiefClubs(query).then((r) => {
        if (id === seq.current) setResults({ q: query, clubs: r.ok ? r.data : [] });
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const searched = query.length >= 2 && results.q === query;
  const shown = searched ? results.clubs : [];
  return (
    <div>
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} className={`${fiefInput} pl-10`} placeholder="Nom du club, ville ou numéro d'affiliation" />
      </div>
      {shown.length > 0 && (
        <ul className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-[#DCE3EF] bg-white">
          {shown.map((c) => (
            <li key={c.clubNumber}>
              <button type="button" onClick={() => onPick({ clubNumber: c.clubNumber, clubName: c.clubName })} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-[#F3F6FB]">
                <span className="font-semibold">{c.clubName}</span>
                {c.city && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-[#5B6B86]">
                    <MapPin size={12} /> {c.city}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {searched && (
          <button type="button" onClick={() => onPick({ clubNumber: null, clubName: query })} className="font-semibold text-[#1B3A73] hover:underline">
            Mon club n&apos;est pas dans la liste : utiliser « {query} »
          </button>
        )}
        <button type="button" onClick={onNoClub} className="font-semibold text-[#5B6B86] hover:underline">
          Je ne suis pas rattachée à un club
        </button>
      </div>
    </div>
  );
}
