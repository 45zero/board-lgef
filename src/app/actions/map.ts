"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { parseLatLng, STAFF_KINDS, STAFF_SPECIALTY, type LatLng, type StaffKind, type StaffPin, type Travel } from "@/lib/board/geo";
import { eventPosition, geocode, travelToEvent } from "@/lib/board/travel";

// Carte du Grand Est : positions des événements et des techniciens, trajets domicile → événement
// (calculs et caches dans src/lib/board/travel.ts). Rien n'est réécrit en base.

/** Utilisateur connecté + droit de voir les domiciles des techniciens (admins, super users, réseau salarié). */
async function getViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  const [{ data: profile }, { data: specialty }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).single(),
    supabase
      .from("profile_specialties")
      .select("specialties!inner(slug)")
      .eq("user_id", user.id)
      .eq("specialties.slug", "tech-salarie")
      .maybeSingle(),
  ]);
  const canSeeStaff = profile?.role === "admin" || profile?.role === "super_user" || !!specialty;
  return { supabase, userId: user.id, canSeeStaff };
}

function displayName(p: { first_name: string | null; last_name: string | null; email: string | null }) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Utilisateur";
}

/**
 * Tous les techniciens (toute spécialité `tech-*`) et leur statut. Plusieurs statuts : le plus « interne »
 * l'emporte (salarié > réseau > prestataire > bénévole) ; aucun statut précisé : personnel de la Ligue (salarié).
 */
async function getStaffKinds(service: ReturnType<typeof createServiceClient>) {
  const { data: links } = await service.from("profile_specialties").select("user_id, specialties!inner(slug)").like("specialties.slug", "tech-%");
  const kindByUser = new Map<string, StaffKind | null>();
  for (const l of (links ?? []) as unknown as { user_id: string; specialties: { slug: string } }[]) {
    const kind = STAFF_SPECIALTY[l.specialties.slug] ?? null;
    const prev = kindByUser.get(l.user_id) ?? null;
    if (kind && (!prev || STAFF_KINDS.indexOf(kind) < STAFF_KINDS.indexOf(prev))) kindByUser.set(l.user_id, kind);
    else if (!kindByUser.has(l.user_id)) kindByUser.set(l.user_id, null);
  }
  return new Map([...kindByUser].map(([id, k]) => [id, k ?? "salarie"] as const));
}

/** Techniciens salariés, prestataires et bénévoles, placés à leur domicile. Vide pour les autres profils. */
export async function getStaffLocations(): Promise<StaffPin[]> {
  const { canSeeStaff } = await getViewer();
  if (!canSeeStaff) return [];
  const service = createServiceClient();
  const kindByUser = await getStaffKinds(service);
  if (kindByUser.size === 0) return [];
  const { data: profiles } = await service
    .from("profiles")
    .select("id, first_name, last_name, email, home_address, home_coordinates")
    .in("id", [...kindByUser.keys()]);
  const pins = await Promise.all(
    (profiles ?? []).map(async (p) => {
      const position = parseLatLng(p.home_coordinates) ?? (p.home_address ? await geocode(p.home_address) : null);
      return position ? { id: p.id, name: displayName(p), kind: kindByUser.get(p.id)!, position } : null;
    })
  );
  return pins.filter((p): p is StaffPin => !!p);
}

/** Position de chaque événement (ceux que l'utilisateur peut lire — RLS) ; les événements sans lieu sont omis. */
export async function getEventPositions(eventIds: string[]): Promise<Record<string, LatLng>> {
  const ids = [...new Set(eventIds)].slice(0, 300);
  if (ids.length === 0) return {};
  const { supabase } = await getViewer();
  const { data } = await supabase.from("events").select("id, location, event_address, event_coordinates, online_meeting").in("id", ids);
  const out: Record<string, LatLng> = {};
  await Promise.all(
    (data ?? [])
      .filter((ev) => !ev.online_meeting)
      .map(async (ev) => {
        const pos = await eventPosition(ev);
        if (pos) out[ev.id] = pos;
      })
  );
  return out;
}

/**
 * Trajet en voiture (aller simple) du domicile de chaque utilisateur vers l'événement. Sans `userIds` :
 * tous les techniciens. Un utilisateur sans droit sur les techniciens n'obtient que son propre trajet.
 */
export async function getTravelToEvent(eventId: string, userIds?: string[]): Promise<Record<string, Travel>> {
  const { userId, canSeeStaff, supabase } = await getViewer();
  // Lu avec la session : seulement un événement que l'utilisateur peut voir (RLS).
  const { data: ev } = await supabase.from("events").select("id").eq("id", eventId).maybeSingle();
  if (!ev) return {};

  const service = createServiceClient();
  let ids = userIds;
  if (!ids) {
    if (!canSeeStaff) return {};
    ids = [...(await getStaffKinds(service)).keys()];
  }
  if (!canSeeStaff) ids = ids.filter((id) => id === userId);
  ids = ids.slice(0, 100);
  if (ids.length === 0) return {};

  return travelToEvent(service, eventId, ids);
}
