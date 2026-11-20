"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMySolicitedEventIds } from "@/app/actions/solicitation";

// Recherche globale de la barre du haut. Tout passe par la session de la personne connectée (RLS),
// et les règles de visibilité appliquées par les écrans le sont ici aussi : événements masqués ou
// privés (comme le calendrier), Espace Team / publication / tournois / transferts selon « Accès aux
// modules », frais et factures : les siens, ou tous pour administrateurs / super users, ou ceux
// des personnes dont on valide les frais (N+1) dans la fiche d'une personne.
// Sans accents ni casse : la base pré-filtre (voir `patterns`), puis le serveur garde ce qui
// contient vraiment chaque mot une fois les accents retirés.

export type SearchPerson = { id: string; name: string; email: string | null; avatarUrl: string | null; service: string | null; role: string | null };
export type SearchEvent = { id: string; title: string; start: string; location: string | null; eventType: string | null };
type HitBase = { id: string; title: string; subtitle: string; date: string | null };
export type SearchHit =
  | (HitBase & { kind: "event"; eventType: string | null })
  | (HitBase & { kind: "card" })
  | (HitBase & { kind: "publication"; eventId: string | null })
  | (HitBase & { kind: "tournoi" })
  | (HitBase & { kind: "transfer" })
  | (HitBase & { kind: "invoice"; eventId: string | null })
  | (HitBase & { kind: "expense"; eventId: string | null })
  | (HitBase & { kind: "comment"; eventId: string });

export type SearchResults = { people: SearchPerson[]; hits: SearchHit[] };

export type PersonActivity = {
  person: SearchPerson;
  upcoming: SearchEvent[];
  past: SearchEvent[];
  cards: { id: string; title: string; due: string | null; list: string | null }[];
  publications: { id: string; title: string; date: string; status: string; eventId: string | null }[];
  /** null : pas le droit de voir les frais / factures de cette personne. */
  expenses: { id: string; label: string; amount: number; status: string; date: string; eventId: string | null }[] | null;
  invoices: { id: string; label: string; amount: number | null; status: string; date: string; eventId: string | null }[] | null;
  transfers: { id: string; title: string; date: string; files: number }[];
  comments: { id: string; body: string; date: string; eventId: string; eventTitle: string }[];
};

const fold = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .toLowerCase();

