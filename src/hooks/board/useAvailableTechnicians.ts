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
    supabase
      .from("profiles")
      .select("id, first_name, last_name, email, role")
      .in("role", ["technician", "super_user", "admin"])
      .then(({ data, error }) => {
        if (error) {
          console.error("[useAvailableTechnicians]", error);
        } else {
          setTechnicians(
            (data ?? []).map((p) => ({
              id: p.id,
              name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "Utilisateur",
              email: p.email ?? "",
            }))
          );
        }
        setLoading(false);
      });
  }, []);

  return { technicians, loading };
}
