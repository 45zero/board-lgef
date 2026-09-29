"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import type { FacebookRegion } from "@/lib/social/targets";
import { matchLabel, type MatchInput, type PersonLite, type PhotoStatus, type WeekendData, type WeekendMatch } from "@/lib/board/weekend";

// Module Week-end — matchs du week-end (events.event_type = 'match_du_week_end') avec leur affiche
// (match_details) et leur poste photo (photo_missions), voir sql/2026-09-29_reseau_photo.sql.
// Coordinateurs (admins, super users, réseau salarié) : saisie des matchs, envoi au réseau,
// désignation. Photographes (spécialité tech-photo) : « Je prends », premier arrivé premier servi.

const PHOTO_SLUG = "tech-photo";
const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;

type Profile = { id: string; first_name: string | null; last_name: string | null; email: string | null };

function toPerson(p: Profile): PersonLite {
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "Utilisateur";
  return { id: p.id, name, firstName: p.first_name?.trim() || name.split(" ")[0] };
}

async function getViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const [{ data: profile }, { data: specs }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", userId).single(),
    supabase.from("profile_specialties").select("specialties(slug)").eq("user_id", userId),
  ]);
  const slugs = ((specs ?? []) as unknown as { specialties: { slug: string } | null }[]).map((s) => s.specialties?.slug);
  const isAdmin = profile?.role === "admin" || profile?.role === "super_user";
  const canCoordinate = isAdmin || slugs.includes("tech-salarie");
  return { supabase, userId, isAdmin, canCoordinate, isPhotographer: slugs.includes(PHOTO_SLUG) };
}

async function requireCoordinator() {
  const viewer = await getViewer();
  if (!viewer.canCoordinate) throw new Error("Réservé aux coordinateurs du réseau photo.");
  return viewer;
}

async function getPhotoSpecialtyId(service: ReturnType<typeof createServiceClient>) {
  const { data } = await service.from("specialties").select("id").eq("slug", PHOTO_SLUG).single();
  if (!data) throw new Error("Spécialité « Photographe » absente — migration sql/2026-09-29_reseau_photo.sql non appliquée.");
  return data.id;
}

async function listPhotographerIds(service: ReturnType<typeof createServiceClient>) {
  const specialtyId = await getPhotoSpecialtyId(service);
  const { data } = await service.from("profile_specialties").select("user_id").eq("specialty_id", specialtyId);
  return (data ?? []).map((r) => r.user_id);
}

async function notify(
  userIds: (string | null | undefined)[],
  params: { title: string; message: string; eventId?: string | null; type?: "coverage_request" | "coverage_assignment" | "coverage_accepted_admin" }
) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  const { error } = await createServiceClient()
    .from("notifications")
    .insert(
      ids.map((user_id) => ({
        user_id,
        type: params.type ?? "coverage_request",
        title: params.title,
        message: params.message,
        event_id: params.eventId ?? null,
        data: { app: "weekend", event_id: params.eventId ?? null },
      }))
    );
  if (error) console.error("[weekend.notify]", error);
}

async function actorName(userId: string) {
  const { data } = await createServiceClient().from("profiles").select("id, first_name, last_name, email").eq("id", userId).single();
  return data ? toPerson(data).name : "Quelqu'un";
}

