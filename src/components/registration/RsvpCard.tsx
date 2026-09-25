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
  onSubmit: (response: "yes" | "no") => Promise<void>;
}) {
  const [choice, setChoice] = useState<"yes" | "no" | null>(initialChoice ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"yes" | "no" | null>(alreadyResponded ?? null);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!choice) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(choice);
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
              {done === "yes" ? "Merci, votre participation est enregistrée !" : "Merci, votre réponse a été enregistrée."}
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

            {error && <p className="mt-3 text-xs font-semibold text-bad">{error}</p>}

            <button
              onClick={confirm}
              disabled={!choice || submitting}
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
