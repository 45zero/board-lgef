import "server-only";
import type { SocialPlateforme } from "@/lib/social/targets";

// Comptes réseaux sociaux officiels configurés en variable d'environnement (même format que le
// projet IR2F — mêmes pages, mêmes tokens) plutôt qu'en base : les tokens ne doivent être visibles
// que de qui a accès au déploiement.
//
// SOCIAL_ACCOUNTS_JSON=[{"id":"fb-lorraine","label":"Page Facebook LGEF Lorraine","plateforme":"FACEBOOK","externalId":"…","accessToken":"…"}, …]

export type SocialAccount = {
  id: string;
  label: string;
  plateforme: SocialPlateforme;
  externalId: string;
  accessToken: string;
};

let cachedAccounts: SocialAccount[] | null = null;

function parseAccounts(): SocialAccount[] {
  if (cachedAccounts) return cachedAccounts;

  const raw = process.env.SOCIAL_ACCOUNTS_JSON;
  if (!raw) {
    cachedAccounts = [];
    return cachedAccounts;
  }

  try {
    const parsed = JSON.parse(raw);
    cachedAccounts = Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error("[social] SOCIAL_ACCOUNTS_JSON est invalide — vérifiez le JSON dans l'environnement");
    cachedAccounts = [];
  }
  return cachedAccounts;
}

export function getSocialAccountById(id: string): SocialAccount | null {
  return parseAccounts().find((a) => a.id === id) ?? null;
}
