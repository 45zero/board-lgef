"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { GmailIcon, OutlookIcon } from "@/components/board/publication/BrandIcons";

type Provider = "google" | "microsoft" | null;

// Fournisseur du premier compte de messagerie connecté, demandé une fois par session.
let providerPromise: Promise<Provider> | null = null;
const loadProvider = () =>
  (providerPromise ??= getMyConnectedAccounts()
    .then((accounts) => {
      const p = accounts[0]?.provider ?? null;
      return p === "google" ? "google" : p === "microsoft" || p === "azure" || p === "outlook" ? "microsoft" : null;
    })
    .catch(() => null));

/** Icône du module Mails : logo de la messagerie connectée (Gmail, Outlook), enveloppe sinon. */
export function MailBrandIcon({ size = 18, className }: { size?: number; className?: string; strokeWidth?: number }) {
  const [provider, setProvider] = useState<Provider>(null);
  useEffect(() => {
    let alive = true;
    void loadProvider().then((p) => alive && setProvider(p));
    return () => {
      alive = false;
    };
  }, []);
  if (provider === "google") return <GmailIcon size={size} />;
  if (provider === "microsoft") return <OutlookIcon size={size} />;
  return <Mail size={size} className={className} />;
}