/** Mots de la recherche, nettoyés pour PostgREST (ni virgule, ni parenthèse, ni %). */
function tokensOf(q: string) {
  return fold(q)
    .replace(/[^a-z0-9@.'\- ]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.'\-]+|[.'\-]+$/g, ""))
    .filter((t) => t.length >= 2)
    .slice(0, 5);
}

const ACCENTS: Record<string, string[]> = { a: ["à", "â"], e: ["é", "è", "ê", "ë"], i: ["î", "ï"], o: ["ô"], u: ["ù", "û", "ü"], c: ["ç"], y: ["ÿ"] };

/**
 * Motifs ILIKE tolérants aux accents. Mot riche en consonnes (« épinal », « événement ») : squelette
 * où voyelles et « c » deviennent « _ » (un caractère quelconque), sélectif dès 3 lettres fixes.
 * Sinon (« léa », « coupe ») : le mot tel quel et ses variantes à un accent, pour ne pas ramener
 * la moitié de la base.
 */
function patterns(t: string): string[] {
  const squelette = t.replace(/[aeiouyc]/g, "_");
  if (squelette.replace(/_/g, "").length >= 3) return [`%${squelette}%`];
  const out = new Set([`%${t}%`]);
  [...t].forEach((ch, i) => (ACCENTS[ch] ?? []).forEach((acc) => out.add(`%${t.slice(0, i)}${acc}${t.slice(i + 1)}%`)));
  return [...out];
}

/** Filtre `or` PostgREST : le mot le plus long, sous toutes ses formes, sur chacune des colonnes. */
const orIlike = (cols: string[], token: string) => cols.flatMap((c) => patterns(token).map((p) => `${c}.ilike.${p}`)).join(",");

const matchesAll = (tokens: string[], ...fields: (string | null | undefined)[]) => {
  const hay = fold(fields.join(" "));
  return tokens.every((t) => hay.includes(t));
};

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "Sans nom";

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" }) : "";
const euros = (n: number | null | undefined) => (n == null ? "" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n));
const clip = (s: string | null | undefined, n = 90) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const EXPENSE_STATUS: Record<string, string> = { pending: "En attente", approved: "Validé", rejected: "Refusé", no_expense: "Pas de frais", draft: "Brouillon" };
const INVOICE_STATUS: Record<string, string> = { pending: "En attente", approved: "Validée", rejected: "Refusée", submitted: "Déposée" };
const PUB_STATUS: Record<string, string> = { to_publish: "À publier", scheduled: "Programmée", published: "Publiée" };

type Ctx = {
  supabase: SupabaseClient;
  userId: string;
  privileged: boolean;
  /** Événements visibles, mêmes règles que le calendrier. */
  canSeeEvent: (e: { id: string; visibility?: string | null }) => boolean;
  modules: Set<string>;
  /** Personnes dont la personne connectée valide les frais. */
  validates: Set<string>;
};

async function context(): Promise<Ctx | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const [{ data: me }, { data: specs }, { data: team }, { data: assigned }, { data: own }, solicited, mods, { data: reports }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", userId).single(),
    supabase.from("profile_specialties").select("specialties(slug)").eq("user_id", userId),
    supabase.from("event_team_members").select("event_id").eq("user_id", userId),
    supabase.from("event_assignments").select("event_id").eq("user_id", userId),
    supabase.from("events").select("id").eq("created_by", userId),
    getMySolicitedEventIds().catch(() => [] as string[]),
    Promise.all(
      ["audiovisuel", "tournois", "trello", "transfer"].map(async (m) => {
        const { data: ok } = await supabase.rpc("can_see_module", { uid: userId, p_module: m });
        return ok === true ? m : null;
      })
    ),
    supabase.from("profiles").select("id").eq("expense_validator_id", userId),
  ]);

  const privileged = me?.role === "admin" || me?.role === "super_user";
  const slugs = ((specs ?? []) as unknown as { specialties: { slug: string } | null }[]).map((r) => r.specialties?.slug ?? "");
  const solicitedOnly = !privileged && slugs.some((s) => s === "tech-prestataire" || s === "tech-benevole");
  const mine = new Set<string>([
    ...solicited,
    ...((team ?? []) as { event_id: string }[]).map((r) => r.event_id),
    ...((assigned ?? []) as { event_id: string }[]).map((r) => r.event_id),
    ...((own ?? []) as { id: string }[]).map((r) => r.id),
  ]);
  const canSeeEvent = (e: { id: string; visibility?: string | null }) => {
    if (e.visibility === "hidden") return false;
    if (privileged) return true;
    if (solicitedOnly) return mine.has(e.id);
    return e.visibility !== "private" || mine.has(e.id);
  };

  return {
    supabase,
    userId,
    privileged,
    canSeeEvent,
    modules: new Set(mods.filter((m): m is string => !!m)),
    validates: new Set(((reports ?? []) as { id: string }[]).map((r) => r.id)),
  };
}

const PROFILE_COLS = "id, first_name, last_name, email, avatar_url, home_service, sector, role";
type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
  home_service: string | null;
  sector: string | null;
  role: string | null;
};
const toPerson = (p: ProfileRow): SearchPerson => ({
  id: p.id,
  name: personName(p),
  email: p.email,
  avatarUrl: p.avatar_url,
  service: p.home_service || p.sector || null,
  role: p.role,
});

type PubRow = { id: string; title: string | null; caption: string | null; status: string; created_at: string; published_at: string | null; event_id: string | null; events: { title: string } | null };
type CommentRow = { id: string; body: string; created_at: string; event_id: string; events: { title: string; visibility: string | null } | null };
const none = Promise.resolve({ data: [] as unknown[] });

