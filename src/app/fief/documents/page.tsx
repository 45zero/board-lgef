"use client";

import { FileText } from "lucide-react";
import { ComingSoon, MemberGate } from "@/components/fief/ui";

// Documents FIEF (lot 4) : « Mes documents » et « Documents partagés », rangés dans le dossier FIEF du Drive du board.

export default function FiefDocumentsPage() {
  return (
    <MemberGate>
      {() => (
        <div className="space-y-4">
          <h1 className="text-2xl font-extrabold">Documents</h1>
          <ComingSoon
            icon={FileText}
            title="L'espace documents arrive bientôt"
            text="Vous pourrez y consulter les documents partagés par l'équipe FIEF et partager les vôtres avec les autres membres."
          />
        </div>
      )}
    </MemberGate>
  );
}