/** Matchs du week-end [startISO, endISO[ : affiche, poste photo, vidéo, photos déposées. */
export async function getWeekend(startISO: string, endISO: string): Promise<WeekendData> {
  const { supabase, userId, isAdmin, canCoordinate, isPhotographer } = await getViewer();

  const { data: events, error } = await supabase
    .from("events")
    .select("id, title, start_date, location")
    .eq("event_type", "match_du_week_end")
    .gte("start_date", startISO)
    .lt("start_date", endISO)
    .order("start_date");
  if (error) throw new Error(error.message);
  const ids = (events ?? []).map((e) => e.id);

  const service = createServiceClient();
  const [details, missions, coverage, files, publications, photographerIds, settings] = await Promise.all([
    ids.length ? supabase.from("match_details").select("*").in("event_id", ids) : Promise.resolve({ data: [] }),
    // RLS : les brouillons ne remontent que pour les coordinateurs.
    ids.length ? supabase.from("photo_missions").select("*").in("event_id", ids) : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("coverage_requests")
          .select("event_id, status, technician_response, assigned_technician_name")
          .in("event_id", ids)
          .neq("status", "cancelled")
      : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("event_files").select("event_id").in("event_id", ids).like("content_type", "image%") : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("media_publications").select("event_id").in("event_id", ids).in("kind", ["photo", "gallery"]).eq("status", "published")
      : Promise.resolve({ data: [] }),
    canCoordinate ? listPhotographerIds(service) : Promise.resolve([] as string[]),
    canCoordinate ? service.from("board_settings").select("publisher_ids").eq("id", true).single() : Promise.resolve({ data: null }),
  ]);

  const missionRows = (missions.data ?? []) as { id: string; event_id: string; status: PhotoStatus; photographer_id: string | null; publisher_id: string | null }[];
  const publisherIds = (settings.data as { publisher_ids: string[] } | null)?.publisher_ids ?? [];
  const personIds = [
    ...new Set([...missionRows.flatMap((m) => [m.photographer_id, m.publisher_id]), ...photographerIds, ...publisherIds].filter((id): id is string => !!id)),
  ];
  const { data: profiles } = personIds.length
    ? await service.from("profiles").select("id, first_name, last_name, email").in("id", personIds)
    : { data: [] as Profile[] };
  const people = new Map((profiles ?? []).map((p) => [p.id, toPerson(p)]));

  const detailsBy = new Map(((details.data ?? []) as { event_id: string; competition: string; home_team: string; home_level: string | null; away_team: string; away_level: string | null; regions: string[] }[]).map((d) => [d.event_id, d]));
  const missionBy = new Map(missionRows.map((m) => [m.event_id, m]));
  const coverageBy = new Map(((coverage.data ?? []) as { event_id: string; status: string | null; technician_response: string | null; assigned_technician_name: string | null }[]).map((c) => [c.event_id, c]));
  const photoCount = new Map<string, number>();
  for (const f of (files.data ?? []) as { event_id: string }[]) photoCount.set(f.event_id, (photoCount.get(f.event_id) ?? 0) + 1);
  const published = new Set(((publications.data ?? []) as { event_id: string }[]).map((p) => p.event_id));

  const matches: WeekendMatch[] = (events ?? []).map((e) => {
    const d = detailsBy.get(e.id);
    const m = missionBy.get(e.id);
    const c = coverageBy.get(e.id);
    return {
      eventId: e.id,
      title: e.title,
      start: e.start_date,
      location: e.location ?? "",
      details: d
        ? {
            competition: d.competition,
            homeTeam: d.home_team,
            homeLevel: d.home_level ?? "",
            awayTeam: d.away_team,
            awayLevel: d.away_level ?? "",
            regions: d.regions as FacebookRegion[],
          }
        : null,
      photo: m
        ? {
            missionId: m.id,
            status: m.status,
            photographer: m.photographer_id ? people.get(m.photographer_id) ?? null : null,
            publisher: m.publisher_id ? people.get(m.publisher_id) ?? null : null,
          }
        : null,
      video: c
        ? {
            state:
              c.status === "rejected" || c.status === "denied"
                ? "no"
                : c.technician_response === "accepted"
                  ? "accepted"
                  : c.assigned_technician_name && c.technician_response !== "rejected"
                    ? "pending"
                    : "open",
            technician: c.assigned_technician_name,
          }
        : null,
      photoCount: photoCount.get(e.id) ?? 0,
      photosPublished: published.has(e.id),
    };
  });

  const byName = (a: PersonLite, b: PersonLite) => a.name.localeCompare(b.name, "fr");
  return {
    viewer: { id: userId, canCoordinate, isPhotographer, isAdmin },
    // Photographes : seulement les matchs proposés au réseau.
    matches: canCoordinate ? matches : matches.filter((m) => m.photo && m.photo.status !== "draft"),
    photographers: photographerIds.map((id) => people.get(id)).filter((p): p is PersonLite => !!p).sort(byName),
    publishers: publisherIds.map((id) => people.get(id)).filter((p): p is PersonLite => !!p).sort(byName),
  };
}

