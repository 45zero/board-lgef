"use client";

// Encart repliable « Vidéo à remettre » au-dessus des mails de l'accueil (mediaDeliveriesCore.ts).
//   TeamMedia : ses remises en retard (rouge, l'encart reste tant que ce n'est pas remis), du jour
//   (orange) ou dont la date par défaut est à confirmer ; déposer, « C'est remis », « Contacter mon N+1 ».
//   Cloche orange = relancé (clic : « vu ») ; rouge = relancé à nouveau (pop-up plein écran + wizz).
//   N+1 : retards de son équipe ; cloche pour relancer (orange, puis rouge), nouvelle date, remis.

import { useState } from "react";
import { BellRing, Camera, CalendarClock, Check, ChevronRight, ExternalLink, Loader2, Mail, MessageSquare, Send, Video } from "lucide-react";
import { EventArrow, useOpenEvent } from "@/components/board/calendar/EventOpener";
import {
  ackDeliveryReminder,
  contactManagerAboutDelivery,
  markDelivered,
  remindDelivery,
  setDeliveryDate,
  setMyDeliveryDate,
} from "@/app/actions/media-deliveries";
import type { DeliveriesBoard, DeliveryItem, DeliveryRole } from "@/lib/board/mediaDeliveriesCore";

export const DELIVERY_WHAT: Record<DeliveryRole, string> = { photo: "Les photos", video: "La vidéo", both: "Les photos et la vidéo" };

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
const parisDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
const todayDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

function RoleIcon({ role }: { role: DeliveryRole }) {
  return role === "photo" ? <Camera size={15} /> : <Video size={15} />;
}

function when(d: DeliveryItem) {
  if (d.state === "late") return `Attendue le ${dayLabel(d.dueAt)} · en retard de ${d.lateDays} jour${d.lateDays > 1 ? "s" : ""}`;
  if (d.state === "today") return "À remettre aujourd'hui, avant 23 h 59";
  return `Date de remise proposée : ${dayLabel(d.dueAt)}`;
}

/** Petite cloche de relance : orange (1re relance), rouge (2e). */
function Bell({ level, title, onClick, busy }: { level: 0 | 1 | 2; title: string; onClick?: () => void; busy?: boolean }) {
  const color = level === 2 ? "bg-[#E1141B] text-white" : level === 1 ? "bg-[#F59E0B] text-white" : "border border-line bg-card text-ink-3 hover:text-ink";
  const cls = `flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-card transition ${color}`;
  const icon = busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={15} strokeWidth={2.5} />;
  if (!onClick)
    return (
      <span title={title} aria-label={title} className={cls}>
        {icon}
      </span>
    );
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className={`${cls} hover:-translate-y-px`}>
      {icon}
    </button>
  );
}

const btn = "flex items-center gap-1 rounded-btn border border-line bg-card px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover disabled:opacity-60";
const btnRed = "flex items-center gap-1 rounded-btn bg-red px-2.5 py-1.5 text-xs font-bold text-white shadow-btn-red disabled:opacity-60";

type Result = { ok: boolean; error?: string };

/** « Contacter mon N+1 » : message (cloche + e-mail), avec son adresse e-mail en direct si connue. */
export function ContactManagerForm({
  item,
  onSent,
  onCancel,
}: {
  item: Pick<DeliveryItem, "id" | "manager" | "eventTitle" | "role">;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = item.manager;
  const send = async () => {
    setBusy(true);
    setError(null);
    const res = await contactManagerAboutDelivery(item.id, text).catch(() => ({ ok: false as const, error: "Envoi impossible pour le moment." }));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onSent();
  };
  return (
    <div className="space-y-2 rounded-card border border-line bg-card p-3 text-left">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-bold text-ink">{m ? `À ${m.name} (N+1)` : "À votre N+1"}</span>
        {m?.email && (
          <a
            href={`mailto:${m.email}?subject=${encodeURIComponent(`${DELIVERY_WHAT[item.role]} — ${item.eventTitle}`)}`}
            className="flex items-center gap-1 font-semibold text-link hover:underline"
          >
            <Mail size={12} /> E-mail
          </a>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
        placeholder="Où en êtes-vous ? Quand pouvez-vous remettre vos fichiers ?"
        className="w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm text-ink outline-none focus:border-link"
      />
      {error && <div className="rounded-btn bg-bad-bg px-3 py-1.5 text-xs font-semibold text-bad">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btn}>
          Annuler
        </button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => void send()} className={btnRed}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Envoyer
        </button>
      </div>
    </div>
  );
}

function useRunner(onChanged: () => void, onError?: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<Result>) => {
    setBusy(key);
    setError(null);
    const res = await fn().catch((): Result => ({ ok: false, error: "Action impossible pour le moment." }));
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "Action impossible.");
      onError?.();
      return;
    }
    onChanged();
  };
  return { busy, error, run };
}

