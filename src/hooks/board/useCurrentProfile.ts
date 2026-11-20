"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PROFILE_UPDATED_EVENT } from "@/lib/board/profile";

/** Nom, initiales et photo de la personne connectée (barre du haut ordinateur et en-tête mobile). */
export function useCurrentProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<{ firstName: string; lastName: string; avatarUrl: string | null } | null>(null);
  // Relu quand « Mon profil » enregistre un changement (nom, photo).
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(PROFILE_UPDATED_EVENT, bump);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on logout, no async fetch involved
      setProfile(null);
      return;
    }
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("first_name, last_name, avatar_url")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        setProfile({ firstName: data?.first_name ?? "", lastName: data?.last_name ?? "", avatarUrl: data?.avatar_url ?? null });
      });
  }, [user?.id, version]);

  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || user?.email || "";
  const initials =
    [profile?.firstName?.[0], profile?.lastName?.[0]].filter(Boolean).join("").toUpperCase() ||
    name.slice(0, 2).toUpperCase();

  return { name, initials, avatarUrl: profile?.avatarUrl ?? null };
}
