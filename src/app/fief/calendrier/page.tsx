"use client";

import { CalendarDays } from "lucide-react";
import { ComingSoon, MemberGate } from "@/components/fief/ui";

// Calendrier FIEF (lot 2) : les événements du board que l'équipe FIEF rend « Visible sur FIEF ».

export default function FiefCalendarPage() {
  return (
    <MemberGate>
      {() => (
        <div className="space-y-4">
          <h1 className="text-2xl font-extrabold">Calendrier</h1>
          <ComingSoon
            icon={CalendarDays}
            title="Le calendrier arrive bientôt"
            text="Vous y retrouverez les réunions, formations et rencontres FIEF, et serez prévenue par notification quand un événement vous concerne."
          />
        </div>
      )}
    </MemberGate>
  );
}