function MineRow({ d, onChanged }: { d: DeliveryItem; onChanged: () => void }) {
  const { open } = useOpenEvent();
  const [contact, setContact] = useState(false);
  const [day, setDay] = useState(parisDay(d.dueAt));
  const [level, setLevel] = useState(d.reminderLevel);
  const { busy, error, run } = useRunner(onChanged, () => setLevel(d.reminderLevel));
  const late = d.state === "late";
  return (
    <div className={`rounded-card border-l-4 bg-card p-3 shadow-card ${late ? "border-[#E1141B]" : "border-[#F59E0B]"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${late ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>
          <RoleIcon role={d.role} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold leading-tight text-ink">
            {DELIVERY_WHAT[d.role]} · {d.eventTitle}
          </div>
          <div className={`mt-0.5 text-xs font-semibold ${late ? "text-bad" : "text-warn"}`}>{when(d)}</div>
          {d.remindedBy && level > 0 && <div className="mt-0.5 text-[11px] text-ink-3">Relancé par {d.remindedBy}</div>}
        </div>
        <EventArrow eventId={d.eventId} className="mt-0.5" />
        {level > 0 && (
          <Bell
            level={level}
            busy={busy === "ack"}
            title={level === 1 ? "Relance de votre N+1 — cliquer pour indiquer que vous l'avez vue" : "Relancé à nouveau : remettez vos fichiers ou répondez à votre N+1"}
            onClick={
              level === 1
                ? () => {
                    setLevel(0);
                    void run("ack", () => ackDeliveryReminder(d.id));
                  }
                : undefined
            }
          />
        )}
      </div>

      {d.state === "confirm" && !d.dueConfirmed && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-btn bg-panel px-2.5 py-2 text-xs">
          <CalendarClock size={14} className="text-ink-3" />
          <span className="font-semibold text-ink-2">Votre date de remise :</span>
          <input
            type="date"
            value={day}
            min={todayDay()}
            max={d.maxDay}
            onChange={(e) => setDay(e.target.value)}
            className="rounded-btn border border-line bg-card px-2 py-1 text-xs outline-none focus:border-link"
          />
          <button type="button" disabled={!!busy || !day} onClick={() => void run("date", () => setMyDeliveryDate(d.eventId, day))} className={btnRed}>
            {busy === "date" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Valider
          </button>
          {d.maxDay && <span className="text-[11px] text-ink-4">Au plus tard le {dayLabel(`${d.maxDay}T12:00:00`)}</span>}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={() => void open(d.eventId)} className={btnRed}>
          <ExternalLink size={12} /> Déposer mes fichiers
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => window.confirm("Vos fichiers sont-ils bien remis (déposés ou envoyés) ?") && void run("done", () => markDelivered(d.id))}
          className={btn}
        >
          {busy === "done" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} C&rsquo;est remis
        </button>
        {(late || level > 0) && (
          <button type="button" onClick={() => setContact((v) => !v)} className={btn}>
            <MessageSquare size={12} /> Contacter mon N+1
          </button>
        )}
      </div>
      {contact && (
        <div className="mt-2">
          <ContactManagerForm
            item={d}
            onCancel={() => setContact(false)}
            onSent={() => {
              setContact(false);
              setLevel(0);
              onChanged();
            }}
          />
        </div>
      )}
      {error && <div className="mt-2 rounded-btn bg-bad-bg px-3 py-1.5 text-xs font-semibold text-bad">{error}</div>}
    </div>
  );
}

function TeamRow({ d, onChanged }: { d: DeliveryItem; onChanged: () => void }) {
  const [level, setLevel] = useState(d.reminderLevel);
  const [dating, setDating] = useState(false);
  const [day, setDay] = useState(todayDay());
  const { busy, error, run } = useRunner(onChanged, () => setLevel(d.reminderLevel));
  const remindTitle =
    level === 0
      ? "Relancer (notification et e-mail)"
      : level === 1
        ? "Relancée une fois — relancer à nouveau : message plein écran avec wizz sur son board"
        : "Relancée deux fois : le message plein écran reste affiché sur son board — relancer encore (notification et e-mail)";
  return (
    <div className="rounded-card border-l-4 border-[#E1141B] bg-card p-3 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bad-bg text-bad">
          <RoleIcon role={d.role} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold leading-tight text-ink">{d.person?.name ?? "—"}</div>
          <div className="text-xs text-ink-2">
            {DELIVERY_WHAT[d.role]} · {d.eventTitle}
          </div>
          <div className="mt-0.5 text-xs font-semibold text-bad">{when(d)}</div>
        </div>
        <EventArrow eventId={d.eventId} className="mt-0.5" />
        <Bell
          level={level}
          busy={busy === "remind"}
          title={remindTitle}
          onClick={() => {
            setLevel((l) => Math.min(2, l + 1) as 1 | 2);
            void run("remind", () => remindDelivery(d.id));
          }}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {d.person?.email && (
          <a href={`mailto:${d.person.email}?subject=${encodeURIComponent(`${DELIVERY_WHAT[d.role]} — ${d.eventTitle}`)}`} className={btn}>
            <Mail size={12} /> E-mail
          </a>
        )}
        <button type="button" onClick={() => setDating((v) => !v)} className={btn}>
          <CalendarClock size={12} /> Nouvelle date
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => window.confirm(`Les fichiers de ${d.person?.name ?? "cette personne"} sont-ils bien remis ?`) && void run("done", () => markDelivered(d.id))}
          className={btn}
        >
          {busy === "done" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Remis
        </button>
        {level > 0 && <span className="text-[11px] font-semibold text-ink-3">{level === 1 ? "Relancée (cloche orange)" : "Relancée à nouveau (pop-up plein écran)"}</span>}
      </div>
      {dating && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-btn bg-panel px-2.5 py-2 text-xs">
          <input
            type="date"
            value={day}
            min={todayDay()}
            onChange={(e) => setDay(e.target.value)}
            className="rounded-btn border border-line bg-card px-2 py-1 text-xs outline-none focus:border-link"
          />
          <button type="button" disabled={!!busy || !day} onClick={() => void run("date", () => setDeliveryDate(d.id, day))} className={btnRed}>
            {busy === "date" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Fixer la date
          </button>
        </div>
      )}
      {error && <div className="mt-2 rounded-btn bg-bad-bg px-3 py-1.5 text-xs font-semibold text-bad">{error}</div>}
    </div>
  );
}

export function MediaDeliveriesPanel({ deliveries, onChanged }: { deliveries: DeliveriesBoard | undefined; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const mine = deliveries?.mine ?? [];
  const team = deliveries?.team ?? [];
  if (!mine.length && !team.length) return null;
  const mineLate = mine.filter((d) => d.state === "late").length;
  const urgent = mineLate > 0 || team.length > 0;
  const total = mine.length + team.length;
  // Barre compacte : flèche qui clignote + « Vidéo à remettre » ; un clic déplie les encarts en glissant.
  const label = mine.length
    ? `${mine.length > 1 ? "Vidéos" : "Vidéo"} à remettre${mineLate ? " · en retard" : ""}`
    : `${team.length > 1 ? "Vidéos" : "Vidéo"} en retard dans l'équipe`;
  const tone = urgent ? "text-bad" : "text-warn";
  return (
    <section className={`min-w-0 rounded-panel border-2 shadow-card ${urgent ? "border-[#E1141B] bg-bad-bg" : "border-[#F59E0B] bg-warn-bg"}`} aria-live="polite">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <ChevronRight size={18} strokeWidth={3} className={`shrink-0 transition-transform duration-300 ${tone} ${open ? "rotate-90" : "animate-pulse"}`} />
        <Video size={15} className={`shrink-0 ${tone}`} />
        <span className={`min-w-0 flex-1 truncate text-sm font-extrabold ${tone}`}>{label}</span>
        <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white ${urgent ? "bg-[#E1141B]" : "bg-[#F59E0B]"}`}>
          {total}
        </span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-4 px-3 pb-3">
            {mine.length > 0 && (
              <div className="space-y-2">
                {team.length > 0 && <h3 className={`text-xs font-extrabold ${mineLate ? "text-bad" : "text-warn"}`}>Mes remises</h3>}
                {mine.map((d) => (
                  <MineRow key={`${d.id}:${d.reminderLevel}:${d.dueAt}`} d={d} onChanged={onChanged} />
                ))}
              </div>
            )}
            {team.length > 0 && (
              <div className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-bad">
                  <BellRing size={12} /> Votre équipe : {team.length} remise{team.length > 1 ? "s" : ""} en retard
                </h3>
                {team.map((d) => (
                  <TeamRow key={`${d.id}:${d.reminderLevel}:${d.dueAt}`} d={d} onChanged={onChanged} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
