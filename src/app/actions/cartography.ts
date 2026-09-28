"use server";

import { createClient } from "@/lib/supabase/server";

// Cartographie des clubs : les annuaires (registration_contact_lists) sont l'annuaire du site — les mêmes fiches
// servent aux invitations (Inscription) et à la carte. Les positions sont géocodées une fois et stockées en base
// (lat/lng/geocoded_at) ; une adresse modifiée à l'import remet la position à zéro.

const MAPS_KEY = () => process.env.GOOGLE_MAPS_SERVER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

/** Données personnelles (présidents, mobiles) : réservé aux admins, super users et au réseau salarié. */
async function requireStaff() {
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
  const allowed = profile?.role === "admin" || profile?.role === "super_user" || !!specialty;
  if (!allowed) throw new Error("Réservé aux administrateurs et au réseau salarié.");
  return { supabase };
}

/** Toutes les fiches d'un annuaire (pages de 1000 : PostgREST plafonne chaque réponse). */
export async function listMapContacts(listId: string) {
  const { supabase } = await requireStaff();
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("registration_contact_list_members")
      .select(
        "id, name, civility, first_name, last_name, club, club_number, email, email_secondary, phone, address, postal_code, city, lat, lng, geocoded_at, extra"
      )
      .eq("list_id", listId)
      .order("club", { ascending: true, nullsFirst: false })
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) return all;
  }
}

type LatLng = { lat: number; lng: number };

async function geocode(query: string): Promise<{ status: string; loc: LatLng | null }> {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=fr&components=country:FR&language=fr&key=${MAPS_KEY()}`
  );
  const json = (await res.json()) as { status: string; results?: { geometry: { location: LatLng } }[] };
  return { status: json.status, loc: json.status === "OK" ? (json.results?.[0]?.geometry.location ?? null) : null };
}

/**
 * Géocode un lot de fiches pas encore localisées (adresse complète, à défaut code postal + ville).
 * À rappeler tant que `remaining` > 0. Une adresse introuvable est marquée (geocoded_at) pour ne pas être retentée ;
 * une erreur passagère (quota…) laisse la fiche en attente.
 */
export async function geocodeListBatch(listId: string) {
  const { supabase } = await requireStaff();
  if (!MAPS_KEY()) return { processed: 0, remaining: 0, error: "Clé Google Maps manquante côté serveur." };

  const pending = () =>
    supabase
      .from("registration_contact_list_members")
      .select("id, address, postal_code, city", { count: "exact" })
      .eq("list_id", listId)
      .is("geocoded_at", null)
      .or("address.not.is.null,postal_code.not.is.null,city.not.is.null");

  const { data: batch, error } = await pending().limit(40);
  if (error) throw new Error(error.message);

  let firstError: string | null = null;
  for (let i = 0; i < (batch ?? []).length; i += 10) {
    await Promise.all(
      batch!.slice(i, i + 10).map(async (m) => {
        const place = [m.postal_code, m.city].filter(Boolean).join(" ");
        const full = [m.address, place].filter(Boolean).join(", ");
        let result = await geocode(`${full}, France`);
        if (result.status === "ZERO_RESULTS" && m.address && place) result = await geocode(`${place}, France`);
        if (result.status !== "OK" && result.status !== "ZERO_RESULTS") {
          firstError ??= result.status;
          return;
        }
        await supabase
          .from("registration_contact_list_members")
          .update({ lat: result.loc?.lat ?? null, lng: result.loc?.lng ?? null, geocoded_at: new Date().toISOString() })
          .eq("id", m.id);
      })
    );
  }

  const { count } = await pending().limit(1);
  return { processed: batch?.length ?? 0, remaining: count ?? 0, error: firstError };
}

/**
 * Recherche dans tous les annuaires (nom, club, email) — suggestions d'adresses du champ « À » des mails.
 * Profils sans accès aux annuaires : aucune suggestion (pas d'erreur, le champ reste un champ texte).
 */
export async function searchDirectoryEmails(query: string) {
  const q = query.trim().replace(/[%,()*]/g, " ");
  if (q.length < 2) return [];
  let supabase;
  try {
    ({ supabase } = await requireStaff());
  } catch {
    return [];
  }
  const { data } = await supabase
    .from("registration_contact_list_members")
    .select("name, club, email, email_secondary, first_name, last_name")
    .or(
      ["name", "club", "email", "email_secondary", "first_name", "last_name"].map((c) => `${c}.ilike.%${q}%`).join(",")
    )
    .limit(40);
  const seen = new Set<string>();
  const out: { email: string; label: string }[] = [];
  for (const m of data ?? []) {
    for (const email of [m.email, m.email_secondary]) {
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const who = [m.first_name, m.last_name].filter(Boolean).join(" ") || m.name;
      out.push({ email, label: [who, m.club && m.club !== who ? m.club : null].filter(Boolean).join(" · ") });
    }
  }
  return out.slice(0, 8);
}
