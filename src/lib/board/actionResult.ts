// Résultat d'une server action. En production, Next.js remplace le message de toute erreur levée
// par une action (« An error occurred in the Server Components render… ») : les actions renvoient
// donc leur erreur au lieu de la lever, et le client la relève avec son vrai message (unwrap).

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Côté serveur : exécute l'action et transforme une erreur levée en résultat lisible. */
export async function toResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    console.error("[action]", e);
    return { ok: false, error: e instanceof Error ? e.message : "Une erreur est survenue." };
  }
}

/** Côté client : la donnée, ou une erreur portant le message de l'action. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
