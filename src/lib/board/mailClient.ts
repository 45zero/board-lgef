"use client";

import type { getMyMessage, listMyMessages } from "@/app/actions/gmail";

export type MailDetail = Awaited<ReturnType<typeof getMyMessage>>;
export type MailList = Awaited<ReturnType<typeof listMyMessages>>;

/** Liste d'un dossier via la route GET (parallèle aux autres chargements, contrairement aux server actions). */
export async function loadMailList(accountId: string, opts: { labelIds?: string[]; query?: string; pageToken?: string } = {}): Promise<MailList> {
  const params = new URLSearchParams({ account: accountId });
  for (const l of opts.labelIds ?? []) params.append("label", l);
  if (opts.query) params.set("q", opts.query);
  if (opts.pageToken) params.set("page", opts.pageToken);
  const res = await fetch(`/api/mail/list?${params}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "Impossible de charger les mails.");
  return body as MailList;
}

/** Mail d'une liste, avec le compte auquel il appartient (indispensable en « Toutes les boîtes »). */
export type BoxMail = MailList["messages"][number] & { accountId: string };
/** Page suivante de chaque compte (null : plus rien à charger pour ce compte). */
export type BoxPages = Record<string, string | null>;

const mailTime = (m: { date: string }) => {
  const t = new Date(m.date).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Liste d'un dossier sur une ou plusieurs boîtes, fusionnée du plus récent au plus ancien.
 * `pages` : suite de la liste (seuls les comptes qui ont encore une page sont interrogés). Un compte
 * en erreur est ignoré tant qu'un autre répond.
 */
export async function loadBoxesList(
  accountIds: string[],
  opts: { labelIds?: string[]; query?: string } = {},
  pages?: BoxPages
): Promise<{ messages: BoxMail[]; pages: BoxPages }> {
  const targets = pages ? accountIds.filter((id) => pages[id]) : accountIds;
  const results = await Promise.allSettled(
    targets.map((id) => loadMailList(id, { ...opts, pageToken: pages?.[id] ?? undefined }).then((r) => ({ id, r })))
  );
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length && results.length) throw (results[0] as PromiseRejectedResult).reason;
  const nextPages: BoxPages = { ...(pages ?? {}) };
  for (const id of targets) nextPages[id] = null;
  for (const { id, r } of ok) nextPages[id] = r.nextPageToken;
  const messages = ok.flatMap(({ id, r }) => r.messages.map((m) => ({ ...m, accountId: id })));
  messages.sort((a, b) => mailTime(b) - mailTime(a));
  return { messages, pages: nextPages };
}

export const hasMorePages = (pages: BoxPages | null) => !!pages && Object.values(pages).some(Boolean);

/**
 * Mise à jour en direct de la première page sans perdre les pages déjà chargées plus bas : la nouvelle
 * première page, puis les mails qui suivaient son dernier élément. `null` : liste à remplacer.
 */
export function mergeFirstPage<T extends { id: string }>(prev: T[], first: T[]): T[] | null {
  if (prev.length <= first.length || first.length === 0) return null;
  // Plusieurs boîtes : la première page de chacune ne s'enchaîne pas proprement avec la suite.
  if (new Set(first.map((m) => (m as { accountId?: string }).accountId)).size > 1) return null;
  const k = prev.findIndex((m) => m.id === first[first.length - 1].id);
  return k === -1 ? null : [...first, ...prev.slice(k + 1)];
}

// Partagé par les écrans Mails ordinateur et mobile, au niveau du module : survit aux changements
// d'écran. `inflight` évite qu'un clic relance une requête déjà en cours de préchargement.
const details = new Map<string, MailDetail>();
const inflight = new Map<string, Promise<MailDetail>>();

const key = (accountId: string, messageId: string) => `${accountId}:${messageId}`;

export function getCachedMail(accountId: string, messageId: string) {
  return details.get(key(accountId, messageId));
}

/** Contenu d'un mail : cache → requête déjà en cours → nouvelle requête (route GET, en parallèle). */
export function loadMail(accountId: string, messageId: string): Promise<MailDetail> {
  const k = key(accountId, messageId);
  const cached = details.get(k);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(k);
  if (pending) return pending;

  const request = fetch(`/api/mail/message?account=${encodeURIComponent(accountId)}&id=${encodeURIComponent(messageId)}`)
    .then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Impossible d'ouvrir le mail.");
      details.set(k, body as MailDetail);
      return body as MailDetail;
    })
    .finally(() => inflight.delete(k));
  inflight.set(k, request);
  return request;
}

/** Précharge le contenu des premiers mails d'une liste (4 requêtes à la fois). */
export function prefetchMails(accountId: string, messageIds: string[], limit = 15) {
  const ids = messageIds.slice(0, limit).filter((id) => !details.has(key(accountId, id)));
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      await loadMail(accountId, id).catch(() => undefined);
    }
  };
  void Promise.all([worker(), worker(), worker(), worker()]);
}

/** À appeler après une action qui modifie un mail (lu, archivé…) si son contenu doit être relu. */
export function forgetMail(accountId: string, messageId: string) {
  details.delete(key(accountId, messageId));
}
