import type { Metadata } from "next";
import { Clock, Ban, SearchX, Loader2 } from "lucide-react";
import { headers } from "next/headers";
import { getPublicTransfer, pickAd, visitFromHeaders } from "@/lib/transfer/core";
import { TransferPageFrame } from "@/components/transfer/TransferAd";
import { TransferBrand } from "@/components/transfer/TransferBrand";
import { TransferDownload } from "@/components/transfer/TransferDownload";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LGEF Transfer — Vos fichiers",
  robots: { index: false, follow: false },
  icons: { icon: "/lgeftransfer.png" },
};

/** Lien reçu par e-mail (…/t/<code>) : le destinataire passe toujours par cette page pour voir et télécharger. */
export default async function TransferDownloadPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [transfer, ad] = await Promise.all([getPublicTransfer(code, visitFromHeaders(await headers())), pickAd("download").catch(() => null)]);

  return (
    <TransferPageFrame ad={ad}>
      <TransferBrand />
      {transfer.state === "ready" ? (
        <TransferDownload
          code={transfer.code}
          title={transfer.title}
          message={transfer.message}
          senderName={transfer.senderName}
          totalBytes={transfer.totalBytes}
          createdAt={transfer.createdAt}
          expiresAt={transfer.expiresAt}
          files={transfer.files}
        />
      ) : (
        <Unavailable state={transfer.state} senderName={"senderName" in transfer ? transfer.senderName : null} />
      )}
    </TransferPageFrame>
  );
}

function Unavailable({ state, senderName }: { state: "missing" | "uploading" | "expired" | "revoked"; senderName: string | null }) {
  const content = {
    missing: { Icon: SearchX, title: "Transfert introuvable", text: "Vérifiez le lien reçu." },
    uploading: { Icon: Loader2, title: "Envoi en cours", text: `${senderName ?? "L'expéditeur"} est encore en train d'envoyer les fichiers. Réessayez dans quelques minutes.` },
    expired: { Icon: Clock, title: "Ce transfert a expiré", text: `Demandez à ${senderName ?? "l'expéditeur"} de vous renvoyer les fichiers.` },
    revoked: { Icon: Ban, title: "Transfert supprimé", text: `${senderName ?? "L'expéditeur"} a supprimé ce transfert.` },
  }[state];
  return (
    <div className="rounded-modal bg-card p-8 text-center shadow-card">
      <content.Icon size={40} className="mx-auto mb-3 text-ink-4" />
      <p className="text-lg font-extrabold text-ink">{content.title}</p>
      <p className="mt-1 text-sm text-ink-3">{content.text}</p>
      <a href="/transfer" className="mt-5 inline-flex items-center justify-center rounded-btn bg-red px-5 py-2.5 text-sm font-bold text-white shadow-btn-red hover:bg-red-700">
        Envoyer des fichiers
      </a>
    </div>
  );
}
