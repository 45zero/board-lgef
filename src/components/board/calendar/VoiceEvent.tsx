"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Sparkles, X, Loader2 } from "lucide-react";
import { prepareDictatedEvent, type EventDraft } from "@/app/actions/event-dictation";

// Création d'événement à la voix : on dicte (reconnaissance vocale du navigateur, en français), le
// texte s'écrit dans une zone modifiable pour corriger à son rythme, puis Claude prépare un
// brouillon qui ouvre la fiche « Nouvel événement » pré-remplie — rien n'est créé sans « Enregistrer ».

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const EXAMPLE = "Crée-moi un événement le 25 août à 18 h, réunion de la commission arbitrage au siège à Champigneulles, tu me mets responsable avec Paul Martin, et rappelle-moi la veille.";

/** Fenêtre de dictée : micro + texte modifiable → brouillon d'événement. */
export function VoiceEventDialog({ onClose, onDraft, mobile }: { onClose: () => void; onDraft: (d: EventDraft) => void; mobile?: boolean }) {
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const [supported] = useState(() => !!recognitionCtor());

  const stop = () => recRef.current?.stop();

  // auto : lancement à l'ouverture, sans clic (Safari iOS peut le refuser : on attend alors « Dicter »).
  const start = (auto = false) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalPart = "";
      let interimPart = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalPart += r[0].transcript;
        else interimPart += r[0].transcript;
      }
      if (finalPart) setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${finalPart.trim()}`);
      setInterim(interimPart);
    };
    rec.onstart = () => {
      setError(null);
      setListening(true);
    };
    rec.onerror = (e) => {
      if (auto && e.error === "not-allowed") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Micro refusé : autorisez-le dans le navigateur, ou écrivez la demande.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("La dictée s'est interrompue : relancez le micro ou écrivez la suite.");
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      recRef.current = null;
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
    }
  };

  useEffect(() => () => recRef.current?.stop(), []);
  // On lance le micro dès l'ouverture : un clic sur le bouton suffit pour commencer à parler.
  useEffect(() => {
    if (supported) start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois à l'ouverture
  }, []);

  const submit = async () => {
    stop();
    setBusy(true);
    setError(null);
    try {
      const { draft, error } = await prepareDictatedEvent(`${text} ${interim}`.trim());
      if (draft) onDraft(draft);
      else setError(error);
    } catch {
      setError("La lecture de la demande a échoué : réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-black/30 ${mobile ? "items-end" : "items-center justify-center p-4"}`}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex w-full flex-col gap-3 bg-card p-4 shadow-modal ${
          mobile ? "rounded-t-sheet pb-[calc(env(safe-area-inset-bottom)+16px)]" : "max-w-[560px] rounded-modal p-5"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-ink">Créer un événement à la voix</h2>
            <p className="mt-0.5 text-xs text-ink-3">
              Dites ce qu&apos;il faut créer, corrigez le texte si besoin, puis vérifiez la fiche avant de l&apos;enregistrer.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink-4 hover:bg-hover" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="relative">
          <textarea
            value={listening && interim ? `${text}${text ? " " : ""}${interim}` : text}
            onChange={(e) => {
              stop();
              setText(e.target.value);
            }}
            rows={mobile ? 5 : 6}
            placeholder={`Ex. : « ${EXAMPLE} »`}
            className="w-full resize-none rounded-btn border border-line bg-panel px-3 py-2.5 text-sm text-ink placeholder:text-ink-4 focus:border-navy focus:outline-none"
          />
          {listening && (
            <span className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-bold text-red">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red" /> J&apos;écoute…
            </span>
          )}
        </div>

        {!supported && (
          <p className="text-xs text-ink-3">
            La dictée n&apos;est pas disponible sur ce navigateur : écrivez la demande, ou utilisez le micro du clavier de votre téléphone.
          </p>
        )}
        {error && <p className="text-xs font-semibold text-red">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          {supported ? (
            <button
              onClick={() => (listening ? stop() : start())}
              disabled={busy}
              className={`flex items-center gap-1.5 rounded-btn border px-3 py-2 text-sm font-bold disabled:opacity-50 ${
                listening ? "border-red bg-red text-white" : "border-line text-ink-2 hover:bg-hover"
              }`}
            >
              {listening ? <Square size={14} /> : <Mic size={15} />}
              {listening ? "Arrêter" : text ? "Continuer à dicter" : "Dicter"}
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={submit}
            disabled={busy || `${text}${interim}`.trim().length < 5}
            className="flex items-center gap-1.5 rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white hover:bg-navy-600 disabled:opacity-40"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy ? "Préparation…" : "Préparer l'événement"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Rappel en tête de la fiche pré-remplie : phrase dictée et points à vérifier. */
export function DraftNotice({ draft }: { draft: EventDraft }) {
  const checks = [
    ...draft.doubts,
    ...(draft.date ? [] : ["Aucune date comprise : choisissez-la ci-dessous."]),
    ...draft.unknownPeople.map((n) => `« ${n} » n'a pas été retrouvé parmi les utilisateurs : ajoutez la bonne personne.`),
  ];
  return (
    <div className="rounded-btn border border-navy/20 bg-navy/5 px-3 py-2.5 text-xs text-ink-2">
      <div className="flex items-center gap-1.5 font-bold text-navy">
        <Mic size={13} /> Pré-rempli d&apos;après votre demande — vérifiez avant d&apos;enregistrer
      </div>
      <p className="mt-1 italic text-ink-3">« {draft.text} »</p>
      {checks.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-semibold text-amber-700 dark:text-amber-400">
          {checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
