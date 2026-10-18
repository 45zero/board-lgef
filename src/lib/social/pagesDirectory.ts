import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { getSocialAccountById } from "@/lib/social/accounts";
import { FACEBOOK_REGIONS, type FacebookMention } from "@/lib/social/targets";

// Annuaire des Pages Facebook à mentionner (table facebook_pages_directory, sql/2026-10-18_…) :
// Meta ne permet pas de chercher une Page par son nom sans « Page Public Metadata Access ». Le board
// le remplit lui-même avec les Pages qui identifient les Pages LGEF (/tagged : clubs, districts,
// médias, photographes) et celles mentionnées depuis le board ; la fenêtre « Publier » y cherche.

type Service = ReturnType<typeof createServiceClient>;

const GRAPH = "https://graph.facebook.com/v25.0";

/** Nom en minuscules sans accents ni ponctuation : la recherche « fc metz » trouve « F.C. Metz ». */
export const foldPageName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

type Seen = { name: string; posts: string[] };

/**
 * Parcourt les publications où une Page identifie les Pages LGEF et met l'annuaire à jour.
 * `since` : seulement les publications récentes (passage de nuit) ; sinon tout l'historique,
 * dans la limite de `maxCalls` appels par Page LGEF.
 */
export async function syncTaggedPages(service: Service, opts: { since?: Date; maxCalls?: number } = {}) {
  const maxCalls = opts.maxCalls ?? 40;
  const ownIds = new Set(FACEBOOK_REGIONS.map((r) => getSocialAccountById(r.accountId)?.externalId).filter(Boolean));
  const seen = new Map<string, Seen>();
  const errors: string[] = [];

  for (const region of FACEBOOK_REGIONS) {
    const account = getSocialAccountById(region.accountId);
    if (!account) continue;
    const params = new URLSearchParams({ fields: "from{id,name},created_time", limit: "100", access_token: account.accessToken });
    if (opts.since) params.set("since", String(Math.floor(opts.since.getTime() / 1000)));
    let url: string | undefined = `${GRAPH}/${account.externalId}/tagged?${params}`;
    for (let calls = 0; url && calls < maxCalls; calls++) {
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json()) as {
        data?: { from?: { id?: string; name?: string }; created_time?: string }[];
        paging?: { next?: string };
        error?: { message?: string };
      };
      if (body.error) {
        errors.push(`${region.label} : ${body.error.message ?? "erreur Graph"}`);
        break;
      }
      for (const post of body.data ?? []) {
        const id = post.from?.id;
        const name = post.from?.name?.trim();
        if (!id || !name || ownIds.has(id)) continue;
        const entry = seen.get(id) ?? { name, posts: [] };
        if (post.created_time) entry.posts.push(post.created_time);
        seen.set(id, entry);
      }
      url = body.paging?.next;
    }
  }
  if (seen.size === 0) return { pages: 0, added: 0, errors };

  // Compteur d'identifications : seules les publications plus récentes que le dernier passage comptent.
  const ids = [...seen.keys()];
  const existing = new Map<string, { last_seen_at: string | null; tag_count: number; source: string }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await service.from("facebook_pages_directory").select("id, last_seen_at, tag_count, source").in("id", ids.slice(i, i + 200));
    for (const row of data ?? []) existing.set(row.id, row);
  }
  const now = new Date().toISOString();
  const rows = ids.map((id) => {
    const s = seen.get(id)!;
    const prev = existing.get(id);
    const fresh = s.posts.filter((t) => !prev?.last_seen_at || new Date(t) > new Date(prev.last_seen_at));
    const latest = s.posts.reduce<string | null>((max, t) => (!max || new Date(t) > new Date(max) ? t : max), prev?.last_seen_at ?? null);
    return {
      id,
      name: s.name,
      search: foldPageName(s.name),
      source: prev?.source ?? "tagged",
      tag_count: (prev?.tag_count ?? 0) + fresh.length,
      last_seen_at: latest ? new Date(latest).toISOString() : null,
      updated_at: now,
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await service.from("facebook_pages_directory").upsert(rows.slice(i, i + 200), { onConflict: "id" });
    if (error) errors.push(error.message);
  }
  return { pages: rows.length, added: rows.length - existing.size, errors };
}

/** Pages de l'annuaire dont le nom contient tous les mots tapés — les plus mentionnées / actives d'abord. */
export async function searchPagesDirectory(service: Service, query: string, limit = 8): Promise<FacebookMention[]> {
  const words = foldPageName(query).split(" ").filter(Boolean).slice(0, 5);
  if (!words.length) return [];
  let q = service.from("facebook_pages_directory").select("id, name, search, mention_count, tag_count");
  for (const w of words) q = q.ilike("search", `%${w}%`);
  const { data } = await q.order("mention_count", { ascending: false }).order("tag_count", { ascending: false }).limit(60);
  // Les mots tapés trouvés en entier passent devant (« fc metz » : « FC Metz » avant « Football Club
  // de Metzing – FCM »), puis le nom qui commence par le premier mot, puis les plus mentionnées / actives.
  const score = (search: string) => {
    const tokens = search.split(" ");
    return words.filter((w) => tokens.includes(w)).length * 2 + (search.startsWith(words[0]) ? 1 : 0);
  };
  return (data ?? [])
    .map((r) => ({ r, score: score(r.search) }))
    .sort((a, b) => b.score - a.score || b.r.mention_count - a.r.mention_count || b.r.tag_count - a.r.tag_count)
    .slice(0, limit)
    .map(({ r }) => ({ id: r.id, name: r.name }));
}

/**
 * Recherche de Pages par leur nom chez Meta (/pages/search, « Page Public Metadata Access ») avec le token
 * d'une Page LGEF. Sans l'accès (app non validée, quota…), renvoie une liste vide : l'annuaire prend le relais.
 */
export async function searchMetaPages(query: string, limit = 8): Promise<FacebookMention[]> {
  const q = query.trim();
  const account = FACEBOOK_REGIONS.map((r) => getSocialAccountById(r.accountId)).find(Boolean);
  if (q.length < 2 || !account) return [];
  const params = new URLSearchParams({
    q,
    fields: "id,name,verification_status,location{city}",
    limit: String(limit),
    access_token: account.accessToken,
  });
  try {
    const res = await fetch(`${GRAPH}/pages/search?${params}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const body = (await res.json()) as {
      data?: { id?: string; name?: string; verification_status?: string; location?: { city?: string } }[];
      error?: { message?: string };
    };
    if (body.error) {
      console.warn("[pages/search]", body.error.message);
      return [];
    }
    return (body.data ?? [])
      .filter((p) => p.id && p.name)
      .map((p) => {
        const detail = [p.verification_status === "blue_verified" ? "✓ vérifiée" : null, p.location?.city].filter(Boolean).join(" · ");
        return { id: p.id!, name: p.name!, ...(detail ? { detail } : {}) };
      });
  } catch {
    return [];
  }
}

/** Pages mentionnées depuis le board (ou ajoutées par leur identifiant) : ajoutées à l'annuaire, en tête de la recherche. */
export async function rememberMentionedPages(service: Service, pages: FacebookMention[], source: "mention" | "manual" = "mention") {
  const withId = pages.filter((p) => /^\d{5,}$/.test(p.id) && p.name.trim());
  if (!withId.length) return;
  const { data } = await service.from("facebook_pages_directory").select("id, mention_count, source, name").in("id", withId.map((p) => p.id));
  const prev = new Map((data ?? []).map((r) => [r.id, r]));
  const now = new Date().toISOString();
  await service.from("facebook_pages_directory").upsert(
    withId.map((p) => {
      const old = prev.get(p.id);
      // Nom générique « Page 123… » (identifiant seul) : on garde le vrai nom s'il est déjà connu.
      const name = /^Page \d+$/.test(p.name) && old ? old.name : p.name;
      return {
        id: p.id,
        name,
        search: foldPageName(name),
        source: old?.source ?? source,
        mention_count: (old?.mention_count ?? 0) + (source === "mention" ? 1 : 0),
        updated_at: now,
      };
    }),
    { onConflict: "id" }
  );
}
