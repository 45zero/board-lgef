"use client";

/**
 * Cache local « stale-while-revalidate » (comme les applis natives Gmail/Outlook) : à l'ouverture
 * d'un écran, les dernières données connues s'affichent immédiatement, puis sont remplacées par
 * les fraîches dès que le réseau répond. Stocké dans le navigateur de l'utilisateur uniquement,
 * vidé à la déconnexion (voir AuthContext.logout). Toute erreur de stockage (navigation privée,
 * quota plein) est ignorée : l'écran se charge alors simplement depuis le réseau.
 */

const PREFIX = "lgef-board:v1:";
/** Au-delà, une entrée est jugée trop vieille pour être affichée même en attendant le réseau. */
const MAX_AGE_MS = 7 * 86_400_000;

export function readCache<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const { at, value } = JSON.parse(raw) as { at: number; value: T };
    if (Date.now() - at > MAX_AGE_MS) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function writeCache<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Quota plein : on libère le cache du board et on n'insiste pas.
    clearLocalCache();
  }
}

export function clearLocalCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // stockage indisponible : rien à vider
  }
}
