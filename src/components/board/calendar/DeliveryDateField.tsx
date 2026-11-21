"use client";

// Date de remise des fichiers, demandée au TeamMedia au moment où il accepte une captation : proposée
// d'après le réglage des administrateurs (délai photo / vidéo après l'événement), jamais au-delà du
// délai maximum (Paramètres → Publication). Enregistrée par setMyDeliveryDate après l'acceptation.

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { deliveryDateBounds, setMyDeliveryDate } from "@/app/actions/media-deliveries";
import type { DeliveryRole } from "@/lib/board/mediaDeliveriesCore";

type Bounds = { minDay: string; defaultDay: string; maxDay: string };

const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/** Champ de date ; `onChange` reçoit tout de suite la date proposée, puis chaque changement. */
export function DeliveryDateField({ eventId, role, value, onChange }: { eventId: string; role: DeliveryRole | null | undefined; value: string; onChange: (day: string) => void }) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  useEffect(() => {
    let cancelled = false;
    void deliveryDateBounds(eventId, role ?? null)
      .then((res) => {
        if (cancelled || !res.ok) return;
        setBounds(res.data);
        onChange(res.data.defaultDay);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargé une fois par événement / rôle
  }, [eventId, role]);
  return (
    <div className="space-y-1 rounded-btn bg-panel px-2.5 py-2 text-left text-xs">
      <label className="flex flex-wrap items-center gap-2">
        <CalendarClock size={13} className="text-ink-3" />
        <span className="font-semibold text-ink-2">Je remets mes fichiers au plus tard le</span>
        <input
          type="date"
          value={value}
          min={bounds?.minDay}
          max={bounds?.maxDay}
          disabled={!bounds}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-btn border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-link"
        />
      </label>
      {bounds && <p className="text-[11px] text-ink-4">Au plus tard le {label(bounds.maxDay)}. Passé cette date, votre N+1 est alerté.</p>}
    </div>
  );
}

/** Enregistre la date choisie après l'acceptation (sans bloquer : la date par défaut s'applique sinon). */
export async function saveDeliveryDate(eventId: string, day: string) {
  if (!day) return;
  const res = await setMyDeliveryDate(eventId, day).catch(() => null);
  if (res && !res.ok) console.warn("[saveDeliveryDate]", res.error);
}