function validate(input: MatchInput) {
  if (!input.competition.trim() || !input.homeTeam.trim() || !input.awayTeam.trim()) throw new Error("Compétition et équipes obligatoires.");
  if (Number.isNaN(new Date(input.start).getTime())) throw new Error("Date du match invalide.");
  if (input.regions.length === 0) throw new Error("Choisissez au moins une page régionale.");
}

/** Crée (eventId absent) ou modifie un match du week-end. Renvoie l'id de l'événement. */
export async function saveMatch(input: MatchInput, eventId?: string): Promise<string> {
  const { supabase, userId } = await requireCoordinator();
  validate(input);

  const start = new Date(input.start);
  const eventFields = {
    title: matchLabel(input),
    start_date: start.toISOString(),
    end_date: new Date(start.getTime() + MATCH_DURATION_MS).toISOString(),
    location: input.location.trim() || null,
  };

  let id = eventId;
  if (id) {
    const { error } = await supabase.from("events").update(eventFields).eq("id", id).eq("event_type", "match_du_week_end");
    if (error) throw new Error(error.message);
  } else {
    // Pas de miroir Google Calendar : une trentaine de matchs par week-end encombrerait l'agenda du coordinateur.
    const { data, error } = await supabase
      .from("events")
      .insert({ ...eventFields, event_type: "match_du_week_end", organizer_id: userId, created_by: userId, status: "pending", show_in_calendar: true })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id as string;
  }

  const { error: detailsError } = await supabase.from("match_details").upsert({
    event_id: id,
    competition: input.competition.trim(),
    home_team: input.homeTeam.trim(),
    home_level: input.homeLevel.trim() || null,
    away_team: input.awayTeam.trim(),
    away_level: input.awayLevel.trim() || null,
    regions: input.regions,
  });
  if (detailsError) throw new Error(detailsError.message);

  const { data: mission } = await supabase.from("photo_missions").select("id, status, photographer_id").eq("event_id", id).maybeSingle();
  if (input.photo) {
    const designated = input.photographerId;
    const assignment = designated
      ? designated === mission?.photographer_id
        ? {}
        : { status: "taken", photographer_id: designated, taken_at: new Date().toISOString() }
      : mission?.status === "taken"
        ? { status: "open", photographer_id: null, taken_at: null }
        : {};
    if (mission) {
      const { error } = await supabase
        .from("photo_missions")
        .update({ ...assignment, publisher_id: input.publisherId, updated_at: new Date().toISOString() })
        .eq("id", mission.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("photo_missions")
        .insert({ event_id: id, status: "draft", ...assignment, publisher_id: input.publisherId, created_by: userId });
      if (error) throw new Error(error.message);
    }
    if (designated && designated !== mission?.photographer_id) {
      await notify([designated], {
        type: "coverage_assignment",
        title: "Match à photographier",
        message: `${await actorName(userId)} vous a désigné : ${eventFields.title}.`,
        eventId: id,
      });
    }
  } else if (mission) {
    const { error } = await supabase.from("photo_missions").delete().eq("id", mission.id);
    if (error) throw new Error(error.message);
  }

  if (input.video) {
    const { data: request } = await supabase.from("coverage_requests").select("id").eq("event_id", id).maybeSingle();
    if (!request) {
      const { error } = await supabase.from("coverage_requests").insert({ event_id: id, requester_id: userId, status: "pending" });
      if (error) throw new Error(error.message);
    }
    await supabase.from("events").update({ requires_coverage: true }).eq("id", id);
  }
  return id;
}

export async function deleteMatch(eventId: string) {
  await requireCoordinator();
  // Service : un coordinateur peut retirer un match saisi par un autre (RLS events : créateur ou admin).
  const { error } = await createServiceClient().from("events").delete().eq("id", eventId).eq("event_type", "match_du_week_end");
  if (error) throw new Error(error.message);
}

/** Envoie au réseau photo les postes en brouillon des matchs donnés. Une notification par photographe. */
export async function sendToNetwork(eventIds: string[]): Promise<number> {
  const { supabase, userId } = await requireCoordinator();
  if (eventIds.length === 0) return 0;
  const { data, error } = await supabase
    .from("photo_missions")
    .update({ status: "open", updated_at: new Date().toISOString() })
    .in("event_id", eventIds)
    .eq("status", "draft")
    .select("id");
  if (error) throw new Error(error.message);
  const count = data?.length ?? 0;
  if (count > 0) {
    const photographers = await listPhotographerIds(createServiceClient());
    await notify(
      photographers.filter((id) => id !== userId),
      {
        title: "Matchs à photographier",
        message: `${count} match${count > 1 ? "s" : ""} proposé${count > 1 ? "s" : ""} au réseau photo — premier arrivé, premier servi (module Week-end).`,
      }
    );
  }
  return count;
}

/** « Je prends » : le premier qui clique obtient le match. */
export async function claimMission(missionId: string) {
  const { supabase, userId } = await getViewer();
  const { data, error } = await supabase.rpc("claim_photo_mission", { p_mission: missionId });
  if (error) throw new Error(error.message);
  const mission = data as unknown as { event_id: string; created_by: string | null };
  const { data: ev } = await supabase.from("events").select("title").eq("id", mission.event_id).single();
  await notify([mission.created_by].filter((id) => id !== userId), {
    type: "coverage_accepted_admin",
    title: "Match pris",
    message: `${await actorName(userId)} photographiera ${ev?.title ?? "le match"}.`,
    eventId: mission.event_id,
  });
}

/** Le photographe se désiste avant le match : le poste repart au réseau. */
export async function releaseMission(missionId: string) {
  const { supabase, userId } = await getViewer();
  const { data, error } = await supabase.rpc("release_photo_mission", { p_mission: missionId });
  if (error) throw new Error(error.message);
  const mission = data as unknown as { event_id: string; created_by: string | null };
  const { data: ev } = await supabase.from("events").select("title").eq("id", mission.event_id).single();
  await notify([mission.created_by], {
    type: "coverage_request",
    title: "Photographe désisté",
    message: `${await actorName(userId)} ne peut plus photographier ${ev?.title ?? "le match"} — le match est de nouveau proposé au réseau.`,
    eventId: mission.event_id,
  });
}

/* ---------- Réseau photo ---------- */

/** Profils du board, pour ajouter quelqu'un au réseau photo (recherche nom / e-mail). */
export async function searchProfiles(query: string): Promise<PersonLite[]> {
  await requireCoordinator();
  const q = query.trim().replace(/[%,()]/g, " ");
  if (q.length < 2) return [];
  const { data } = await createServiceClient()
    .from("profiles")
    .select("id, first_name, last_name, email")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(10);
  return (data ?? []).map(toPerson);
}

export async function setPhotographer(profileId: string, member: boolean) {
  await requireCoordinator();
  const service = createServiceClient();
  const specialtyId = await getPhotoSpecialtyId(service);
  const { error } = member
    ? await service.from("profile_specialties").upsert({ user_id: profileId, specialty_id: specialtyId })
    : await service.from("profile_specialties").delete().eq("user_id", profileId).eq("specialty_id", specialtyId);
  if (error) throw new Error(error.message);
}
