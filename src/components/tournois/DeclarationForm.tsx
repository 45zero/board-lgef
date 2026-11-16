"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FileText, Loader2, Paperclip, Search, Trash2 } from "lucide-react";
import { PlaceInput } from "@/components/board/PlaceInput";
import { finalizeTournamentDeclaration, searchTournamentClubs, submitTournamentDeclaration } from "@/app/actions/tournois-public";
import {
  ACCEPTED_FILES,
  CATERING_LABELS,
  daysUntil,
  FILE_KIND_LABELS,
  fmtSize,
  MAX_FILE_BYTES,
  SURFACES,
  type CategoryInput,
  type ClubHit,
  type PublicFormConfig,
} from "@/lib/tournois/shared";
import { uploadPiece } from "@/components/tournois/upload";

// Formulaire public de déclaration de tournoi / rassemblement (/tournoi) : 5 étapes courtes, pensé
// pour le téléphone. Brouillon gardé dans le navigateur (sans les fichiers) pour reprendre plus tard.

type Tri = boolean | null;
type Piece = { kind: "poster" | "rules" | "other"; file: File };

interface Draft {
  club: ClubHit | null;
  clubNotListed: boolean;
  freeClubName: string;
  districtCode: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  address: string;
  contactFirstName: string;
  contactLastName: string;
  contactPhone: string;
  contactLandline: string;
  contactEmail: string;
  categories: Record<string, CategoryInput>;
  clubsExpected: string;
  otherDistricts: Tri;
  otherCountries: Tri;
  participantCharter: Tri;
  educationalMessages: string;
  matchSheetsAtStart: Tri;
  disciplineCommission: Tri;
  refreshments: Tri;
  catering: "internal" | "external" | "none" | null;
  hotPoints: Tri;
  parking: string;
  firstAid: string;
  spectatorsExpected: string;
  animations: string;
  otherInfo: string;
}

const EMPTY: Draft = {
  club: null,
  clubNotListed: false,
  freeClubName: "",
  districtCode: "",
  title: "",
  startDate: "",
  endDate: "",
  startTime: "",
  endTime: "",
  address: "",
  contactFirstName: "",
  contactLastName: "",
  contactPhone: "",
  contactLandline: "",
  contactEmail: "",
  categories: {},
  clubsExpected: "",
  otherDistricts: null,
  otherCountries: null,
  participantCharter: null,
  educationalMessages: "",
  matchSheetsAtStart: null,
  disciplineCommission: null,
  refreshments: null,
  catering: null,
  hotPoints: null,
  parking: "",
  firstAid: "",
  spectatorsExpected: "",
  animations: "",
  otherInfo: "",
};

const DRAFT_KEY = "lgef-tournoi-brouillon";
const STEPS = ["Club", "Manifestation", "Catégories", "Organisation", "Pièces et envoi"];

const input = "w-full rounded-btn border border-line-strong bg-card px-3 py-2 text-[15px] text-ink outline-none focus:border-navy focus:ring-2 focus:ring-navy/15";
const label = "mb-1 block text-sm font-semibold text-ink-2";
const toInt = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s))) || 0);

