"use client";

import { MemberGate } from "@/components/fief/shell";
import { DocumentsView } from "@/components/fief/documents";

// Documents FIEF : « Documents partagés » (par dossiers) et « Mes documents », rangés dans le dossier FIEF du Drive du board.

export default function FiefDocumentsPage() {
  return (
    <MemberGate>
      {() => (
        <div className="space-y-4">
          <h1 className="text-2xl font-extrabold">Documents</h1>
          <DocumentsView />
        </div>
      )}
    </MemberGate>
  );
}
