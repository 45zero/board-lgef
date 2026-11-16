import type { Metadata } from "next";
import { getReplyContext } from "@/app/actions/tournois-public";
import { ReplyForm } from "@/components/tournois/ReplyForm";

export const metadata: Metadata = { title: "Répondre — dossier de tournoi", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Bouton « Répondre » d'un mail de dossier : message reçu, pièces, et réponse qui revient dans le board. */
export default async function TournoiReplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await getReplyContext(token);
  return (
    <div className="min-h-screen bg-shell">
      {res.ok ? (
        <ReplyForm token={token} ctx={res.data} />
      ) : (
        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="w-full max-w-md rounded-modal border border-line bg-card p-8 text-center shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo statique léger */}
            <img src="/lgef-logo.png" alt="LGEF" className="mx-auto mb-4 h-14 w-auto" />
            <p className="text-base font-bold text-ink">Lien indisponible</p>
            <p className="mt-2 text-sm text-ink-3">{res.error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
