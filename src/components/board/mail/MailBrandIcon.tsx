"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { GmailIcon, OutlookIcon } from "@/components/board/publication/BrandIcons";

type Provider = "google" | "microsoft" | null;

// Fournisseur du premier compte de messagerie connecté : retenu sur l'appareil pour que le logo
// s'affiche dès le chargement, puis vérifié une fois par session.
const STORE_KEY = "board-lgef:mail-provider";
const readStored = (): Provider => {
  try {
    const v = window.localStorage.getItem(STORE_KEY);
    return v === "google" || v === "microsoft" ? v : null;
  } catch {
    return null;
  }
};
let known: Provider | undefined;
let providerPromise: Promise<Provider> | null = null;
const loadProvider = () =>
  (providerPromise ??= getMyConnectedAccounts()
    .then((accounts) => {
      const p = accounts[0]?.provider ?? null;
      const provider: Provider = p === "google" ? "google" : p === "microsoft" || p === "azure" || p === "outlook" ? "microsoft" : null;
      known = provider;
      try {
        if (provider) window.localStorage.setItem(STORE_KEY, provider);
        else window.localStorage.removeItem(STORE_KEY);
      } catch {
        // stockage indisponible : le logo sera simplement vérifié à chaque session
      }
      return provider;
    })
    .catch(() => known ?? null));

/** Icône du module Mails : logo de la messagerie connectée (Gmail, Outlook), enveloppe sinon. */
export function MailBrandIcon({ size = 18, className }: { size?: number; className?: string; strokeWidth?: number }) {
  const [provider, setProvider] = useState<Provider>(() => (known !== undefined ? known : typeof window === "undefined" ? null : readStored()));
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