export function DeclarationForm({ config, districts }: { config: PublicFormConfig; districts: { code: string; name: string }[] }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [certify, setCertify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<null | { label: string; ratio: number }>(null);
  const [done, setDone] = useState<null | { ref: string; email: string; acknowledged: boolean; failedFiles: string[] }>(null);
  const restored = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  // Brouillon : relu à l'ouverture, gardé à chaque modification.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique du brouillon après le montage
      if (raw) setD({ ...EMPTY, ...JSON.parse(raw) });
    } catch {
      /* stockage indisponible : pas de brouillon */
    }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  }, [d]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const days = d.startDate ? daysUntil(d.startDate) : null;
  const late = days != null && days >= 0 && days < config.minNoticeDays;
  const checked = config.categories.filter((c) => d.categories[c.slug]);

  const stepError = (s: number): string | null => {
    if (s === 0) {
      if (!d.clubNotListed && !d.club) return "Recherchez et sélectionnez votre club.";
      if (d.clubNotListed && d.freeClubName.trim().length < 2) return "Indiquez le nom de votre club.";
      if (d.clubNotListed && !d.districtCode) return "Choisissez votre district.";
    }
    if (s === 1) {
      if (d.title.trim().length < 3) return "Donnez un nom à la manifestation.";
      if (!d.startDate) return "Indiquez la date.";
      if (days != null && days < 0) return "La date est déjà passée.";
      if (d.endDate && d.endDate < d.startDate) return "La date de fin précède la date de début.";
      if (d.address.trim().length < 5) return "Indiquez l'adresse.";
      if (!d.contactFirstName.trim() || !d.contactLastName.trim()) return "Indiquez le nom et le prénom du responsable.";
      if (d.contactPhone.trim().length < 6) return "Indiquez le portable du responsable.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contactEmail.trim())) return "L'adresse e-mail du responsable est invalide.";
    }
    if (s === 2 && !checked.length) return "Cochez au moins une catégorie.";
    return null;
  };

  const go = (to: number) => {
    if (to > step) {
      for (let s = step; s < to; s++) {
        const e = stepError(s);
        if (e) {
          setError(e);
          setStep(s);
          return;
        }
      }
    }
    setError(null);
    setStep(to);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = async () => {
    for (let s = 0; s < 4; s++) {
      const e = stepError(s);
      if (e) {
        setStep(s);
        setError(e);
        return;
      }
    }
    if (!certify) return setError("Merci de certifier l'exactitude des informations.");
    setError(null);
    setSending({ label: "Enregistrement de la déclaration…", ratio: 0 });
    try {
      const res = await submitTournamentDeclaration({
        club: d.club ? { clubNumber: d.club.clubNumber, clubName: d.club.clubName } : { clubNumber: null, clubName: d.freeClubName },
        districtCode: d.club?.districtCode ?? (d.districtCode || null),
        title: d.title,
        startDate: d.startDate,
        endDate: d.endDate || d.startDate,
        startTime: d.startTime,
        endTime: d.endTime,
        address: d.address,
        contactFirstName: d.contactFirstName,
        contactLastName: d.contactLastName,
        contactPhone: d.contactPhone,
        contactLandline: d.contactLandline,
        contactEmail: d.contactEmail,
        categories: checked.map((c) => ({ ...d.categories[c.slug], slug: c.slug })),
        clubsExpected: toInt(d.clubsExpected),
        otherDistricts: d.otherDistricts,
        otherCountries: d.otherCountries,
        participantCharter: d.participantCharter,
        educationalMessages: d.educationalMessages,
        matchSheetsAtStart: d.matchSheetsAtStart,
        disciplineCommission: d.disciplineCommission,
        refreshments: d.refreshments,
        catering: d.catering,
        hotPoints: d.hotPoints,
        parking: d.parking,
        firstAid: d.firstAid,
        spectatorsExpected: toInt(d.spectatorsExpected),
        animations: d.animations,
        otherInfo: d.otherInfo,
        files: pieces.map((p) => ({ kind: p.kind, name: p.file.name, mimeType: p.file.type || "application/octet-stream", size: p.file.size })),
        certify: true,
      });
      if (!res.ok) throw new Error(res.error);
      const failedFiles: string[] = [];
      for (const slot of res.data.uploads) {
        const p = pieces[slot.index];
        if (!p) continue;
        setSending({ label: `Envoi de « ${p.file.name} »…`, ratio: 0 });
        try {
          await uploadPiece(p.file, slot.fileId, (ratio) => setSending({ label: `Envoi de « ${p.file.name} »…`, ratio }));
        } catch {
          failedFiles.push(p.file.name);
        }
      }
      setSending({ label: "Envoi de l'accusé de réception…", ratio: 1 });
      const fin = await finalizeTournamentDeclaration(res.data.id);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      setDone({ ref: res.data.ref, email: d.contactEmail, acknowledged: fin.ok && fin.data.acknowledged, failedFiles });
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'envoi a échoué. Réessayez.");
    } finally {
      setSending(null);
    }
  };

  if (done)
    return (
      <Shell topRef={topRef}>
        <div className="py-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-bg text-good">
            <Check size={30} />
          </span>
          <h2 className="mt-4 text-xl font-extrabold text-ink">Déclaration enregistrée</h2>
          <p className="mt-1 text-sm text-ink-3">Numéro de dossier</p>
          <p className="text-2xl font-extrabold tracking-wide text-navy">{done.ref}</p>
          <p className="mx-auto mt-4 max-w-md text-[15px] text-ink-2">
            {done.acknowledged ? (
              <>
                Un accusé de réception vient de partir à <b>{done.email}</b>, avec le récapitulatif. Le district et la ligue vous répondront par e-mail : utilisez le bouton
                « Répondre » de leurs messages pour échanger ou ajouter une pièce.
              </>
            ) : (
              <>Votre déclaration est bien enregistrée. L&apos;accusé de réception n&apos;a pas pu partir pour l&apos;instant : notez votre numéro de dossier.</>
            )}
          </p>
          {done.failedFiles.length > 0 && (
            <p className="mx-auto mt-4 max-w-md rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn">
              Pièce(s) non envoyée(s) : {done.failedFiles.join(", ")}. Vous pourrez les transmettre avec le bouton « Répondre » de l&apos;accusé de réception.
            </p>
          )}
          <button
            onClick={() => {
              setD(EMPTY);
              setPieces([]);
              setCertify(false);
              setStep(0);
              setDone(null);
            }}
            className="mt-6 text-sm font-semibold text-link hover:underline"
          >
            Déclarer une autre manifestation
          </button>
        </div>
      </Shell>
    );

  return (
    <Shell topRef={topRef} intro={step === 0 ? config.introText : null} minNoticeDays={step === 0 ? config.minNoticeDays : undefined}>
      <ol className="mb-3 flex gap-1.5" aria-label="Étapes">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              onClick={() => (i < step ? go(i) : undefined)}
              className={`block h-1.5 w-full rounded-full ${i <= step ? "bg-navy" : "bg-track"}`}
              aria-label={`Étape ${i + 1} : ${s}`}
              aria-current={i === step ? "step" : undefined}
            />
          </li>
        ))}
      </ol>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-4">
        Étape {step + 1} sur {STEPS.length}
      </p>
      <h2 className="mb-3 text-lg font-extrabold text-ink">{STEPS[step]}</h2>

      {step === 0 && <ClubStep d={d} set={set} districts={districts} />}

      {step === 1 && (
        <div className="space-y-3">
          <Field label="Nom de la manifestation">
            <input className={input} value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex. Tournoi de Pâques U11" maxLength={160} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Date de début">
              <input type="date" className={input} value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            <Field label="Date de fin">
              <input type="date" className={input} value={d.endDate} min={d.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} />
            </Field>
            <Field label="Heure de début">
              <input type="time" className={input} value={d.startTime} onChange={(e) => set("startTime", e.target.value)} />
            </Field>
            <Field label="Heure de fin">
              <input type="time" className={input} value={d.endTime} onChange={(e) => set("endTime", e.target.value)} />
            </Field>
          </div>
          {late && (
            <p className="flex gap-2 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                La manifestation a lieu dans {days} jour{days! > 1 ? "s" : ""} : la déclaration doit être faite au moins {Math.round(config.minNoticeDays / 30)} mois avant. Vous pouvez
                l&apos;envoyer, elle sera marquée « hors délai ».
              </span>
            </p>
          )}
          <Field label="Adresse du lieu">
            <PlaceInput value={d.address} onChange={(v) => set("address", v)} placeholder="Stade, gymnase… et adresse" className={input} />
          </Field>
          <div className="rounded-card border border-line bg-subtle p-3">
            <p className="mb-2 text-sm font-bold text-ink">Responsable - référent de la manifestation</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Prénom">
                <input className={input} value={d.contactFirstName} onChange={(e) => set("contactFirstName", e.target.value)} autoComplete="given-name" />
              </Field>
              <Field label="Nom">
                <input className={input} value={d.contactLastName} onChange={(e) => set("contactLastName", e.target.value)} autoComplete="family-name" />
              </Field>
              <Field label="Portable">
                <input type="tel" className={input} value={d.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} autoComplete="tel" />
              </Field>
              <Field label="Tél. fixe" hint="facultatif">
                <input type="tel" className={input} value={d.contactLandline} onChange={(e) => set("contactLandline", e.target.value)} />
              </Field>
            </div>
            <div className="mt-2">
              <Field label="E-mail" hint="l'accusé de réception et les réponses y arrivent">
                <input type="email" className={input} value={d.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} autoComplete="email" inputMode="email" />
              </Field>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <CategoriesStep
          config={config}
          values={d.categories}
          multiDay={!!d.endDate && d.endDate !== d.startDate}
          onChange={(v) => set("categories", v)}
          minDate={d.startDate}
          maxDate={d.endDate || d.startDate}
        />
      )}

      {step === 3 && (
        <div className="space-y-5">
          <Group title="Participants">
            <Field label="Nombre de clubs attendus (environ)">
              <input type="number" inputMode="numeric" min={0} className={input} value={d.clubsExpected} onChange={(e) => set("clubsExpected", e.target.value)} />
            </Field>
            <YesNo label="Équipes d'autres districts" value={d.otherDistricts} onChange={(v) => set("otherDistricts", v)} />
            <YesNo label="Équipes d'autres pays" value={d.otherCountries} onChange={(v) => set("otherCountries", v)} />
          </Group>
          <Group title="Climat des rencontres">
            <YesNo label="Charte des participants" value={d.participantCharter} onChange={(v) => set("participantCharter", v)} />
            <Field label="Messages éducatifs" hint="thème du PEF ou autre">
              <input className={input} value={d.educationalMessages} onChange={(e) => set("educationalMessages", e.target.value)} placeholder="Ex. respect de l'arbitre, fair-play…" />
            </Field>
            <YesNo label="Feuilles de match établies en début de journée" value={d.matchSheetsAtStart} onChange={(v) => set("matchSheetsAtStart", v)} />
            <YesNo label="Commission de discipline sur place" value={d.disciplineCommission} onChange={(v) => set("disciplineCommission", v)} />
          </Group>
          <Group title="Logistique">
            <YesNo label="Buvette" hint="pensez à la demande auprès de votre commune" value={d.refreshments} onChange={(v) => set("refreshments", v)} />
            <div>
              <p className={label}>Pôle restauration</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(CATERING_LABELS) as (keyof typeof CATERING_LABELS)[]).map((k) => (
                  <Choice key={k} active={d.catering === k} onClick={() => set("catering", d.catering === k ? null : k)}>
                    {CATERING_LABELS[k]}
                  </Choice>
                ))}
              </div>
            </div>
            <YesNo label="Points chauds (friteuse, barbecue…)" hint="prévoyez des extincteurs à proximité" value={d.hotPoints} onChange={(v) => set("hotPoints", v)} />
            <Field label="Parkings" hint="en dur, herbe… et nombre de places">
              <input className={input} value={d.parking} onChange={(e) => set("parking", e.target.value)} />
            </Field>
            <Field label="Secours assurés par">
              <input className={input} value={d.firstAid} onChange={(e) => set("firstAid", e.target.value)} placeholder="Ex. Croix-Rouge, protection civile…" />
            </Field>
            <Field label="Nombre de spectateurs prévus">
              <input type="number" inputMode="numeric" min={0} className={input} value={d.spectatorsExpected} onChange={(e) => set("spectatorsExpected", e.target.value)} />
            </Field>
          </Group>
          <Field label="Animations proposées">
            <textarea rows={3} className={input} value={d.animations} onChange={(e) => set("animations", e.target.value)} />
          </Field>
          <Field label="Informations utiles à communiquer">
            <textarea rows={3} className={input} value={d.otherInfo} onChange={(e) => set("otherInfo", e.target.value)} />
          </Field>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <PiecesStep pieces={pieces} onChange={setPieces} />
          <Summary d={d} checked={checked.map((c) => c.label)} late={late} pieces={pieces.length} />
          <label className="flex cursor-pointer gap-3 rounded-card border border-line bg-subtle p-3 text-sm text-ink-2">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--navy)]" checked={certify} onChange={(e) => setCertify(e.target.checked)} />
            <span>Je certifie l&apos;exactitude des informations et m&apos;engage à respecter les règlements de la FFF, de la ligue et du district pour cette manifestation.</span>
          </label>
        </div>
      )}

      {error && <p className="mt-4 rounded-btn bg-bad-bg px-3 py-2 text-sm font-medium text-bad">{error}</p>}

      {sending && (
        <div className="mt-4 rounded-card border border-line bg-subtle p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-2">
            <Loader2 size={16} className="animate-spin" /> {sending.label}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-track">
            <div className="h-full rounded-full bg-navy transition-all" style={{ width: `${Math.round(sending.ratio * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="sticky bottom-0 -mx-5 mt-4 flex items-center gap-3 border-t border-line bg-card px-5 py-3 sm:static sm:mx-0 sm:border-0 sm:px-0 sm:py-0">
        {step > 0 && (
          <button type="button" onClick={() => go(step - 1)} disabled={!!sending} className="flex items-center gap-1 rounded-btn px-3 py-2.5 text-sm font-semibold text-ink-2 hover:bg-hover">
            <ChevronLeft size={16} /> Retour
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={() => go(step + 1)} className="ml-auto flex items-center gap-1 rounded-btn bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-600">
            Continuer <ChevronRight size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!!sending}
            className="ml-auto flex items-center gap-2 rounded-btn bg-red px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Envoyer la déclaration
          </button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children, topRef, intro, minNoticeDays }: { children: React.ReactNode; topRef: React.RefObject<HTMLDivElement | null>; intro?: string | null; minNoticeDays?: number }) {
  return (
    <div ref={topRef} className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-5">
      <header className="mb-3 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo statique léger */}
        <img src="/lgef-logo.png" alt="Ligue du Grand Est de Football" className="h-12 w-auto" />
        <div>
          <h1 className="text-lg font-extrabold leading-tight text-ink sm:text-xl">Déclaration de tournoi / rassemblement</h1>
          <p className="text-xs text-ink-3">Ligue du Grand Est de Football · transmise à votre district</p>
        </div>
      </header>
      {minNoticeDays != null && (
        <div className="mb-4 rounded-card border border-line bg-card px-4 py-3 text-sm text-ink-2">
          {intro ? (
            <p className="whitespace-pre-line">{intro}</p>
          ) : (
            <p>
              Déclaration obligatoire (règlements généraux de la FFF), à faire <b>au moins {Math.round(minNoticeDays / 30)} mois avant</b> la manifestation. Comptez 5 minutes ; vous
              recevez un accusé de réception avec un numéro de dossier.
            </p>
          )}
        </div>
      )}
      <div className="rounded-modal border border-line bg-card p-5 shadow-card">{children}</div>
      <p className="mt-4 text-center text-xs text-ink-4">
        Vos informations servent uniquement au traitement de la déclaration par la ligue et le district.{" "}
        <a href="/privacy" className="underline">
          Confidentialité
        </a>
      </p>
    </div>
  );
}

function Field({ label: text, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={label}>
        {text} {hint && <span className="font-normal text-ink-4">({hint})</span>}
      </span>
      {children}
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-card border border-line p-3">
      <legend className="px-1 text-sm font-bold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

function Choice({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-btn border font-semibold transition-colors ${small ? "px-3 py-2 text-sm sm:px-2.5 sm:py-1 sm:text-[13px]" : "px-3 py-2 text-sm"} ${active ? "border-navy bg-navy text-white" : "border-line-strong bg-card text-ink-2 hover:bg-hover"}`}
    >
      {children}
    </button>
  );
}

function YesNo({ label: text, hint, value, onChange }: { label: string; hint?: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-semibold text-ink-2">
        {text} {hint && <span className="block text-xs font-normal text-ink-4">{hint}</span>}
      </span>
      <div className="flex gap-2">
        <Choice active={value === true} onClick={() => onChange(value === true ? null : true)}>
          Oui
        </Choice>
        <Choice active={value === false} onClick={() => onChange(value === false ? null : false)}>
          Non
        </Choice>
      </div>
    </div>
  );
}

function ClubStep({ d, set, districts }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; districts: { code: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClubHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- vider la liste quand la recherche est trop courte
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      searchTournamentClubs(query)
        .then((r) => setHits(r.ok ? r.data : []))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (d.club)
    return (
      <div className="rounded-card border-2 border-navy bg-sel-bg p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-4">Club organisateur</p>
        <p className="mt-1 text-lg font-extrabold text-ink">{d.club.clubName}</p>
        <p className="text-sm text-ink-2">
          N° d&apos;affiliation {d.club.clubNumber}
          {d.club.city ? ` · ${d.club.city}` : ""}
        </p>
        {d.club.districtName && <p className="mt-1 text-sm text-ink-2">District : {d.club.districtName}</p>}
        <button type="button" onClick={() => set("club", null)} className="mt-3 text-sm font-semibold text-link hover:underline">
          Changer de club
        </button>
      </div>
    );

  if (d.clubNotListed)
    return (
      <div className="space-y-4">
        <Field label="Nom du club organisateur">
          <input className={input} value={d.freeClubName} onChange={(e) => set("freeClubName", e.target.value)} />
        </Field>
        <Field label="District">
          <select className={input} value={d.districtCode} onChange={(e) => set("districtCode", e.target.value)}>
            <option value="">Choisir…</option>
            {districts.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <button type="button" onClick={() => set("clubNotListed", false)} className="text-sm font-semibold text-link hover:underline">
          ← Rechercher mon club dans la liste
        </button>
      </div>
    );

  return (
    <div>
      <label className={label} htmlFor="club-search">
        Recherchez votre club (nom, ville ou n° d&apos;affiliation)
      </label>
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
        <input id="club-search" className={`${input} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. Troyes, 500119…" autoComplete="off" />
        {loading && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink-4" />}
      </div>
      {hits.length > 0 && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-card border border-line">
          {hits.map((h) => (
            <li key={h.clubNumber}>
              <button type="button" onClick={() => set("club", h)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-hover">
                <span>
                  <span className="block font-semibold text-ink">{h.clubName}</span>
                  <span className="block text-xs text-ink-3">
                    {h.clubNumber}
                    {h.city ? ` · ${h.city}` : ""}
                    {h.districtName ? ` · ${h.districtName}` : ""}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !loading && hits.length === 0 && <p className="mt-2 text-sm text-ink-3">Aucun club trouvé.</p>}
      <button type="button" onClick={() => set("clubNotListed", true)} className="mt-4 text-sm font-semibold text-link hover:underline">
        Mon club n&apos;apparaît pas
      </button>
    </div>
  );
}

function CategoriesStep({
  config,
  values,
  onChange,
  multiDay,
  minDate,
  maxDate,
}: {
  config: PublicFormConfig;
  values: Record<string, CategoryInput>;
  onChange: (v: Record<string, CategoryInput>) => void;
  multiDay: boolean;
  minDate: string;
  maxDate: string;
}) {
  const toggle = (slug: string) => {
    const next = { ...values };
    if (next[slug]) delete next[slug];
    else next[slug] = { slug };
    onChange(next);
  };
  const patch = (slug: string, p: Partial<CategoryInput>) => onChange({ ...values, [slug]: { ...values[slug], ...p } });
  const num = (v: number | null | undefined) => (v == null ? "" : String(v));
  const groups = (["rassemblement", "tournoi"] as const).map((kind) => ({ kind, cats: config.categories.filter((c) => c.kind === kind) })).filter((g) => g.cats.length);
  const selected = config.categories.filter((c) => values[c.slug]);
  const box = "h-9 sm:h-8 rounded-md border border-line-strong bg-card px-1 text-center text-[15px] text-ink outline-none focus:border-navy";

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
      {groups.map((g) => (
        <div key={g.kind}>
          <p className="mb-1.5 text-sm font-bold text-ink">{g.kind === "rassemblement" ? "Rassemblement" : "Tournoi"}</p>
          <div className="flex flex-wrap gap-2 sm:gap-1.5">
            {g.cats.map((c) => (
              <Choice key={c.slug} small active={!!values[c.slug]} onClick={() => toggle(c.slug)}>
                {values[c.slug] && <Check size={14} className="-ml-0.5 mr-1 inline" />}
                {c.label}
              </Choice>
            ))}
          </div>
        </div>
      ))}
      </div>

      {selected.length > 0 && (
        <div className="overflow-hidden rounded-card border border-line">
          {/* Mêmes champs que la fiche papier : Nb équipes, Date (*), Joueurs / équipe, Nb remplaçants, Pratique (**) */}
          <div className="hidden items-end gap-x-2 bg-subtle px-3 py-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-ink-4 sm:flex">
            <span className="w-16">Catégorie</span>
            <span className="w-14 text-center">Nb équipes</span>
            {multiDay && <span className="w-36">Date (*)</span>}
            <span className="w-14 text-center">Joueurs / équipe</span>
            <span className="w-14 text-center">Nb rempl.</span>
            <span className="w-32">Pratique (**)</span>
          </div>
          {selected.map((c, i) => {
            const v = values[c.slug];
            return (
              <div key={c.slug} className={`flex flex-wrap items-end gap-x-2 gap-y-2 border-line px-3 py-2.5 sm:flex-nowrap sm:items-center sm:py-1 ${i ? "border-t" : "sm:border-t"}`}>
                <span className="w-full pb-0.5 text-sm font-extrabold text-navy sm:w-16 sm:pb-0">{c.label}</span>
                <Cell label="Nb équipes">
                  <input aria-label={`${c.label} — nombre d'équipes`} type="number" inputMode="numeric" min={0} className={`${box} w-14`} value={num(v.teams)} onChange={(e) => patch(c.slug, { teams: toInt(e.target.value) })} />
                </Cell>
                {multiDay && (
                  <Cell label="Date (*)">
                    <input aria-label={`${c.label} — date`} type="date" className={`${box} w-36 text-sm`} min={minDate} max={maxDate} value={v.playDate ?? ""} onChange={(e) => patch(c.slug, { playDate: e.target.value })} />
                  </Cell>
                )}
                <Cell label="Joueurs / éq.">
                  <input aria-label={`${c.label} — joueurs par équipe`} type="number" inputMode="numeric" min={0} className={`${box} w-14`} value={num(v.playersPerTeam)} onChange={(e) => patch(c.slug, { playersPerTeam: toInt(e.target.value) })} />
                </Cell>
                <Cell label="Nb rempl.">
                  <input aria-label={`${c.label} — nombre de remplaçants`} type="number" inputMode="numeric" min={0} className={`${box} w-14`} value={num(v.substitutes)} onChange={(e) => patch(c.slug, { substitutes: toInt(e.target.value) })} />
                </Cell>
                <Cell label="Pratique (**)">
                  <select aria-label={`${c.label} — pratique`} className={`${box} w-32 text-left text-sm`} value={v.surface ?? ""} onChange={(e) => patch(c.slug, { surface: e.target.value })}>
                    <option value="">—</option>
                    {SURFACES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Cell>
              </div>
            );
          })}
          <p className="border-t border-line bg-subtle px-3 py-1.5 text-[11px] leading-snug text-ink-4">
            {multiDay && <>(*) Si la catégorie ne joue que sur une seule journée, précisez la date. </>}(**) Herbe / Futsal / Foot Indoor / Beach Soccer…
          </p>
        </div>
      )}
    </div>
  );
}

