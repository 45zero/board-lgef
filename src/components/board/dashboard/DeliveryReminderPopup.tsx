"use client";

// Relance rouge d'une remise de photos / vidéos (2e relance du N+1 sans réaction) : message plein écran
// sur le board de la personne, avec « wizz » (son + fenêtre qui tremble). Il reste tant qu'elle n'a ni
// remis ses fichiers ni répondu à son N+1 ; « Déposer mes fichiers » le masque le temps d'ouvrir
// l'événement, il revient au prochain rechargement si rien n'est remis.

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Check, ExternalLink, Loader2, MessageSquare } from "lucide-react";
import { markDelivered, myRedDeliveryReminders } from "@/app/actions/media-deliveries";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";
import { ContactManagerForm, DELIVERY_WHAT } from "@/components/board/dashboard/MediaDeliveriesPanel";
import { listenForAudioUnlock, playWizz, WIZZ_KEYFRAMES } from "@/lib/board/wizz";
import type { DeliveryPerson, DeliveryRole } from "@/lib/board/mediaDeliveriesCore";

type Reminder = { id: string; eventId: string; eventTitle: string; role: DeliveryRole; dueAt: string; remindedAt: string | null; by: string | null; manager: DeliveryPerson | null };

export function DeliveryReminderPopup() {
  const { open } = useOpenEvent();
  const [items, setItems] = useState<Reminder[]>([]);
  const [hidden, setHidden] = useState<string | null>(null);
  const [contact, setContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const played = useRef(new Set<string>());

  const load = useCallback(async () => {
    const res = await myRedDeliveryReminders().catch(() => null);
    if (res?.ok) setItems(res.data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load();
  }, [load]);
  useEffect(() => listenForAudioUnlock(), []);
  useLiveRefresh(["media_deliveries", "notifications"], () => void load(), 400);

  const current = items.find((r) => r.id !== hidden) ?? null;
  const key = current ? `${current.id}:${current.remindedAt ?? ""}` : null;

  // Wizz une seule fois par relance (pas à chaque rechargement).
  useEffect(() => {
    if (!key || played.current.has(key)) return;
    played.current.add(key);
    playWizz();
    setShake((n) => n + 1);
  }, [key]);

  if (!current) return null;

  const done = () => {
    setItems((list) => list.filter((r) => r.id !== current.id));
    setContact(false);
    setError(null);
  };
  const delivered = async () => {
    if (!window.confirm("Vos fichiers sont-ils bien remis (déposés ou envoyés) ?")) return;
    setBusy(true);
    setError(null);
    const res = await markDelivered(current.id).catch(() => ({ ok: false as const, error: "Action impossible pour le moment." }));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    done();
  };
  const due = new Date(current.dueAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="delivery-reminder-title">
      <style>{WIZZ_KEYFRAMES}</style>
      <div
        key={shake}
        className="w-full max-w-md overflow-hidden rounded-panel border border-line bg-card shadow-card"
        style={{ animation: shake ? "lgef-wizz 0.7s ease-in-out" : undefined }}
      >
        <div className="flex items-center gap-2.5 bg-[#E1141B] px-4 py-3 text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <BellRing size={18} strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <div id="delivery-reminder-title" className="text-sm font-extrabold leading-tight">
              {current.by ? `${current.by} vous relance à nouveau` : "Vous êtes relancé à nouveau"}
            </div>
            <div className="text-[11px] font-semibold opacity-90">Vos fichiers sont attendus</div>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <div className="text-[15px] font-extrabold leading-snug text-ink">
              {DELIVERY_WHAT[current.role]} · {current.eventTitle}
            </div>
            <div className="mt-0.5 text-xs font-semibold text-bad">Attendue le {due} — en retard</div>
          </div>
          {contact ? (
            <ContactManagerForm item={current} onCancel={() => setContact(false)} onSent={done} />
          ) : (
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => {
                  setHidden(current.id);
                  void open(current.eventId);
                }}
                className="flex items-center justify-center gap-1.5 rounded-btn bg-red px-3 py-2.5 text-sm font-bold text-white shadow-btn-red"
              >
                <ExternalLink size={14} /> Déposer mes fichiers
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void delivered()}
                  className="flex items-center justify-center gap-1.5 rounded-btn border border-line px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-hover disabled:opacity-60"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} C&rsquo;est remis
                </button>
                <button
                  type="button"
                  onClick={() => setContact(true)}
                  className="flex items-center justify-center gap-1.5 rounded-btn border border-line px-3 py-2 text-xs font-semibold text-link hover:bg-hover"
                >
                  <MessageSquare size={13} /> Contacter mon N+1
                </button>
              </div>
            </div>
          )}
          {error && <div className="rounded-btn bg-bad-bg px-3 py-2 text-xs font-semibold text-bad">{error}</div>}
        </div>
      </div>
    </div>
  );
}
