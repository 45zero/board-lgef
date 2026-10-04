"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { isEventDictationConfigured, readDictatedEvent } from "@/lib/board/eventDictation";
import type { OrgKey } from "@/lib/board/tokens";

// Événement dicté : phrase (voix ou texte) → brouillon qui pré-remplit la fiche « Nouvel événement ».

export type EventDraft = {
  /** Phrase d'origine, rappelée en tête de la fiche. */
  text: string;
  title: string;
  org: OrgKey;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string;
  onlineMeeting: boolean;
  message: string;
  participants: { id: string; name: string; role: "responsable" | "membre" }[];
  unknownPeople: string[];
  wantsCoverage: boolean;
  /** Personne chargée de la captation (présélectionnée si l'utilisateur peut attribuer la couverture). */
  coverageAssignee: { id: string; name: string } | null;
  coverageDetails: string;
  reminders: string[];
  doubts: string[];
};

const fullName = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "—";

export async function prepareDictatedEvent(text: string): Promise<{ draft: EventDraft | null; error: string | null }> {
  const clean = text.trim().slice(0, 2000);
  if (clean.length < 5) return { draft: null, error: "Dites ou écrivez au moins le nom et la date de l'événement." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { draft: null, error: "Session expirée : reconnectez-vous." };
  if (!isEventDictationConfigured()) return { draft: null, error: "Création à la voix indisponible : remplissez la fiche à la main." };

  const { data: profiles } = await createServiceClient()
    .from("profiles")
    .select("id, first_name, last_name, email")
    .order("first_name")
    .limit(500);
  const people = (profiles ?? []).map((p) => ({ id: p.id, name: fullName(p) }));
  const me = people.find((p) => p.id === userId) ?? { id: userId, name: "Moi" };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

  try {
    const out = await readDictatedEvent({ text: clean, today, me, people });
    // Trace de diagnostic (journaux serveur) : phrase reçue et personnes retenues.
    console.info("[event-dictation]", JSON.stringify({ text: clean, responsibleIds: out?.responsibleIds, memberIds: out?.memberIds, coverageAssigneeId: out?.coverageAssigneeId, unknownPeople: out?.unknownPeople }));
    if (!out) return { draft: null, error: "Je n'ai pas compris cette demande : reformulez-la ou remplissez la fiche à la main." };
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    return {
      error: null,
      draft: {
        text: clean,
        title: out.title.trim(),
        org: out.org,
        date: out.date,
        startTime: out.startTime,
        endTime: out.endTime,
        location: out.location?.trim() ?? "",
        onlineMeeting: out.onlineMeeting,
        message: out.message.trim(),
        participants: [
          ...out.responsibleIds.map((id) => ({ id, name: nameOf.get(id) ?? "—", role: "responsable" as const })),
          ...out.memberIds.map((id) => ({ id, name: nameOf.get(id) ?? "—", role: "membre" as const })),
        ],
        unknownPeople: out.unknownPeople,
        wantsCoverage: out.wantsCoverage || !!out.coverageAssigneeId,
        coverageAssignee: out.coverageAssigneeId ? { id: out.coverageAssigneeId, name: nameOf.get(out.coverageAssigneeId) ?? "—" } : null,
        // Sans droit d'attribution, la demande part « à réattribuer » : le nom voulu figure dans les détails.
        coverageDetails: [out.coverageDetails.trim(), out.coverageAssigneeId ? `Demandée à ${nameOf.get(out.coverageAssigneeId) ?? "—"}` : ""]
          .filter(Boolean)
          .join(" — "),
        reminders: out.reminders,
        doubts: out.doubts,
      },
    };
  } catch (e) {
    console.error("[event-dictation]", e);
    return { draft: null, error: "La lecture de la demande a échoué : réessayez dans un instant." };
  }
}
