"use client";

import type { getMyMessage, listMyMessages } from "@/app/actions/gmail";

export type MailDetail = Awaited<ReturnType<typeof getMyMessage>>;
export type MailList = Awaited<ReturnType<typeof listMyMessages>>;

/** Liste d'un dossier via la route GET (parallèle aux autres chargements, contrairement aux server actions). */
export async function loadMailList(accountId: string, opts: { labelIds?: string[]; query?: string } = {}): Promise<MailList> {
  const params = new URLSearchParams({ account: accountId });
  for (const l of opts.labelIds ?? []) params.append("label", l);
  if (opts.query) params.set("q", opts.query);
  const res = await fetch(`/api/mail/list?${params}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "Impossible de charger les mails.");
  return body as MailList;
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
