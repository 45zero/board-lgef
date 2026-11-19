"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CALENDAR_ORG_KEYS, EVENT_TYPE_TO_ORG, type DbEventType } from "@/lib/board/calendar";
import type { OrgKey } from "@/lib/board/tokens";

/**
 * Services (catégories) dans lesquels la personne peut créer un événement — même règle que les
 * policies d'insertion de `events` :
 *  - administrateur / super user : tous ;
 *  - sinon « Perso » (visible d'elle seule, ev_perso_owner_only) + les types de ses pôles
 *    (profile_specialties → specialty_event_types). L'admin ouvre un service en cochant le pôle
 *    dans Paramètres → Utilisateurs.
 * null tant que ce n'est pas chargé.
 */
export function useCreatableOrgs(): OrgKey[] | null {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<OrgKey[] | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const [{ data: profile }, { data: links }, { data: mapping }] = await Promise.all([
        supabase.from("profiles").select("role").eq("id", user.id).single(),
        supabase.from("profile_specialties").select("specialties(slug)").eq("user_id", user.id),
        supabase.from("specialty_event_types").select("specialty_slug, event_type"),
      ]);
      if (cancelled) return;
      if (profile?.role === "admin" || profile?.role === "super_user") {
        setOrgs(CALENDAR_ORG_KEYS);
        return;
      }
      const slugs = new Set(
        ((links ?? []) as unknown as { specialties: { slug: string } | { slug: string }[] | null }[]).flatMap((r) =>
          r.specialties ? (Array.isArray(r.specialties) ? r.specialties : [r.specialties]).map((s) => s.slug) : []
        )
      );
      const allowed = new Set<OrgKey>(["perso"]);
      for (const m of (mapping ?? []) as { specialty_slug: string; event_type: string }[]) {
        const org = EVENT_TYPE_TO_ORG[m.event_type as DbEventType];
        if (org && slugs.has(m.specialty_slug)) allowed.add(org);
      }
      setOrgs(CALENDAR_ORG_KEYS.filter((k) => allowed.has(k)));
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return orgs;
}
