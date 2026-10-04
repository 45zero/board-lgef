"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { eventWhen } from "@/lib/email/notificationEmails";

// Notifications d'affectation à un événement émises par le board (ajout d'un membre ou d'un
// responsable d'équipe, désignation directe d'un technicien). Elles partent ensuite par e-mail
// comme les autres (/api/cron/notification-emails), selon les préférences de chacun.

type Kind = "membre" | "responsable" | "couverture";

async function notifyEventAssignmentImpl(eventId: string, userIds: string[], kind: Kind) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const actorId = claims?.claims?.sub;
  if (!actorId) throw new Error("Non authentifié");
  const recipients = [...new Set(userIds)].filter((id) => id !== actorId);
  if (recipients.length === 0) return;

  const service = createServiceClient();
  const [{ data: event }, { data: actor }] = await Promise.all([
    service.from("events").select("title, start_date").eq("id", eventId).single(),
    service.from("profiles").select("first_name, last_name, email").eq("id", actorId).single(),
  ]);
  if (!event) return;
  const actorName = [actor?.first_name, actor?.last_name].filter(Boolean).join(" ").trim() || actor?.email || "Quelqu'un";
  const title = {
    membre: `${actorName} vous a ajouté à un événement`,
    responsable: `${actorName} vous a désigné responsable d'un événement`,
    couverture: `${actorName} vous a désigné pour couvrir un événement`,
  }[kind];

  const { error } = await service.from("notifications").insert(
    recipients.map((user_id) => ({
      user_id,
      type: kind === "couverture" ? ("assignment_created" as const) : ("event_team_added" as const),
      title,
      message: `${event.title} — ${eventWhen(event)}`,
      actor_name: actorName,
      event_id: eventId,
      data: { event_id: eventId, role: kind },
    }))
  );
  if (error) throw new Error(error.message);
}

export async function notifyEventAssignment(eventId: string, userIds: string[], kind: Kind) {
  return toResult(() => notifyEventAssignmentImpl(eventId, userIds, kind));
}
