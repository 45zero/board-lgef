import type { Metadata } from "next";
import { getTournamentFormConfig, listTournamentDistricts } from "@/app/actions/tournois-public";
import { DeclarationForm } from "@/components/tournois/DeclarationForm";

export const metadata: Metadata = {
  title: "Déclaration de tournoi — Ligue du Grand Est de Football",
  description: "Déclarez en ligne votre tournoi ou rassemblement de jeunes : accusé de réception immédiat, transmission au district.",
};

export const dynamic = "force-dynamic";

/** Page publique (sans compte) : le club organisateur déclare son tournoi / rassemblement. */
export default async function TournoiPage() {
  const [config, districts] = await Promise.all([getTournamentFormConfig(), listTournamentDistricts()]);
  return (
    <div className="min-h-screen bg-shell">
      {config.ok ? (
        <DeclarationForm config={config.data} districts={districts.ok ? districts.data : []} />
      ) : (
        <div className="mx-auto max-w-md p-8 text-center">
          <p className="text-base font-bold text-ink">Formulaire momentanément indisponible</p>
          <p className="mt-2 text-sm text-ink-3">Réessayez dans quelques minutes.</p>
        </div>
      )}
    </div>
  );
}
