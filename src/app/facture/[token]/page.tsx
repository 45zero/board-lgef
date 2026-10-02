import type { Metadata } from "next";
import { getInvoiceRequest } from "@/app/actions/invoice-public";
import { InvoiceUploadCard } from "@/components/invoice/InvoiceUploadCard";

export const metadata: Metadata = { title: "Dépôt de facture — LGEF", robots: { index: false, follow: false } };

/** Lien reçu par e-mail (« Réclamer » dans l'Effectif) : le prestataire dépose sa facture sans compte. */
export default async function InvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await getInvoiceRequest(token);
  return (
    <div className="flex min-h-screen items-center justify-center bg-shell p-4">
      {res.ok ? (
        <InvoiceUploadCard token={token} info={res.data} />
      ) : (
        <div className="w-full max-w-md rounded-modal border border-line bg-card p-8 text-center shadow-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo statique léger */}
          <img src="/lgef-logo.png" alt="LGEF" className="mx-auto mb-4 h-14 w-auto" />
          <p className="text-base font-bold text-ink">Lien indisponible</p>
          <p className="mt-2 text-sm text-ink-3">{res.error}</p>
        </div>
      )}
    </div>
  );
}
