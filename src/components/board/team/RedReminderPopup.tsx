"use client";

// Relance rouge (2e relance sans réaction) : message en pop-up sur le board de la personne, avec un
// « wizz » (son + fenêtre qui tremble). Il reste ouvert tant qu'elle n'a pas mis à jour son statut sur
// la carte ; « Ouvrir la carte » le masque le temps de la consulter, il revient s'il n'y a pas de mise à jour.

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, ExternalLink, Loader2 } from "lucide-react";
import { myRedReminders, setMyCardStatus } from "@/app/actions/team";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useOpenTeamCard } from "@/components/board/team/TeamCardOpener";
import { MEMBER_STATUSES, type MemberStatus } from "@/lib/board/team";

type Reminder = { cardId: string; title: string; dueAt: string | null; status: MemberStatus; remindedAt: string | null; by: string | null };

// Son : les navigateurs (Safari surtout) n'autorisent l'audio qu'après un geste de l'utilisateur dans la
// page. Le lecteur est donc créé / débloqué au premier clic ou touche n'importe où sur le board, puis
// gardé : une relance qui arrive plus tard peut sonner. Page jamais touchée depuis son ouverture : pas de
// son (le pop-up et le tremblement restent).
let audio: AudioContext | null = null;

function unlockAudio() {
  try {
    if (!audio) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audio = new Ctx();
    }
    if (audio.state === "suspended") void audio.resume();
  } catch {
    /* son indisponible */
  }
}

/** Petit « wizz » synthétisé (aucun fichier audio) : trois bourdonnements courts. */
function playWizz() {
  unlockAudio();
  const ctx = audio;
  if (!ctx || ctx.state !== "running") return;
  try {
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const start = t0 + i * 0.16;
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 180;
      lfo.frequency.value = 38;
      lfoGain.gain.value = 60;
      lfo.connect(lfoGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      lfo.start(start);
      osc.stop(start + 0.14);
      lfo.stop(start + 0.14);
    }
  } catch {
    /* son indisponible : le pop-up suffit */
  }
}

export function RedReminderPopup() {
  const { open } = useOpenTeamCard();
  const [items, setItems] = useState<Reminder[]>([]);
  const [hidden, setHidden] = useState<string | null>(null);
  const [saving, setSaving] = useState<MemberStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const played = useRef(new Set<string>());

  const load = useCallback(async () => {
    const res = await myRedReminders().catch(() => null);
    if (res?.ok) setItems(res.data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load();
  }, [load]);

  // Débloque le son au premier geste sur le board (voir unlockAudio).
  useEffect(() => {
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", unlockAudio, opts);
    window.addEventListener("keydown", unlockAudio, opts);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio, opts);
      window.removeEventListener("keydown", unlockAudio, opts);
    };
  }, []);
  useLiveRefresh(["team_card_members", "notifications"], () => {
    setHidden(null);
    void load();
  }, 400);

  const current = items.find((r) => r.cardId !== hidden) ?? null;
  const key = current ? `${current.cardId}:${current.remindedAt ?? ""}` : null;

  // Wizz une seule fois par relance (pas à chaque rechargement).
  useEffect(() => {
    if (!key || played.current.has(key)) return;
    played.current.add(key);
    playWizz();
    setShake((n) => n + 1);
  }, [key]);

  if (!current) return null;

  const choose = async (status: MemberStatus) => {
    setSaving(status);
    setError(null);
    const res = await setMyCardStatus(current.cardId, status).catch(() => ({ ok: false as const, error: "Statut impossible à changer pour le moment." }));
    setSaving(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setItems((list) => list.filter((r) => r.cardId !== current.cardId));
  };

  const due = current.dueAt ? new Date(current.dueAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="alertdialog" aria-modal="true" aria-labelledby="red-reminder-title">
      <style>{`@keyframes lgef-wizz{0%,100%{transform:translate(0,0)}10%{transform:translate(-9px,3px)}20%{transform:translate(8px,-4px)}30%{transform:translate(-7px,-3px)}40%{transform:translate(7px,4px)}50%{transform:translate(-5px,2px)}60%{transform:translate(5px,-2px)}70%{transform:translate(-3px,1px)}80%{transform:translate(2px,-1px)}}`}</style>
      <div
        key={shake}
        className="w-full max-w-sm overflow-hidden rounded-panel border border-line bg-card shadow-card"
        style={{ animation: shake ? "lgef-wizz 0.7s ease-in-out" : undefined }}
      >
        <div className="flex items-center gap-2.5 bg-[#E1141B] px-4 py-3 text-white">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
            <BellRing size={17} strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <div id="red-reminder-title" className="text-sm font-extrabold leading-tight">
              {current.by ? `${current.by} vous relance à nouveau` : "Vous êtes relancé à nouveau"}
            </div>
            <div className="text-[11px] font-semibold opacity-90">Mettez à jour votre statut sur la carte</div>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <div className="text-[15px] font-extrabold leading-snug text-ink">{current.title}</div>
            {due && <div className="mt-0.5 text-xs text-ink-3">Échéance : {due}</div>}
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-4">Où en êtes-vous ?</div>
            <div className="grid grid-cols-3 gap-1.5">
              {MEMBER_STATUSES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  disabled={!!saving}
                  onClick={() => void choose(st.id)}
                  className={`flex flex-col items-center gap-1 rounded-card border px-2 py-2 text-xs font-bold transition hover:-translate-y-px hover:shadow-card disabled:opacity-60 ${current.status === st.id ? "border-line-strong bg-panel" : "border-line"}`}
                >
                  {saving === st.id ? <Loader2 size={14} className="animate-spin text-ink-3" /> : <span className="h-3 w-3 rounded-full" style={{ background: st.color }} />}
                  <span className="text-ink">{st.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-4">Statut actuel : {MEMBER_STATUSES.find((s) => s.id === current.status)?.label}. Le confirmer suffit à répondre.</p>
          </div>
          {error && <div className="rounded-btn bg-bad-bg px-3 py-2 text-xs font-semibold text-bad">{error}</div>}
          <button
            type="button"
            onClick={() => {
              setHidden(current.cardId);
              open(current.cardId);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-btn border border-line px-3 py-2 text-xs font-semibold text-link hover:bg-hover"
          >
            <ExternalLink size={13} /> Ouvrir la carte
          </button>
        </div>
      </div>
    </div>
  );
}