function Cell({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-4 sm:hidden">{text}</span>
      {children}
    </label>
  );
}

function PiecesStep({ pieces, onChange }: { pieces: Piece[]; onChange: (p: Piece[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const add = (kind: Piece["kind"], files: FileList | null) => {
    setError(null);
    const list = Array.from(files ?? []);
    const tooBig = list.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) return setError(`« ${tooBig.name} » dépasse 20 Mo.`);
    // Affiche / règlement : un seul fichier chacun (le nouveau remplace l'ancien).
    const kept = kind === "other" ? pieces : pieces.filter((p) => p.kind !== kind);
    const added = (kind === "other" ? list : list.slice(0, 1)).map((file) => ({ kind, file }));
    onChange([...kept, ...added].slice(0, 6));
  };
  const remove = (p: Piece) => onChange(pieces.filter((x) => x !== p));
  const row = (p: Piece) => (
    <div key={p.file.name + p.file.size + p.kind} className="mt-2 flex items-center gap-2 text-sm text-ink-2">
      <FileText size={16} className="shrink-0 text-navy" />
      <span className="min-w-0 flex-1 truncate">{p.file.name}</span>
      <span className="text-xs text-ink-4">{fmtSize(p.file.size)}</span>
      <button type="button" onClick={() => remove(p)} className="rounded-btn p-1 text-ink-4 hover:bg-hover" aria-label="Retirer">
        <Trash2 size={15} />
      </button>
    </div>
  );
  const picker = (kind: Piece["kind"], text: string, multiple = false) => (
    <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-btn bg-subtle px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover">
      <Paperclip size={15} /> {text}
      <input
        type="file"
        multiple={multiple}
        accept={ACCEPTED_FILES}
        className="sr-only"
        onChange={(e) => {
          add(kind, e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
  const slot = (kind: "poster" | "rules", hint: string) => {
    const p = pieces.find((x) => x.kind === kind);
    return (
      <div className="rounded-card border border-dashed border-line-strong p-3">
        <p className="text-sm font-bold text-ink">
          {FILE_KIND_LABELS[kind]} <span className="font-normal text-ink-4">({hint})</span>
        </p>
        {p ? row(p) : picker(kind, "Choisir un fichier ou une photo")}
      </div>
    );
  };
  return (
    <div className="space-y-3">
      {slot("poster", "conseillée")}
      {slot("rules", "si vous en avez un")}
      <div className="rounded-card border border-dashed border-line-strong p-3">
        <p className="text-sm font-bold text-ink">
          Autres pièces <span className="font-normal text-ink-4">(autorisation de buvette, plan…)</span>
        </p>
        {pieces.filter((p) => p.kind === "other").map(row)}
        {pieces.length < 6 && picker("other", "Ajouter", true)}
      </div>
      <p className="text-xs text-ink-4">PDF, image ou document Word · 20 Mo maximum par fichier · 6 fichiers au plus.</p>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function Summary({ d, checked, late, pieces }: { d: Draft; checked: string[]; late: boolean; pieces: number }) {
  const club = d.club?.clubName ?? d.freeClubName;
  const period = useMemo(() => {
    if (!d.startDate) return "";
    const f = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    return d.endDate && d.endDate !== d.startDate ? `du ${f(d.startDate)} au ${f(d.endDate)}` : f(d.startDate);
  }, [d.startDate, d.endDate]);
  return (
    <div className="rounded-card bg-subtle p-3 text-sm text-ink-2">
      <p className="mb-1 font-bold text-ink">Récapitulatif</p>
      <p>
        <b>{d.title || "—"}</b> · {club}
      </p>
      <p>
        {period} · {d.address}
      </p>
      <p>Catégories : {checked.join(", ") || "—"}</p>
      <p>
        Responsable : {d.contactFirstName} {d.contactLastName} · {d.contactEmail}
      </p>
      <p>
        {pieces} pièce{pieces > 1 ? "s" : ""} jointe{pieces > 1 ? "s" : ""}
      </p>
      {late && <p className="mt-1 font-semibold text-warn">Déclaration hors délai.</p>}
    </div>
  );
}
