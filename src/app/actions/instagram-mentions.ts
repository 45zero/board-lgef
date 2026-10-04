"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { getSocialAccountById } from "@/lib/social/accounts";
import { listInstagramCaptions, lookupInstagramAccount, type InstagramProfile } from "@/lib/social/graph";
import { SOCIAL_TARGETS } from "@/lib/social/targets";

// Aide au « @ » Instagram du centre de publication. Instagram ne permet pas de chercher des comptes
// par début de nom : on propose les comptes déjà cités (légendes de @lgefofficiel, publications du
// board), et on vérifie un nom complet (Business Discovery). Rien à tenir à jour : la liste se
// construit avec ce qui est publié. Mis en cache sur l'instance pour ménager le quota Instagram.

export type HandleSuggestion = { username: string; count: number; lastUsed: string };
export type HandleCheck = { status: "found"; profile: InstagramProfile } | { status: "not_found" };

const HANDLE_RE = /@([A-Za-z0-9._]{2,30})/g;
const SUGGESTIONS_TTL = 6 * 60 * 60 * 1000;
const CHECK_TTL = 24 * 60 * 60 * 1000;

let suggestionsCache: { at: number; list: HandleSuggestion[] } | null = null;
const checkCache = new Map<string, { at: number; result: HandleCheck }>();

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) throw new Error("Non authentifié");
  return supabase;
}

function instagramAccount() {
  const target = SOCIAL_TARGETS.find((t) => t.plateforme === "INSTAGRAM");
  const account = target ? getSocialAccountById(target.accountId) : null;
  if (!account) throw new Error("Compte Instagram non configuré.");
  return account;
}

const clean = (u: string) => u.replace(/^@/, "").replace(/[.]+$/, "").toLowerCase();

async function getInstagramHandlesImpl(): Promise<HandleSuggestion[]> {
  const supabase = await requireUser();
  if (suggestionsCache && Date.now() - suggestionsCache.at < SUGGESTIONS_TTL) return suggestionsCache.list;

  const account = instagramAccount();
  const own = new Set(["lgefofficiel"]);
  const tally = new Map<string, HandleSuggestion>();
  const add = (raw: string, when: string) => {
    const username = clean(raw);
    if (username.length < 2 || own.has(username)) return;
    const prev = tally.get(username);
    tally.set(username, { username, count: (prev?.count ?? 0) + 1, lastUsed: prev && prev.lastUsed > when ? prev.lastUsed : when });
  };

  const [captions, { data: pubs }] = await Promise.all([
    listInstagramCaptions(account.externalId, account.accessToken).catch((e) => {
      console.error("[instagram-mentions] légendes", e);
      return [];
    }),
    supabase.from("media_publications").select("caption, targets, created_at").order("created_at", { ascending: false }).limit(500),
  ]);
  for (const c of captions) for (const m of c.caption.matchAll(HANDLE_RE)) add(m[1], c.timestamp);
  for (const p of pubs ?? []) {
    for (const m of (p.caption ?? "").matchAll(HANDLE_RE)) add(m[1], p.created_at);
    for (const u of (p.targets as { igTags?: string[] } | null)?.igTags ?? []) add(u, p.created_at);
  }

  const list = [...tally.values()].sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed));
  suggestionsCache = { at: Date.now(), list };
  return list;
}

async function checkInstagramHandleImpl(raw: string): Promise<HandleCheck> {
  await requireUser();
  const username = clean(raw);
  if (!/^[a-z0-9._]{2,30}$/.test(username)) return { status: "not_found" };
  const cached = checkCache.get(username);
  if (cached && Date.now() - cached.at < CHECK_TTL) return cached.result;
  const account = instagramAccount();
  const profile = await lookupInstagramAccount(account.externalId, account.accessToken, username);
  const result: HandleCheck = profile ? { status: "found", profile } : { status: "not_found" };
  checkCache.set(username, { at: Date.now(), result });
  return result;
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function getInstagramHandles() {
  return toResult(() => getInstagramHandlesImpl());
}

export async function checkInstagramHandle(username: string) {
  return toResult(() => checkInstagramHandleImpl(username));
}
