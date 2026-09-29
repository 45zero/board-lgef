"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface TechnicianOption {
  id: string;
  name: string;
  email: string;
}

/** Porté de calendrier-lgef/src/hooks/useAvailableTechnicians.ts. */
export function useAvailableTechnicians() {
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    // Techniciens, admins et super users, plus les vidéastes de Couverture match (spécialité tech-video),
    // qui peuvent avoir un simple rôle utilisateur.
    Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, email, role").in("role", ["technician", "super_user", "admin"]),
      supabase.from("profile_specialties").select("user_id, specialties!inner(slug)").eq("specialties.slug", "tech-video"),
    ]).then(async ([{ data, error }, { data: videoLinks }]) => {
      if (error) {
        console.error("[useAvailableTechnicians]", error);
        setLoading(false);
        return;
      }
      const known = new Set((data ?? []).map((p) => p.id));
      const extraIds = (videoLinks ?? []).map((l) => l.user_id).filter((id) => !known.has(id));
      const { data: extra } = extraIds.length
        ? await supabase.from("profiles").select("id, first_name, last_name, email, role").in("id", extraIds)
        : { data: [] };
      setTechnicians(
        [...(data ?? []), ...(extra ?? [])].map((p) => ({
          id: p.id,
          name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "Utilisateur",
          email: p.email ?? "",
        }))
      );
      setLoading(false);
    });
  }, []);

  return { technicians, loading };
}
