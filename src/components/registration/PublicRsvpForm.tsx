"use client";

import { useState } from "react";
import { RsvpCard } from "@/components/registration/RsvpCard";

export function PublicRsvpForm({
  eventTitle,
  eventStartDate,
  eventLocation,
  cardHtml,
  initialChoice,
  onSubmit,
}: {
  eventTitle: string;
  eventStartDate: string;
  eventLocation: string | null;
  cardHtml?: string;
  initialChoice?: "yes" | "no" | null;
  onSubmit: (data: { firstName: string; lastName: string; club: string; email: string; response: "yes" | "no" }) => Promise<void>;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [club, setClub] = useState("");
  const [email, setEmail] = useState("");

  return (
    <RsvpCard
      eventTitle={eventTitle}
      eventStartDate={eventStartDate}
      eventLocation={eventLocation}
      cardHtml={cardHtml}
      initialChoice={initialChoice}
      extraFields={
        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Prénom"
              className="min-w-0 flex-1 rounded-btn border border-line px-3 py-2 text-sm outline-none"
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Nom"
              className="min-w-0 flex-1 rounded-btn border border-line px-3 py-2 text-sm outline-none"
            />
          </div>
          <input
            value={club}
            onChange={(e) => setClub(e.target.value)}
            placeholder="Votre club"
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="Votre email (optionnel)"
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
        </div>
      }
      onSubmit={async (response) => {
        if (!firstName.trim() || !lastName.trim()) throw new Error("Merci d'indiquer votre prénom et votre nom.");
        if (!club.trim()) throw new Error("Merci d'indiquer votre club.");
        await onSubmit({ firstName: firstName.trim(), lastName: lastName.trim(), club: club.trim(), email: email.trim(), response });
      }}
    />
  );
}
