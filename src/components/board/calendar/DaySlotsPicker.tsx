"use client";

import { dayLabel, slotLabel, type DaySlots } from "@/lib/board/presence";

/**
 * Jours souhaités d'un événement de plusieurs jours, avec le moment fort (heures facultatives) :
 * une case par jour, deux champs d'heure sous chaque jour coché. Sur une seule journée : seulement
 * le créneau (de … à …). Utilisé dans les encarts
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

  // Une seule journée : pas de case de jour, juste le créneau où la personne est sollicitée
  // (événement 9h–17h, présence souhaitée 11h–13h). Vide = tout l'événement.
  if (days.length === 1) {
    const day = days[0];
    const slot = value[day] ?? Object.values(value)[0] ?? { start: "", end: "" };
    const set = (key: "start" | "end", t: string) => {
      const next = { ...slot, [key]: t };
      onChange(next.start || next.end ? { [day]: next } : {});
    };
    const invalid = !!slot.start && !!slot.end && slot.end <= slot.start;
    const input = "w-[5.5rem] rounded border bg-card px-1 py-0.5 font-mono text-[11px] outline-none focus:border-link";
    return (
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold" style={{ color: accent.ink }}>
          {icon}
          {label}
          <span className="truncate font-normal opacity-70">{none ? "— tout l'événement" : "— créneau sollicité"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
          de
          <input type="time" value={slot.start} onChange={(e) => set("start", e.target.value)} aria-label={`${label} : début`} className={`${input} ${invalid ? "border-red" : "border-line"}`} />
          à
          <input type="time" value={slot.end} onChange={(e) => set("end", e.target.value)} aria-label={`${label} : fin`} className={`${input} ${invalid ? "border-red" : "border-line"}`} />
          {!none && (
            <button type="button" onClick={() => onChange({})} className="rounded-btn px-1.5 py-0.5 text-[11px] font-semibold text-ink-3 hover:text-ink">
              Tout l&rsquo;événement
            </button>
          )}
        </div>
        {invalid && <p className="mt-0.5 text-[10px] text-red">L&rsquo;heure de fin doit être après le début.</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold" style={{ color: accent.ink }}>
        {icon}
        {label}
        <span className="truncate font-normal opacity-70">{none ? "— tout l'événement" : "— jours et moment fort"}</span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(days.length, 4)}, minmax(0, 1fr))` }}>
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
