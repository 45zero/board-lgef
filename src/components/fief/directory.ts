"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Annuaire des membres FIEF (fief_directory), chargé une fois par visite : recherche, stories, mentions @,
// choix des personnes d'une publication « Certaines personnes ».

export interface DirectoryEntry {
  user_id: string;
  first_name: string;
  last_name: string;
  club_name: string | null;
  joined_at: string;
}

let directoryPromise: Promise<DirectoryEntry[]> | null = null;
export function loadDirectory() {
  directoryPromise ??= Promise.resolve(createClient().rpc("fief_directory")).then(({ data }) => (data ?? []) as DirectoryEntry[]);
  return directoryPromise;
}

export function useDirectory() {
  const [list, setList] = useState<DirectoryEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDirectory().then((l) => {
      if (alive) setList(l);
    });
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

export const foldText = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
