"use client";

import { MemberGate, SearchPanel } from "@/components/fief/shell";

// Recherche FIEF (mobile, barre du bas) : membres et documents partagés. Sur ordinateur, la recherche est dans la barre du haut.

export default function FiefSearchPage() {
  return (
    <MemberGate>
      {() => (
        <div className="space-y-3">
          <h1 className="text-2xl font-extrabold">Rechercher</h1>
          <SearchPanel autoFocus />
        </div>
      )}
    </MemberGate>
  );
}
