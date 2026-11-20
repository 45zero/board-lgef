"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getSolicitations } from "@/lib/board/solicitation";

// Présence jour par jour sur un événement de plusieurs jours (sql/2026-11-21_event_presence_days.sql).
// Écriture avec la session de la personne (RLS : ses propres jours). Aucune ligne = présent sur tout
// l'événement pour une personne sollicitée ; pour une autre, « je viens » sur les jours choisis —
// l'organisateur (créateur de l'événement) est alors prévenu.

export type PresenceDay = { day: string; start: string | null; end: string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const hm = (t: string | null) => (t ? t.replace(":", " h ").replace(/ h 00$/, " h") : null);
const describe = (days: PresenceDay[]) =>
  days.map((d) => `${dayLabel(d.day)}${d.start || d.end ? ` (${hm(d.start) ?? "…"} – ${hm(d.end) ?? "…"})` : ""}`).join(", ");

/** Remplace mes jours de présence sur l'événement. `days` vide : je retire mes jours. */
export async function saveMyPresence(eventId: string, days: PresenceDay[]): Promise<{ error: string | null }> {
  try {
    if (!/^[0-9a-f-]{36}$/.test(eventId)) throw new Error("Événement inconnu.");
    const clean = days
      .filter((d) => DAY.test(d.day))
      .map((d) => ({ day: d.day, start: d.start && TIME.test(d.start) ? d.start : null, end: d.end && TIME.test(d.end) ? d.end : null }));
    for (const d of clean) if (d.start && d.end && d.end <= d.start) throw new Error(`${dayLabel(d.day)} : l'heure de départ doit être après l'heure d'arrivée.`);

    const supabase = (await createClient()) as unknown as SupabaseClient;
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) throw new Error("Non authentifié.");

    const { data: before } = await supabase.from("event_presence_days").select("day, start_time, end_time").eq("event_id", eventId).eq("user_id", userId);
    const { error: delError } = await supabase.from("event_presence_days").delete().eq("event_id", eventId).eq("user_id", userId);
    if (delError) throw new Error(delError.message);
    if (clean.length) {
      const { error } = await supabase
        .from("event_presence_days")
        .insert(clean.map((d) => ({ event_id: eventId, user_id: userId, day: d.day, start_time: d.start, end_time: d.end })));
      if (error) throw new Error(error.message);
    }

    // Personne non sollicitée qui vient (ou ne vient plus) : l'organisateur est prévenu, si quelque chose a changé.
    const key = (rows: { day: string; start: string | null; end: string | null }[]) =>
      rows
        .map((r) => `${r.day}|${r.start ?? ""}|${r.end ?? ""}`)
        .sort()
        .join(",");
    const prev = ((before ?? []) as { day: string; start_time: string | null; end_time: string | null }[]).map((r) => ({
      day: r.day,
      start: r.start_time?.slice(0, 5) ?? null,
      end: r.end_time?.slice(0, 5) ?? null,
    }));
    if (key(prev) !== key(clean)) {
      const service = createServiceClient();
      const solicited = await getSolicitations(service, userId, { includePendingDirector: true, includeProposedCoverage: true });
      if (!solicited.has(eventId)) await notifyOrganizer(service, eventId, userId, clean);
    }
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
}

async function notifyOrganizer(service: ReturnType<typeof createServiceClient>, eventId: string, userId: string, days: PresenceDay[]) {
  try {
    const [{ data: event }, { data: me }] = await Promise.all([
      service.from("events").select("title, created_by").eq("id", eventId).maybeSingle(),
      service.from("profiles").select("first_name, last_name, email").eq("id", userId).maybeSingle(),
    ]);
    if (!event?.created_by || event.created_by === userId) return;
    const who = `${me?.first_name ?? ""} ${me?.last_name ?? ""}`.trim() || me?.email || "Quelqu'un";
    const { error } = await service.from("notifications").insert({
      user_id: event.created_by,
      type: "event_team_added",
      title: days.length ? `${who} viendra à « ${event.title} »` : `${who} ne viendra finalement pas à « ${event.title} »`,
      message: days.length ? `Présent ${describe(days)}.` : "Ses jours de présence ont été retirés.",
      event_id: eventId,
      actor_name: who,
      data: { event_id: eventId, presence: true },
    });
    if (error) console.error("[saveMyPresence.notify]", error.message);
  } catch (e) {
    console.error("[saveMyPresence.notify]", e);
  }
}

type RequestRow = { kind: "video" | "photo" | "cd"; day: string; start_time: string | null; end_time: string | null };
const KIND_LABEL: Record<RequestRow["kind"], string> = { video: "vidéo", photo: "photo", cd: "comité directeur" };

/**
 * Présences souhaitées d'un événement (vidéo, photo, CD) : remplace les précédentes. Les jours hors
 * des dates de l'événement sont ignorés. En base, les personnes déjà engagées dont les jours viennent
 * de la demande suivent automatiquement (sql/2026-11-21_event_presence_cascade.sql) ; ici, celles
 * dont le rôle est touché (engagées ou sollicitées) sont prévenues du changement.
 */
export async function savePresenceRequests(
  eventId: string,
  requests: Record<RequestRow["kind"], Record<string, { start: string; end: string }>>,
  startISO: string,
  endISO: string
): Promise<{ error: string | null }> {
  try {
    if (!/^[0-9a-f-]{36}$/.test(eventId)) throw new Error("Événement inconnu.");
    const supabase = (await createClient()) as unknown as SupabaseClient;
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) throw new Error("Non authentifié.");

    // Jours de l'événement (dates de Paris).
    const paris = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
    const first = paris(startISO);
    const last = paris(new Date(new Date(endISO).getTime() - 1000).toISOString());
    const rows = (["video", "photo", "cd"] as const).flatMap((kind) =>
      Object.entries(requests[kind] ?? {})
        .filter(([day]) => DAY.test(day) && day >= first && day <= last)
        .map(([day, s]) => ({
          event_id: eventId,
          kind,
          day,
          start_time: s.start && TIME.test(s.start) ? s.start : null,
          end_time: s.end && TIME.test(s.end) ? s.end : null,
          created_by: userId,
        }))
    );

    const { data: before } = await supabase.from("event_presence_requests").select("kind, day, start_time, end_time").eq("event_id", eventId);
    const { error: delError } = await supabase.from("event_presence_requests").delete().eq("event_id", eventId);
    if (delError) throw new Error(delError.message);
    if (rows.length) {
      const { error } = await supabase.from("event_presence_requests").insert(rows);
      if (error) throw new Error(error.message);
    }

    // Rôles dont la demande a changé → personnes concernées prévenues.
    const sig = (list: { kind: string; day: string; start_time: string | null; end_time: string | null }[], kind: string) =>
      list
        .filter((r) => r.kind === kind)
        .map((r) => `${r.day}|${r.start_time?.slice(0, 5) ?? ""}|${r.end_time?.slice(0, 5) ?? ""}`)
        .sort()
        .join(",");
    const changed = (["video", "photo", "cd"] as const).filter((k) => sig((before ?? []) as RequestRow[], k) !== sig(rows, k));
    if (changed.length && (before ?? []).length) await notifyRoleHolders(eventId, userId, changed, rows);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
}

async function notifyRoleHolders(eventId: string, actorId: string, kinds: RequestRow["kind"][], rows: { kind: string; day: string; start_time: string | null; end_time: string | null }[]) {
  try {
    const service = createServiceClient();
    const [{ data: event }, { data: actor }, { data: cov }, { data: crew }, { data: cds }] = await Promise.all([
      service.from("events").select("title").eq("id", eventId).maybeSingle(),
      service.from("profiles").select("first_name, last_name, email").eq("id", actorId).maybeSingle(),
      service.from("coverage_requests").select("assigned_technician_id, technician_id, technician_role, technician_response, status").eq("event_id", eventId),
      service.from("coverage_crew").select("user_id, role, status").eq("event_id", eventId),
      service.from("director_attendance").select("director_id, status").eq("event_id", eventId),
    ]);
    const roleKinds = (role: string | null) => (role === "photo" ? ["photo"] : role === "video" ? ["video"] : ["video", "photo"]);
    const targets = new Map<string, Set<string>>();
    const add = (uid: string | null, ks: string[]) => {
      if (!uid || uid === actorId) return;
      const hit = ks.filter((k) => (kinds as string[]).includes(k));
      if (!hit.length) return;
      targets.set(uid, new Set([...(targets.get(uid) ?? []), ...hit]));
    };
    for (const c of cov ?? []) if (c.status !== "cancelled" && c.technician_response !== "rejected") add(c.assigned_technician_id ?? c.technician_id, roleKinds(c.technician_role));
    for (const w of crew ?? []) if (w.status !== "declined") add(w.user_id, roleKinds(w.role));
    for (const d of cds ?? []) if (d.status !== "denied") add(d.director_id, ["cd"]);
    if (!targets.size) return;

    const who = `${actor?.first_name ?? ""} ${actor?.last_name ?? ""}`.trim() || actor?.email || "L'organisateur";
    const notifications = [...targets.entries()].map(([uid, ks]) => {
      const slots = rows
        .filter((r) => ks.has(r.kind))
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({ day: r.day, start: r.start_time, end: r.end_time }));
      return {
        user_id: uid,
        type: "assignment_updated" as const,
        title: `Jours de présence modifiés — « ${event?.title ?? "événement"} »`,
        message: slots.length
          ? `Présence ${[...ks].map((k) => KIND_LABEL[k as RequestRow["kind"]]).join(" / ")} souhaitée : ${describe(slots)}.`
          : "Plus de jour précis demandé : présence sur tout l'événement.",
        event_id: eventId,
        actor_name: who,
        data: { event_id: eventId, presence: true },
      };
    });
    const { error } = await service.from("notifications").insert(notifications);
    if (error) console.error("[savePresenceRequests.notify]", error.message);
  } catch (e) {
    console.error("[savePresenceRequests.notify]", e);
  }
}
