"use client";

import { Mail } from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { GmailIcon, OutlookIcon } from "@/components/board/publication/BrandIcons";
import { useRememberedProvider, type BrandProvider } from "@/hooks/board/useRememberedProvider";

/** Messagerie du premier compte connecté. */
const loadMailProvider = async (): Promise<BrandProvider> => {
  const p = (await getMyConnectedAccounts())[0]?.provider ?? null;
  return p === "google" ? "google" : p === "microsoft" || p === "azure" || p === "outlook" ? "microsoft" : null;
};

/** Icône du module Mails : logo de la messagerie connectée (Gmail, Outlook), enveloppe sinon. */
export function MailBrandIcon({ size = 18, className }: { size?: number; className?: string; strokeWidth?: number }) {
  const provider = useRememberedProvider("board-lgef:mail-provider", loadMailProvider);
  if (provider === "google") return <GmailIcon size={size} />;
  if (provider === "microsoft") return <OutlookIcon size={size} />;
  return <Mail size={size} className={className} />;
}
