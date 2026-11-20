"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarCheck, Check, Clock, Loader2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { saveMyPresence, type PresenceDay } from "@/app/actions/event-presence";

type Row = { user_id: string; day: string; start_time: string | null; end_time: string | null; profiles: { first_name: string | null; last_name: string | null } | null };
type Mine = Record<string, { start: string; end: string }>;

const hm = (t: string | null) => (t ? t.slice(0, 5) : "");
const short = (t: string) => t.replace(":", "h").replace(/h00$/, "h");

/**
 * Fiche d'un événement sur plusieurs jours : « Ma présence » jour par jour, avec heures d'arrivée et
 * de départ facultatives, et qui vient quel jour. Une personne sollicitée est présente sur tout
 * l'événement tant qu'elle n'a rien précisé ; une autre peut dire « je viens » sur certains jours
 * (l'organisateur est prévenu). Le planning met ensuite en avant ces jours dans le bandeau.
 */
export function EventPresenceDays({ eventId, startISO, endISO, solicited }: { eventId: string; startISO: string; endISO: string; solicited: boolean }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const days = useMemo(() => {
    const start = parseISO(startISO);
    const last = new Date(parseISO(endISO).getTime() - 1);
    const n = Math.max(0, differenceInCalendarDays(last, start));
    return Array.from({ length: Math.min(n + 1, 31) }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
  }, [startISO, endISO]);

  const load = useCallback(async () => {
    const { data } = await (createClient() as unknown as SupabaseClient)
      .from("event_presence_days")
      .select("user_id, day, start_time, end_time, profiles(first_name, last_name)")
      .eq("event_id", eventId)
      .order("day");
    setRows((data ?? []) as unknown as Row[]);
  }, [eventId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  useLiveRefresh(["event_presence_days"], () => void load());

  // Mes jours : ceux enregistrés ; à défaut, tous si je suis sollicité (présent sur tout l'événement).
  const hasOwnRows = !!rows && !!user && rows.some((r) => r.user_id === user.id);
  const savedMine = useMemo<Mine>(() => {
    if (!rows || !user) return {};
    const own = rows.filter((r) => r.user_id === user.id);
    if (own.length) return Object.fromEntries(own.map((r) => [r.day, { start: hm(r.start_time), end: hm(r.end_time) }]));
    return solicited ? Object.fromEntries(days.map((d) => [d, { start: "", end: "" }])) : {};
  }, [rows, user, solicited, days]);
  const current = dirty && mine ? mine : savedMine;

  const edit = (next: Mine) => {
    setMine(next);
    setDirty(true);
    setSaved(false);
    setError(null);
  };
  const toggle = (day: string) => {
    const next = { ...current };
    if (next[day]) delete next[day];
    else next[day] = { start: "", end: "" };
    edit(next);
  };
  const setTime = (day: string, key: "start" | "end", value: string) => edit({ ...current, [day]: { ...current[day], [key]: value } });

  const chosen = days.filter((d) => current[d]);
  const save = async () => {
    setSaving(true);
    setError(null);
    const allDaysNoHours = chosen.length === days.length && chosen.every((d) => !current[d].start && !current[d].end);
    // Sollicité, tous les jours sans heure : retour à « tout l'événement » (aucune ligne).
    const payload: PresenceDay[] = solicited && allDaysNoHours ? [] : chosen.map((d) => ({ day: d, start: current[d].start || null, end: current[d].end || null }));
    const res = await saveMyPresence(eventId, payload);
    setSaving(false);
    if (res.error) return setError(res.error);
    setDirty(false);
    setMine(null);
    setSaved(true);
    void load();
  };

  // Qui vient quel jour (jours précisés ; les sollicités sans précision sont là tous les jours).
  const others = useMemo(() => {
    const byDay = new Map<string, { name: string; hours: string }[]>();
    for (const r of rows ?? []) {
      if (r.user_id === user?.id) continue;
      const name = `${r.profiles?.first_name ?? ""} ${r.profiles?.last_name ?? ""}`.trim() || "—";
      const hours = r.start_time || r.end_time ? `${short(hm(r.start_time) || "…")}–${short(hm(r.end_time) || "…")}` : "";
      byDay.set(r.day, [...(byDay.get(r.day) ?? []), { name, hours }]);
    }
    return byDay;
  }, [rows, user]);

  const dayParts = (d: string) => {
    const date = new Date(`${d}T12:00:00`);
    return { weekday: format(date, "EEE", { locale: fr }), num: format(date, "d MMM", { locale: fr }) };
  };
  // Une personne sollicitée ne « décline » pas ici (bouton Répondre de la barre du bas) : au moins un jour.
  const canSave = dirty && (chosen.length > 0 || (!solicited && hasOwnRows));
  const buttonLabel = !solicited && !hasOwnRows ? "Je viens" : chosen.length === 0 ? "Je ne viens plus" : "Enregistrer mes jours";

  return (
    <div className="rounded-btn border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
          <CalendarCheck size={12} /> Ma présence
        </div>
        <span className="text-[11px] text-ink-4">
          {solicited && !hasOwnRows && !dirty
            ? "Présent sur tout l'événement — décochez les jours où vous ne venez pas"
            : chosen.length === 0
              ? "Choisissez le ou les jours où vous venez"
              : `${chosen.length} jour${chosen.length > 1 ? "s" : ""} sur ${days.length}`}
        </span>
      </div>

      {rows === null ? (
        <div className="flex items-center gap-2 py-2 text-xs text-ink-4">
          <Loader2 size={13} className="animate-spin" /> Chargement…
        </div>
      ) : (
        <>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(days.length, 7)}, minmax(0, 1fr))` }}>
            {days.map((d) => {
              const on = !!current[d];
              const who = others.get(d) ?? [];
              const { weekday, num } = dayParts(d);
              return (
                <div key={d} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => toggle(d)}
                    aria-pressed={on}
                    className={`flex w-full flex-col items-center rounded-btn border px-1 py-1.5 text-center transition-colors ${
                      on ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-3 hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    <span className="text-[10px] font-mono uppercase tracking-wide opacity-80">{weekday}</span>
                    <span className="whitespace-nowrap text-[13px] font-extrabold leading-tight">{num}</span>
                    <span className="mt-0.5 flex h-3 items-center">{on && <Check size={11} />}</span>
                  </button>
                  {on && (
                    <div className="mt-1 space-y-0.5">
                      <input
                        type="time"
                        value={current[d].start}
                        onChange={(e) => setTime(d, "start", e.target.value)}
                        title="Arrivée (facultatif)"
                        aria-label={`Arrivée le ${weekday} ${num}`}
                        className="w-full rounded border border-line px-1 py-0.5 font-mono text-[10px] outline-none focus:border-link"
                      />
                      <input
                        type="time"
                        value={current[d].end}
                        onChange={(e) => setTime(d, "end", e.target.value)}
                        title="Départ (facultatif)"
                        aria-label={`Départ le ${weekday} ${num}`}
                        className="w-full rounded border border-line px-1 py-0.5 font-mono text-[10px] outline-none focus:border-link"
                      />
                    </div>
                  )}
                  {who.length > 0 && (
                    <div className="mt-1 space-y-0.5" title={who.map((w) => `${w.name}${w.hours ? ` ${w.hours}` : ""}`).join("\n")}>
                      {who.slice(0, 3).map((w, i) => (
                        <div key={i} className="truncate text-[10px] text-ink-3">
                          {w.name.split(" ")[0]}
                          {w.hours && <span className="text-ink-4"> {w.hours}</span>}
                        </div>
                      ))}
                      {who.length > 3 && <div className="text-[10px] font-semibold text-ink-4">+{who.length - 3}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[10px] text-ink-4">
              <Clock size={10} /> Arrivée / départ facultatifs — visibles dans votre planning ces jours-là.
            </span>
            <div className="flex items-center gap-2">
              {saved && !dirty && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-good">
                  <Check size={12} /> Enregistré
                </span>
              )}
              {dirty && (
                <button
                  type="button"
                  onClick={() => {
                    setDirty(false);
                    setMine(null);
                  }}
                  className="text-[11px] font-semibold text-ink-4 hover:text-ink"
                >
                  Annuler
                </button>
              )}
              {(dirty || (!solicited && !hasOwnRows)) && (
                <button
                  type="button"
                  disabled={saving || !canSave}
                  onClick={() => void save()}
                  className="flex items-center gap-1 rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  {buttonLabel}
                </button>
              )}
            </div>
          </div>
          {error && <p className="mt-1.5 text-[11px] text-bad">{error}</p>}
        </>
      )}
    </div>
  );
}
