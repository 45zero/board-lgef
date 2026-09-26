"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const names = new Map<string, string | null>();

/** « par Prénom Nom » d'un utilisateur (créateur / dernier modificateur d'un événement), mis en cache par session. */
export function PersonName({ userId, prefix = " par " }: { userId: string | null | undefined; prefix?: string }) {
  const [name, setName] = useState<string | null>(() => (userId ? (names.get(userId) ?? null) : null));
  useEffect(() => {
    if (!userId || names.has(userId)) return;
    createClient()
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        const n = data ? [data.first_name, data.last_name].filter(Boolean).join(" ") || data.email || null : null;
        names.set(userId, n);
        setName(n);
      });
  }, [userId]);
  return name ? (
    <>
      {prefix}
      {name}
    </>
  ) : null;
}
