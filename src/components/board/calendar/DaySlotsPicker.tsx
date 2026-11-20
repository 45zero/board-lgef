"use client";

import { dayLabel, slotLabel, type DaySlots } from "@/lib/board/presence";

/**
 * Jours souhaités d'un événement de plusieurs jours, avec le moment fort (heures facultatives) :
 * une case par jour, deux champs d'heure sous chaque jour coché. Utilisé dans les encarts
 * « Couverture médiatique » (vidéo, photo) et « Comité directeur » de la fiche événement.
 */
export function DaySlotsPicker({
  label,
  icon,
  days,
  value,
  onChange,
  accent,
}: {
  label: string;
  icon?: React.ReactNode;
  days: string[];
  value: DaySlots;
  onChange: (next: DaySlots) => void;
  /** Couleurs de l'encart : jour coché. */
  accent: { base: string; ink: string };
}) {
  const toggle = (day: string) => {
    const next = { ...value };
    if (next[day]) delete next[day];
    else next[day] = { start: "", end: "" };
    onChange(next);
  };
  const setTime = (day: string, key: "start" | "end", t: string) => onChange({ ...value, [day]: { ...value[day], [key]: t } });
  const none = Object.keys(value).length === 0;

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold" style={{ color: accent.ink }}>
        {icon}
        {label}
        <span className="font-normal opacity-70">{none ? "— tout l'événement (aucun jour précis)" : "— jours et moment fort"}</span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(days.length, 7)}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const slot = value[d];
          return (
            <div key={d} className="min-w-0">
              <button
                type="button"
                onClick={() => toggle(d)}
                aria-pressed={!!slot}
                className={`w-full rounded-btn border px-1 py-1 text-center text-[11px] font-semibold transition-colors ${slot ? "text-white" : "border-line bg-card text-ink-3 hover:text-ink"}`}
                style={slot ? { background: accent.base, borderColor: accent.base } : undefined}
              >
                {dayLabel(d, "EEE d")}
              </button>
              {slot && (
                <div className="mt-0.5 flex gap-0.5">
                  <input
                    type="time"
                    value={slot.start}
                    onChange={(e) => setTime(d, "start", e.target.value)}
                    aria-label={`${label} ${dayLabel(d)} : début`}
                    title={slotLabel(slot) || "Début (facultatif)"}
                    className="w-1/2 min-w-0 rounded border border-line bg-card px-0.5 py-0.5 font-mono text-[10px] outline-none focus:border-link"
                  />
                  <input
                    type="time"
                    value={slot.end}
                    onChange={(e) => setTime(d, "end", e.target.value)}
                    aria-label={`${label} ${dayLabel(d)} : fin`}
                    title={slotLabel(slot) || "Fin (facultatif)"}
                    className="w-1/2 min-w-0 rounded border border-line bg-card px-0.5 py-0.5 font-mono text-[10px] outline-none focus:border-link"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