/** Recherche dans tout le board : personnes d'abord, puis éléments classés par pertinence et proximité de date. */
export async function globalSearch(query: string): Promise<SearchResults> {
  const empty: SearchResults = { people: [], hits: [] };
  const tokens = tokensOf(query);
  if (!tokens.length) return empty;
  const ctx = await context();
  if (!ctx) return empty;
  const { supabase } = ctx;
  const key = [...tokens].sort((a, b) => b.length - a.length)[0];

  const invoicesReq = supabase
    .from("event_invoices")
    .select("id, label, invoice_number, amount_ttc, status, invoice_date, created_at, event_id, user_comment")
    .or(orIlike(["label", "invoice_number", "user_comment"], key));
  const expensesReq = supabase
    .from("event_expenses")
    .select("id, merchant_name, description, total_amount, expense_date, created_at, event_id")
    .or(orIlike(["merchant_name", "description"], key));

  const [people, events, cards, pubs, tournois, transfers, invoices, expenses, comments] = await Promise.all([
    // Personnes : peu nombreuses, toutes lues puis filtrées sans accents (prénom composé, nom à particule…).
    supabase.from("profiles").select(PROFILE_COLS).limit(2000),
    supabase
      .from("events")
      .select("id, title, start_date, location, description, event_type, visibility")
      .or(orIlike(["title", "location", "description"], key))
      .order("start_date", { ascending: false })
      .limit(150),
    ctx.modules.has("trello")
      ? supabase.from("team_cards").select("id, title, description, due_at, updated_at").is("archived_at", null).or(orIlike(["title", "description"], key)).limit(30)
      : none,
    ctx.modules.has("audiovisuel")
      ? supabase
          .from("media_publications")
          .select("id, title, caption, status, created_at, published_at, event_id, events(title)")
          .or(orIlike(["title", "caption"], key))
          .order("created_at", { ascending: false })
          .limit(30)
      : none,
    ctx.modules.has("tournois")
      ? supabase
          .from("tournament_declarations")
          .select("id, ref, title, club_name, club_number, start_date, address, contact_first_name, contact_last_name, contact_email, status")
          .or(orIlike(["ref", "title", "club_name", "club_number", "address", "contact_first_name", "contact_last_name", "contact_email"], key))
          .order("start_date", { ascending: false })
          .limit(30)
      : none,
    ctx.modules.has("transfer")
      ? supabase
          .from("transfers")
          .select("id, code, title, message, sender_name, sender_email, created_at, file_count")
          .or(orIlike(["title", "code", "message", "sender_name", "sender_email"], key))
          .order("created_at", { ascending: false })
          .limit(20)
      : none,
    (ctx.privileged ? invoicesReq : invoicesReq.eq("user_id", ctx.userId)).order("created_at", { ascending: false }).limit(20),
    (ctx.privileged ? expensesReq : expensesReq.eq("user_id", ctx.userId)).order("created_at", { ascending: false }).limit(20),
    supabase
      .from("event_comments")
      .select("id, body, created_at, event_id, events(title, visibility)")
      .or(orIlike(["body"], key))
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  // Personnes : chaque mot doit figurer dans le prénom, le nom ou l'e-mail ; prénom / nom exact en tête.
  const personRows = ((people.data ?? []) as ProfileRow[]).filter((p) => matchesAll(tokens, p.first_name, p.last_name, p.email));
  const score = (p: ProfileRow) => {
    const f = fold(p.first_name);
    const l = fold(p.last_name);
    return tokens.reduce((s, t) => s + (f === t || l === t ? 3 : f.startsWith(t) || l.startsWith(t) ? 2 : 1), 0);
  };
  personRows.sort((a, b) => score(b) - score(a) || personName(a).localeCompare(personName(b), "fr"));

  const now = Date.now();
  const hits: { hit: SearchHit; rank: number }[] = [];
  // Proximité de date : l'à-venir proche d'abord, puis le passé récent.
  const dateRank = (iso: string | null) => {
    if (!iso) return 0;
    const d = (new Date(iso).getTime() - now) / 86_400_000;
    return d >= 0 ? 2 - Math.min(d, 60) / 60 : 1 - Math.min(-d, 365) / 365;
  };
  const push = (hit: SearchHit, rank: number) => hits.push({ hit, rank });

  type EventRow = { id: string; title: string; start_date: string; location: string | null; description: string | null; event_type: string | null; visibility: string | null };
  for (const e of (events.data ?? []) as EventRow[]) {
    if (!ctx.canSeeEvent(e) || !matchesAll(tokens, e.title, e.location, e.description)) continue;
    push(
      { kind: "event", id: e.id, title: e.title, subtitle: [fmtDay(e.start_date), e.location].filter(Boolean).join(" · "), date: e.start_date, eventType: e.event_type },
      (matchesAll(tokens, e.title) ? 3 : 1) + dateRank(e.start_date)
    );
  }
  for (const c of (cards.data ?? []) as { id: string; title: string; description: string | null; due_at: string | null; updated_at: string }[]) {
    if (!matchesAll(tokens, c.title, c.description)) continue;
    push(
      { kind: "card", id: c.id, title: c.title, subtitle: c.due_at ? `Carte · échéance ${fmtDay(c.due_at)}` : "Carte de l'Espace Team", date: c.due_at },
      (matchesAll(tokens, c.title) ? 2.5 : 1) + dateRank(c.due_at ?? c.updated_at)
    );
  }
  for (const p of (pubs.data ?? []) as unknown as PubRow[]) {
    if (!matchesAll(tokens, p.title, p.caption, p.events?.title)) continue;
    push(
      {
        kind: "publication",
        id: p.id,
        title: p.title || p.events?.title || clip(p.caption, 60) || "Publication",
        subtitle: `Publication · ${PUB_STATUS[p.status] ?? p.status} · ${fmtDay(p.published_at ?? p.created_at)}`,
        date: p.published_at ?? p.created_at,
        eventId: p.event_id,
      },
      1.5 + dateRank(p.created_at)
    );
  }
  type TournoiRow = {
    id: string;
    ref: string | null;
    title: string;
    club_name: string;
    club_number: string | null;
    start_date: string;
    address: string;
    contact_first_name: string;
    contact_last_name: string;
    contact_email: string;
  };
  for (const t of (tournois.data ?? []) as TournoiRow[]) {
    if (!matchesAll(tokens, t.ref, t.title, t.club_name, t.club_number, t.address, t.contact_first_name, t.contact_last_name, t.contact_email)) continue;
    push(
      {
        kind: "tournoi",
        id: t.id,
        title: `${t.title} — ${t.club_name}`,
        subtitle: ["Tournoi", t.ref, fmtDay(t.start_date), `${t.contact_first_name} ${t.contact_last_name}`].filter(Boolean).join(" · "),
        date: t.start_date,
      },
      2 + dateRank(t.start_date)
    );
  }
  type TransferRow = { id: string; code: string; title: string | null; message: string | null; sender_name: string | null; sender_email: string | null; created_at: string; file_count: number | null };
  for (const t of (transfers.data ?? []) as TransferRow[]) {
    if (!matchesAll(tokens, t.title, t.code, t.message, t.sender_name, t.sender_email)) continue;
    push(
      {
        kind: "transfer",
        id: t.id,
        title: t.title || `Transfert ${t.code}`,
        subtitle: ["Transfert", t.sender_name, `${t.file_count ?? 0} fichier(s)`, fmtDay(t.created_at)].filter(Boolean).join(" · "),
        date: t.created_at,
      },
      1.2 + dateRank(t.created_at)
    );
  }
  type InvoiceRow = { id: string; label: string | null; invoice_number: string | null; amount_ttc: number | null; status: string; invoice_date: string | null; created_at: string; event_id: string | null; user_comment: string | null };
  for (const i of (invoices.data ?? []) as InvoiceRow[]) {
    if (!matchesAll(tokens, i.label, i.invoice_number, i.user_comment)) continue;
    push(
      {
        kind: "invoice",
        id: i.id,
        title: i.label || `Facture ${i.invoice_number ?? ""}`.trim(),
        subtitle: ["Facture", i.invoice_number && `N° ${i.invoice_number}`, euros(i.amount_ttc), INVOICE_STATUS[i.status] ?? i.status].filter(Boolean).join(" · "),
        date: i.invoice_date ?? i.created_at,
        eventId: i.event_id,
      },
      1.3 + dateRank(i.created_at)
    );
  }
  type ExpenseRow = { id: string; merchant_name: string | null; description: string | null; total_amount: number | null; expense_date: string | null; created_at: string; event_id: string | null };
  for (const x of (expenses.data ?? []) as ExpenseRow[]) {
    if (!matchesAll(tokens, x.merchant_name, x.description)) continue;
    push(
      {
        kind: "expense",
        id: x.id,
        title: x.merchant_name || clip(x.description, 50) || "Dépense",
        subtitle: ["Frais", euros(x.total_amount), fmtDay(x.expense_date ?? x.created_at), x.merchant_name ? clip(x.description, 40) : null].filter(Boolean).join(" · "),
        date: x.expense_date ?? x.created_at,
        eventId: x.event_id,
      },
      1.1 + dateRank(x.created_at)
    );
  }
  for (const c of (comments.data ?? []) as unknown as CommentRow[]) {
    if (!c.events || !ctx.canSeeEvent({ id: c.event_id, visibility: c.events.visibility }) || !matchesAll(tokens, c.body)) continue;
    push(
      { kind: "comment", id: c.id, title: clip(c.body, 80), subtitle: `Commentaire · ${c.events.title} · ${fmtDay(c.created_at)}`, date: c.created_at, eventId: c.event_id },
      0.8 + dateRank(c.created_at)
    );
  }

  hits.sort((a, b) => b.rank - a.rank);
  return { people: personRows.slice(0, 8).map(toPerson), hits: hits.slice(0, 40).map((h) => h.hit) };
}

/** Tout ce qui concerne une personne, limité à ce que la personne connectée peut voir. */
export async function personActivity(personId: string): Promise<PersonActivity | null> {
  if (!/^[0-9a-f-]{36}$/.test(personId)) return null;
  const ctx = await context();
  if (!ctx) return null;
  const { supabase } = ctx;
  const seeMoney = ctx.privileged || personId === ctx.userId || ctx.validates.has(personId);

  const [{ data: profile }, team, assigned, coverage, organized, cardLinks, pubs, expenses, invoices, transfers, comments] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLS).eq("id", personId).maybeSingle(),
    supabase.from("event_team_members").select("event_id").eq("user_id", personId),
    supabase.from("event_assignments").select("event_id").eq("user_id", personId),
    supabase.from("coverage_requests").select("event_id").eq("technician_id", personId).eq("active", true),
    supabase.from("events").select("id").or(`created_by.eq.${personId},organizer_id.eq.${personId}`).limit(200),
    ctx.modules.has("trello") ? supabase.from("team_card_members").select("card_id").eq("user_id", personId).limit(100) : none,
    ctx.modules.has("audiovisuel")
      ? supabase
          .from("media_publications")
          .select("id, title, caption, status, created_at, published_at, event_id, events(title)")
          .or(`created_by.eq.${personId},published_by.eq.${personId}`)
          .order("created_at", { ascending: false })
          .limit(6)
      : none,
    seeMoney
      ? supabase
          .from("expense_submissions")
          .select("id, event_id, total_amount, status, submitted_at, created_at, events(title)")
          .eq("user_id", personId)
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null }),
    seeMoney
      ? supabase
          .from("event_invoices")
          .select("id, label, invoice_number, amount_ttc, status, created_at, event_id")
          .eq("user_id", personId)
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null }),
    ctx.modules.has("transfer")
      ? supabase.from("transfers").select("id, code, title, created_at, file_count").eq("sender_user_id", personId).order("created_at", { ascending: false }).limit(5)
      : none,
    supabase.from("event_comments").select("id, body, created_at, event_id, events(title, visibility)").eq("author_id", personId).order("created_at", { ascending: false }).limit(15),
  ]);
  if (!profile) return null;

  const ids = new Set<string>([
    ...[team.data, assigned.data, coverage.data].flatMap((rows) => ((rows ?? []) as { event_id: string }[]).map((r) => r.event_id)),
    ...((organized.data ?? []) as { id: string }[]).map((r) => r.id),
  ]);
  let upcoming: SearchEvent[] = [];
  let past: SearchEvent[] = [];
  if (ids.size) {
    const { data: evs } = await supabase
      .from("events")
      .select("id, title, start_date, location, event_type, visibility")
      .in("id", [...ids].slice(0, 300))
      .order("start_date", { ascending: true });
    const visible = ((evs ?? []) as { id: string; title: string; start_date: string; location: string | null; event_type: string | null; visibility: string | null }[])
      .filter((e) => ctx.canSeeEvent(e))
      .map((e) => ({ id: e.id, title: e.title, start: e.start_date, location: e.location, eventType: e.event_type }));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    upcoming = visible.filter((e) => new Date(e.start) >= today).slice(0, 6);
    past = visible.filter((e) => new Date(e.start) < today).reverse().slice(0, 5);
  }

  let cards: PersonActivity["cards"] = [];
  const cardIds = ((cardLinks.data ?? []) as { card_id: string }[]).map((r) => r.card_id);
  if (cardIds.length) {
    const { data } = await supabase
      .from("team_cards")
      .select("id, title, due_at, team_lists(title)")
      .in("id", cardIds)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(8);
    cards = ((data ?? []) as unknown as { id: string; title: string; due_at: string | null; team_lists: { title: string } | null }[]).map((c) => ({
      id: c.id,
      title: c.title,
      due: c.due_at,
      list: c.team_lists?.title ?? null,
    }));
  }

  type SubmissionRow = { id: string; event_id: string | null; total_amount: number | null; status: string; submitted_at: string | null; created_at: string; events: { title: string } | null };
  type InvoiceRow = { id: string; label: string | null; invoice_number: string | null; amount_ttc: number | null; status: string; created_at: string; event_id: string | null };

  return {
    person: toPerson(profile as ProfileRow),
    upcoming,
    past,
    cards,
    publications: ((pubs.data ?? []) as unknown as PubRow[]).map((p) => ({
      id: p.id,
      title: p.title || p.events?.title || clip(p.caption, 60) || "Publication",
      date: p.published_at ?? p.created_at,
      status: PUB_STATUS[p.status] ?? p.status,
      eventId: p.event_id,
    })),
    expenses: expenses.data
      ? (expenses.data as unknown as SubmissionRow[]).map((x) => ({
          id: x.id,
          label: x.events?.title ?? "Hors événement",
          amount: x.total_amount ?? 0,
          status: EXPENSE_STATUS[x.status] ?? x.status,
          date: x.submitted_at ?? x.created_at,
          eventId: x.event_id,
        }))
      : null,
    invoices: invoices.data
      ? (invoices.data as unknown as InvoiceRow[]).map((i) => ({
          id: i.id,
          label: i.label || `Facture ${i.invoice_number ?? ""}`.trim(),
          amount: i.amount_ttc,
          status: INVOICE_STATUS[i.status] ?? i.status,
          date: i.created_at,
          eventId: i.event_id,
        }))
      : null,
    transfers: ((transfers.data ?? []) as { id: string; code: string; title: string | null; created_at: string; file_count: number | null }[]).map((t) => ({
      id: t.id,
      title: t.title || `Transfert ${t.code}`,
      date: t.created_at,
      files: t.file_count ?? 0,
    })),
    comments: ((comments.data ?? []) as unknown as CommentRow[])
      .filter((c) => c.events && ctx.canSeeEvent({ id: c.event_id, visibility: c.events.visibility }))
      .slice(0, 5)
      .map((c) => ({ id: c.id, body: clip(c.body, 110), date: c.created_at, eventId: c.event_id, eventTitle: c.events!.title })),
  };
}
