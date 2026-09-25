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
  onSubmit: (data: { name: string; club: string; email: string; response: "yes" | "no" }) => Promise<void>;
}) {
  const [name, setName] = useState("");
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
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Votre nom"
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
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
        if (!name.trim()) throw new Error("Merci d'indiquer votre nom.");
        await onSubmit({ name: name.trim(), club: club.trim(), email: email.trim(), response });
      }}
    />
  );
}
