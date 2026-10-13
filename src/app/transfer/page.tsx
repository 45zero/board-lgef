import type { Metadata } from "next";
import { pickAd } from "@/lib/transfer/core";
import { TransferPageFrame } from "@/components/transfer/TransferAd";
import { TransferBrand } from "@/components/transfer/TransferBrand";
import { TransferUploader } from "@/components/transfer/TransferUploader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LGEF Transfer — Envoyez vos fichiers",
  description: "Envoyez vidéos, photos et documents en toute simplicité avec la Ligue du Grand Est de Football.",
  icons: { icon: "/lgeftransfer.png" },
};

/** Page publique d'envoi (transfer.lgef.fr) : comme WeTransfer / SwissTransfer, pub en fond. */
export default async function TransferPage() {
  const ad = await pickAd("upload").catch(() => null);
  return (
    <TransferPageFrame ad={ad}>
      <TransferBrand />
      <TransferUploader mode="public" />
    </TransferPageFrame>
  );
}
