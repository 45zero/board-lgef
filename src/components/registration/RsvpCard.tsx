"use client";

import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Check, X, CalendarDays, MapPin } from "lucide-react";

export function RsvpCard({
  eventTitle,
  eventStartDate,
  eventLocation,
  cardHtml,
  initialChoice,
  alreadyResponded,
  extraFields,
  clubLimit,
  onSubmit,
}: {
  eventTitle: string;
  eventStartDate: string;
  eventLocation: string | null;
  /** Rendu HTML de la campagne (mêmes blocs que le mail envoyé) — affiché à la place de l'en-tête générique quand fourni. */
  cardHtml?: string;
  initialChoice?: "yes" | "no" | null;
  alreadyResponded?: "yes" | "no" | null;
  extraFields?: React.ReactNode;
  /** Plafond de personnes par club de la campagne (ex. AG : 2) et places restantes pour ce club — absent = pas de limite. */
  clubLimit?: { cap: number; remaining: number } | null;
  /** `attendees` : nombre de personnes (1–99), renseigné seulement pour « Je participe ». Peut renvoyer `{ error }` (ex. limite par club atteinte). */
  onSubmit: (response: "yes" | "no", attendees: number | null) => Promise<{ error: string | null } | void>;
}) {
  const [choice, setChoice] = useState<"yes" | "no" | null>(initialChoice ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"yes" | "no" | null>(alreadyResponded ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attendees, setAttendees] = useState("1");
  const maxAttendees = clubLimit ? clubLimit.remaining : 99;
  const clubFull = !!clubLimit && clubLimit.remaining === 0;
  const capLabel = clubLimit ? `${clubLimit.cap} personne${clubLimit.cap > 1 ? "s" : ""} maximum par club` : "";

  const confirm = async () => {
    if (!choice) return;
    const count = Number(attendees);
    if (choice === "yes" && clubFull) {
      setError(`Inscriptions limitées à ${capLabel} : votre club a déjà atteint ce nombre.`);
      return;
    }
    if (choice === "yes" && (!Number.isInteger(count) || count < 1 || count > maxAttendees)) {
      setError(
        clubLimit
          ? `Inscriptions limitées à ${capLabel} : indiquez entre 1 et ${maxAttendees} personne${maxAttendees > 1 ? "s" : ""}.`
          : "Indiquez un nombre de personnes entre 1 et 99."
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(choice, choice === "yes" ? count : null);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setDone(choice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'envoi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[560px]">
      {cardHtml ? (
        <div className="overflow-hidden rounded-[20px] shadow-modal" dangerouslySetInnerHTML={{ __html: cardHtml }} />
      ) : (
        <div className="rounded-[20px] border border-line bg-card p-6 shadow-modal">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Invitation — Board LGEF</p>
          <h1 className="text-xl font-extrabold text-ink">{eventTitle}</h1>
          <div className="mt-2 space-y-1 text-sm text-ink-3">
            <div className="flex items-center gap-1.5">
              <CalendarDays size={14} />
              {format(new Date(eventStartDate), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
            </div>
            {eventLocation && (
              <div className="flex items-center gap-1.5">
                <MapPin size={14} />
                {eventLocation}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-[20px] border border-line bg-card p-6 shadow-modal">
        {done ? (
          <div
            className="rounded-btn border-2 p-4 text-center"
            style={{
              borderColor: done === "yes" ? "var(--good)" : "var(--line-strong)",
              background: done === "yes" ? "var(--good-bg)" : "var(--subtle)",
            }}
          >
            <p className="text-sm font-bold text-ink">
              {done === "yes"
                ? `Merci, votre participation est enregistrée${Number(attendees) > 1 ? ` (${attendees} personnes)` : ""} !`
                : "Merci, votre réponse a été enregistrée."}
            </p>
          </div>
        ) : (
          <>
            {extraFields}
            <div className={`grid grid-cols-2 gap-3 ${extraFields ? "mt-4" : ""}`}>
              <button
                onClick={() => setChoice("yes")}
                className={`flex flex-col items-center gap-1.5 rounded-btn border-2 px-3 py-4 font-bold transition-colors ${
                  choice === "yes" ? "border-good bg-good-bg text-good" : "border-line text-ink-2 hover:bg-hover"
                }`}
              >
                <Check size={20} /> Je participe
              </button>
              <button
                onClick={() => setChoice("no")}
                className={`flex flex-col items-center gap-1.5 rounded-btn border-2 px-3 py-4 font-bold transition-colors ${
                  choice === "no" ? "border-line-strong bg-subtle text-ink" : "border-line text-ink-2 hover:bg-hover"
                }`}
              >
                <X size={20} /> Je n&rsquo;y participerai pas
              </button>
            </div>

            {choice === "yes" && !clubFull && (
              <label className="mt-4 flex items-center justify-between gap-3 rounded-btn border border-line px-3 py-2.5">
                <span className="text-sm font-semibold text-ink-2">Nombre de personnes</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={maxAttendees}
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                  className="w-20 rounded-btn border border-line px-2 py-1.5 text-center text-sm font-bold text-ink outline-none"
                />
              </label>
            )}

            {choice === "yes" && clubLimit && (
              <p className={`mt-2 text-xs font-semibold ${clubFull ? "text-bad" : "text-ink-3"}`}>
                {clubFull
                  ? `Inscriptions limitées à ${capLabel} : votre club a déjà atteint ce nombre.`
                  : clubLimit.remaining < clubLimit.cap
                    ? `${capLabel} — il reste ${clubLimit.remaining} place${clubLimit.remaining > 1 ? "s" : ""} pour votre club.`
                    : `${capLabel.charAt(0).toUpperCase()}${capLabel.slice(1)}.`}
              </p>
            )}

            {error && <p className="mt-3 text-xs font-semibold text-bad">{error}</p>}

            <button
              onClick={confirm}
              disabled={!choice || submitting || (choice === "yes" && clubFull)}
              className="mt-4 w-full rounded-btn bg-navy px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Envoi…" : "Confirmer ma réponse"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
