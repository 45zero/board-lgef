"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { toResult, type ActionResult } from "@/lib/board/actionResult";
import { getTransferMember } from "@/lib/transfer/session";
import { transferAccessFor } from "@/lib/transfer/access";
import { getTransferStorage } from "@/lib/transfer/storage";
import { closeTransfer, forwardTransfer as shareTransfer, requireTransferStorage, resendTransferEmails, resolvePlan, transferLink } from "@/lib/transfer/core";
import { isEmail, type TransferPlanLimits, type TransferPreview } from "@/lib/transfer/shared";

// Onglet « LGEF Transfer » du board : ses transferts (tous pour les admins), ceux reçus à son adresse
// (ou qu'on lui a fait suivre), gestion des formules, des attributions et des pubs. Lecture de ses
// transferts sous RLS ; transferts reçus et écritures en service role après contrôle.

async function requireMember() {
  const member = await getTransferMember();
  if (!member) throw new Error("Non authentifié");
  return member;
}

async function requireAdmin() {
  const member = await requireMember();
  if (!member.isAdmin) throw new Error("Réservé aux administrateurs.");
  return member;
}

/* ---------- Contexte ---------- */

export async function getTransferContext(): Promise<ActionResult<{ isAdmin: boolean; email: string; plan: TransferPlanLimits }>> {
  return toResult(async () => {
    const member = await requireMember();
    const { plan } = await resolvePlan(member.email);
    return { isAdmin: member.isAdmin, email: member.email, plan };
  });
}

export type TransferTiles = { active: number; activeBytes: number; last30: number; downloads30: number };

/** Chiffres du haut de l'onglet (admins) : transferts actifs, volume en ligne, envois et téléchargements des 30 derniers jours. */
async function transferTiles(): Promise<TransferTiles> {
  const s = createServiceClient();
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: active }, { count: last30 }, { count: downloads30 }] = await Promise.all([
    s.from("transfers").select("total_bytes, expires_at").eq("status", "ready"),
    s.from("transfers").select("id", { count: "exact", head: true }).gte("created_at", since30).neq("status", "uploading"),
    s.from("transfer_downloads").select("id", { count: "exact", head: true }).gte("at", since30),
  ]);
  const live = (active ?? []).filter((t) => !t.expires_at || new Date(t.expires_at).getTime() > Date.now());
  return { active: live.length, activeBytes: live.reduce((n, t) => n + t.total_bytes, 0), last30: last30 ?? 0, downloads30: downloads30 ?? 0 };
}

/**
 * Ouverture de l'onglet en un seul appel (les actions serveur d'une page passent l'une après
 * l'autre) : contexte, chiffres (admins) et première liste (tout le board pour un admin, ses
 * envois sinon ; « Partagés avec moi » si `received`), chargés en parallèle.
 */
export async function getTransferHome(opts: { received?: boolean } = {}): Promise<
  ActionResult<{ isAdmin: boolean; email: string; plan: TransferPlanLimits; tiles: TransferTiles | null; scope: TransferFilters["scope"]; rows: TransferRow[] }>
> {
  return toResult(async () => {
    const member = await requireMember();
    const scope: TransferFilters["scope"] = opts.received ? "received" : member.isAdmin ? "all" : "mine";
    const [{ plan }, tiles, rows] = await Promise.all([resolvePlan(member.email), member.isAdmin ? transferTiles() : Promise.resolve(null), loadTransferRows(member, { scope })]);
    return { isAdmin: member.isAdmin, email: member.email, plan, tiles, scope, rows };
  });
}

/* ---------- Drive du board (envoi sans recharger) ---------- */

export type DriveFileForTransfer = { id: string; name: string; size: number; mimeType: string; modifiedTime: string };

export async function searchTransferDriveFiles(query: string): Promise<ActionResult<DriveFileForTransfer[]>> {
  return toResult(async () => {
    await requireMember();
    const storage = await requireTransferStorage();
    return storage.search(query.slice(0, 100));
  });
}

/* ---------- Liste / détail ---------- */

export type TransferStatus = "uploading" | "ready" | "expired" | "revoked";

export type TransferRow = {
  id: string;
  code: string;
  link: string;
  status: TransferStatus;
  source: "public" | "board";
  senderEmail: string;
  senderName: string;
  title: string;
  recipients: string[];
  fileCount: number;
  totalBytes: number;
  downloadCount: number;
  viewCount: number;
  lastDownloadAt: string | null;
  archived: boolean;
  createdAt: string;
  expiresAt: string | null;
  mine: boolean;
  /** Expéditeur ou admin : modifier, prolonger, couper, supprimer. Sinon destinataire : voir, faire suivre, joindre à une carte. */
  canManage: boolean;
  /** « Partagés avec moi » : membre qui me l'a fait suivre (null : reçu directement à mon adresse). */
  sharedBy: string | null;
  /** Personnes à qui il a été fait suivre (noms des membres, sinon adresses) — toutes pour l'expéditeur, les siennes sinon. */
  forwardedTo: string[];
  /** Cartes de l'Espace Team (visibles par moi) où il est joint. */
  cards: { id: string; title: string }[];
};

export type TransferFilters = { scope: "mine" | "all" | "received"; from?: string; to?: string; status?: TransferStatus | "downloaded" | "never" | ""; q?: string };

const effectiveStatus = (t: { status: TransferStatus; expires_at: string | null }): TransferStatus =>
  t.status === "ready" && t.expires_at && new Date(t.expires_at).getTime() < Date.now() ? "expired" : t.status;

/**
 * « Partagés avec moi » : mon adresse parmi les destinataires, ou transfert qu'on m'a fait suivre
 * (hors les miens). sharedBy : qui me l'a fait suivre en dernier, si je ne l'ai pas reçu directement.
 */
async function receivedTransferRows(member: { id: string; email: string }) {
  const s = createServiceClient();
  const [{ data: direct, error }, { data: forwards }] = await Promise.all([
    s.from("transfers").select(LIST_COLUMNS).contains("recipients", [member.email]).neq("status", "uploading").order("created_at", { ascending: false }).limit(500),
    s.from("transfer_forwards").select("transfer_id, forwarded_by, created_at").contains("recipients", [member.email]).order("created_at", { ascending: false }).limit(500),
  ]);
  if (error) throw new Error(error.message);
  const known = new Set((direct ?? []).map((t) => t.id));
  const lastForward = new Map<string, string | null>();
  for (const f of forwards ?? []) if (!lastForward.has(f.transfer_id)) lastForward.set(f.transfer_id, f.forwarded_by);
  const missing = [...lastForward.keys()].filter((id) => !known.has(id));
  const byIds = [...new Set(missing.map((id) => lastForward.get(id)).filter((x): x is string => !!x))];
  const [{ data: forwarded }, { data: people }] = await Promise.all([
    missing.length ? s.from("transfers").select(LIST_COLUMNS).in("id", missing).neq("status", "uploading") : Promise.resolve({ data: [] }),
    byIds.length ? s.from("profiles").select("id, first_name, last_name, email").in("id", byIds) : Promise.resolve({ data: [] }),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—"]));
  return [
    ...(direct ?? []).map((t) => ({ ...t, shared_by: null as string | null })),
    ...(forwarded ?? []).map((t) => ({ ...t, shared_by: nameOf.get(lastForward.get(t.id) ?? "") ?? "—" })),
  ]
    .filter((t) => t.sender_user_id !== member.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listTransfers(filters: TransferFilters): Promise<ActionResult<TransferRow[]>> {
  return toResult(async () => loadTransferRows(await requireMember(), filters));
}

// Colonnes de la liste (pas le message, jusqu'à 5 000 caractères par transfert).
const LIST_COLUMNS =
  "id, code, status, source, sender_email, sender_name, sender_user_id, title, recipients, file_count, total_bytes, download_count, view_count, last_download_at, archived, created_at, expires_at";

async function loadTransferRows(member: { id: string; email: string; isAdmin: boolean }, filters: TransferFilters): Promise<TransferRow[]> {
  {
    let data: Awaited<ReturnType<typeof receivedTransferRows>>;
    if (filters.scope === "received") {
      data = await receivedTransferRows(member);
    } else {
      const supabase = await createClient();
      let q = supabase.from("transfers").select(LIST_COLUMNS).order("created_at", { ascending: false }).limit(500);
      if (filters.scope === "mine" || !member.isAdmin) q = q.eq("sender_user_id", member.id);
      if (filters.from) q = q.gte("created_at", new Date(`${filters.from}T00:00:00`).toISOString());
      if (filters.to) q = q.lt("created_at", new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86400_000).toISOString());
      const res = await q;
      if (res.error) throw new Error(res.error.message);
      data = (res.data ?? []).map((t) => ({ ...t, shared_by: null }));
    }
    const fromIso = filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : null;
    const toIso = filters.to ? new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86400_000).toISOString() : null;
    const needle = (filters.q ?? "").trim().toLowerCase();
    const rows = data
      .filter((t) => (!fromIso || t.created_at >= fromIso) && (!toIso || t.created_at < toIso))
      .filter((t) => (filters.status === "downloaded" ? t.download_count > 0 : filters.status === "never" ? t.download_count === 0 : true))
      .map((t) => ({
        id: t.id,
        code: t.code,
        link: transferLink(t.code),
        status: effectiveStatus(t),
        source: t.source,
        senderEmail: t.sender_email,
        senderName: t.sender_name,
        title: t.title,
        recipients: t.recipients,
        fileCount: t.file_count,
        totalBytes: t.total_bytes,
        downloadCount: t.download_count,
        viewCount: t.view_count,
        lastDownloadAt: t.last_download_at,
        archived: t.archived,
        createdAt: t.created_at,
        expiresAt: t.expires_at,
        mine: t.sender_user_id === member.id,
        canManage: t.sender_user_id === member.id || member.isAdmin,
        sharedBy: t.shared_by,
        forwardedTo: [] as string[],
        cards: [] as { id: string; title: string }[],
      }))
      .filter((t) => (filters.status && filters.status !== "downloaded" ? t.status === (filters.status === "never" ? "ready" : filters.status) : true))
      .filter((t) => !needle || [t.title, t.senderEmail, t.senderName, t.code, ...t.recipients].some((s) => s.toLowerCase().includes(needle)));
    await addForwardsAndCards(member, rows);
    return rows;
  }
}

const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/**
 * Complète les lignes : à qui chaque transfert a été fait suivre (tout pour l'expéditeur ou un admin,
 * sinon seulement les suivis faits par moi ou vers moi) et les cartes visibles où il est joint.
 * Sans la migration du 19/10 (tables absentes), les lignes restent telles quelles.
 */
async function addForwardsAndCards(member: { id: string; email: string }, rows: TransferRow[]) {
  if (!rows.length) return;
  const s = createServiceClient();
  const supabase = await createClient();
  const ids = rows.map((r) => r.id);
  const parts = chunks(ids, 100);
  const [forwards, links, { data: people }] = await Promise.all([
    Promise.all(parts.map((p) => s.from("transfer_forwards").select("transfer_id, forwarded_by, recipients").in("transfer_id", p))).then((rs) => rs.flatMap((r) => r.data ?? [])),
    Promise.all(parts.map((p) => supabase.from("team_card_transfers").select("transfer_id, card_id").in("transfer_id", p))).then((rs) => rs.flatMap((r) => r.data ?? [])),
    s.from("profiles").select("first_name, last_name, email").not("email", "is", null),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.email!.toLowerCase(), [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email!]));
  const cardIds = [...new Set(links.map((l) => l.card_id))];
  const cards = (await Promise.all(chunks(cardIds, 100).map((p) => supabase.from("team_cards").select("id, title").in("id", p)))).flatMap((r) => r.data ?? []);
  const cardTitle = new Map(cards.map((c) => [c.id, c.title]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const f of forwards) {
    const row = byId.get(f.transfer_id);
    if (!row || !(row.canManage || f.forwarded_by === member.id || f.recipients.includes(member.email))) continue;
    for (const e of f.recipients) {
      const label = nameOf.get(e) ?? e;
      if (!row.forwardedTo.includes(label)) row.forwardedTo.push(label);
    }
  }
  for (const l of links) {
    const row = byId.get(l.transfer_id ?? "");
    const title = cardTitle.get(l.card_id);
    if (row && title !== undefined && !row.cards.some((c) => c.id === l.card_id)) row.cards.push({ id: l.card_id, title });
  }
}

export type TransferDetail = {
  files: { id: string; name: string; mimeType: string; size: number; downloadCount: number; fromBoardDrive: boolean; preview: TransferPreview }[];
  /** Historique : expéditeur et admins seulement. */
  downloads: { at: string; fileName: string | null }[];
  message: string;
  driveFolderUrl: string | null;
  forwards: { at: string; by: string; recipients: string[]; note: string }[];
  /** Cartes de l'Espace Team (visibles par moi) où le transfert est joint. */
  cards: { id: string; title: string }[];
};

export async function getTransferDetail(id: string): Promise<ActionResult<TransferDetail>> {
  return toResult(async () => {
    const member = await requireMember();
    const { t, access } = await transferAccessFor(member, id);
    const s = createServiceClient();
    const supabase = await createClient();
    const [{ data: files }, { data: downloads }, { data: forwards }, { data: links }, storage] = await Promise.all([
      s.from("transfer_files").select("*").eq("transfer_id", id).order("position"),
      access === "manage" ? s.from("transfer_downloads").select("at, file_id").eq("transfer_id", id).order("at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
      s.from("transfer_forwards").select("created_at, forwarded_by, recipients, note").eq("transfer_id", id).order("created_at", { ascending: false }).limit(100),
      supabase.from("team_card_transfers").select("card_id").eq("transfer_id", id),
      getTransferStorage(),
    ]);
    // Destinataire : seulement les suivis qu'il a faits ou reçus (pas ceux des autres).
    const visibleForwards = (forwards ?? []).filter((f) => access === "manage" || f.forwarded_by === member.id || f.recipients.includes(member.email));
    const byIds = [...new Set(visibleForwards.map((f) => f.forwarded_by).filter((x): x is string => !!x))];
    const cardIds = [...new Set((links ?? []).map((l) => l.card_id))];
    const [{ data: people }, { data: cards }] = await Promise.all([
      byIds.length ? s.from("profiles").select("id, first_name, last_name, email").in("id", byIds) : Promise.resolve({ data: [] }),
      cardIds.length ? supabase.from("team_cards").select("id, title").in("id", cardIds) : Promise.resolve({ data: [] }),
    ]);
    const nameOf = new Map((people ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—"]));
    const names = new Map((files ?? []).map((f) => [f.id, f.name]));
    const live = effectiveStatus(t) === "ready";
    return {
      message: t.message,
      driveFolderUrl: access === "manage" && t.drive_folder_id && storage?.provider === "google" ? `https://drive.google.com/drive/folders/${t.drive_folder_id}` : null,
      files: (files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mime_type,
        size: f.size_bytes,
        downloadCount: f.download_count,
        fromBoardDrive: f.from_board_drive,
        preview: live && storage && f.drive_file_id ? storage.preview(f.drive_file_id, f.mime_type) : { kind: "none" as const },
      })),
      downloads: (downloads ?? []).map((d) => ({ at: d.at, fileName: d.file_id ? names.get(d.file_id) ?? null : null })),
      forwards: visibleForwards.map((f) => ({ at: f.created_at, by: (f.forwarded_by && nameOf.get(f.forwarded_by)) || "—", recipients: f.recipients, note: f.note })),
      cards: (cards ?? []).map((c) => ({ id: c.id, title: c.title })),
    };
  });
}

/** Membres du board à qui faire suivre un transfert (sauf moi). */
export async function listTransferPeople(): Promise<ActionResult<{ id: string; name: string; email: string }[]>> {
  return toResult(async () => {
    const member = await requireMember();
    const { data, error } = await createServiceClient().from("profiles").select("id, first_name, last_name, email").not("email", "is", null).order("first_name");
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((p) => p.id !== member.id && p.email)
      .map((p) => ({ id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email!, email: p.email!.toLowerCase() }));
  });
}

/**
 * Fait suivre le transfert (expéditeur, admin ou destinataire) : à des membres du board (onglet
 * « Partagés avec moi » + notification) et/ou à des adresses (e-mail avec le lien), avec un mot.
 * Une adresse qui est celle d'un membre est traitée comme ce membre.
 */
export async function forwardTransfer(id: string, input: { memberIds: string[]; emails: string[]; note: string }): Promise<ActionResult<{ members: number; emails: number }>> {
  return toResult(async () => {
    const member = await requireMember();
    await transferAccessFor(member, id);
    const typed = [...new Set(input.emails.map((r) => r.trim().toLowerCase()).filter(Boolean))];
    if (typed.some((r) => !isEmail(r))) throw new Error("Une adresse est invalide.");
    const { data: people, error } = await createServiceClient().from("profiles").select("id, email").not("email", "is", null);
    if (error) throw new Error(error.message);
    const byEmail = new Map((people ?? []).map((p) => [p.email!.toLowerCase(), p.id]));
    const byId = new Map((people ?? []).map((p) => [p.id, p.email!.toLowerCase()]));
    const memberIds = new Set([...input.memberIds.filter((x) => byId.has(x)), ...typed.flatMap((e) => (byEmail.has(e) ? [byEmail.get(e)!] : []))]);
    memberIds.delete(member.id);
    const members = [...memberIds].map((mid) => ({ id: mid, email: byId.get(mid)! }));
    const emails = typed.filter((e) => !byEmail.has(e));
    if (!members.length && !emails.length) throw new Error("Choisissez au moins une personne ou une adresse.");
    if (members.length + emails.length > 30) throw new Error("30 destinataires au maximum par envoi.");
    await shareTransfer(id, { id: member.id, name: member.name, email: member.email }, { emails, members }, input.note.trim().slice(0, 2000));
    return { members: members.length, emails: emails.length };
  });
}

/* ---------- Actions sur un transfert ---------- */

/** Transfert géré par l'utilisateur (RLS : le sien, ou admin) — un destinataire ne peut pas le modifier. */
async function ownTransfer(id: string) {
  const member = await requireMember();
  const supabase = await createClient();
  const { data: t } = await supabase.from("transfers").select("id, status, sender_email, expires_at").eq("id", id).maybeSingle();
  if (!t) throw new Error("Transfert introuvable.");
  return { member, t };
}

export async function revokeTransfer(id: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    await ownTransfer(id);
    await closeTransfer(id, "revoked");
    return null;
  });
}

/** Nouvelle durée à partir d'aujourd'hui (null = sans expiration), dans la limite de la formule de l'expéditeur. */
export async function extendTransfer(id: string, days: number | null): Promise<ActionResult<null>> {
  return toResult(async () => {
    const { member, t } = await ownTransfer(id);
    if (t.status !== "ready") throw new Error("Seul un transfert actif peut être prolongé.");
    if (!member.isAdmin) {
      const { plan } = await resolvePlan(t.sender_email);
      if (plan.maxDays !== null && (days === null || days > plan.maxDays)) throw new Error(`Formule « ${plan.name} » : ${plan.maxDays} jours au maximum.`);
    }
    const expiresAt = days === null ? null : new Date(Date.now() + Math.max(1, Math.round(days)) * 86400_000).toISOString();
    const { error } = await createServiceClient().from("transfers").update({ expires_at: expiresAt }).eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

/**
 * Modifie titre, message et destinataires. Destinataires ajoutés à un transfert actif : ils reçoivent
 * l'e-mail si `notifyAdded` (les autres ne sont pas relancés).
 */
export async function updateTransfer(
  id: string,
  patch: { title: string; message: string; recipients: string[]; notifyAdded: boolean }
): Promise<ActionResult<{ notified: number }>> {
  return toResult(async () => {
    const { t } = await ownTransfer(id);
    const recipients = [...new Set(patch.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
    if (recipients.some((r) => !isEmail(r))) throw new Error("Une adresse de destinataire est invalide.");
    if (recipients.length > 50) throw new Error("50 destinataires au maximum.");
    const { data: before } = await createServiceClient().from("transfers").select("recipients").eq("id", id).single();
    const added = recipients.filter((r) => !(before?.recipients ?? []).includes(r));
    const { error } = await createServiceClient()
      .from("transfers")
      .update({ title: patch.title.trim().slice(0, 200), message: patch.message.trim().slice(0, 5000), recipients })
      .eq("id", id);
    if (error) throw new Error(error.message);
    if (patch.notifyAdded && added.length && t.status === "ready") {
      await resendTransferEmails(id, added);
      return { notified: added.length };
    }
    return { notified: 0 };
  });
}

/** Supprime le transfert : lien coupé, fichiers envoyés supprimés définitivement du Drive (sauf archivés), retiré de la liste. */
export async function deleteTransfer(id: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    await ownTransfer(id);
    await closeTransfer(id, "revoked");
    const { error } = await createServiceClient().from("transfers").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function resendTransfer(id: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    await ownTransfer(id);
    await resendTransferEmails(id);
    return null;
  });
}

export async function setTransferArchived(id: string, archived: boolean): Promise<ActionResult<null>> {
  return toResult(async () => {
    const { member, t } = await ownTransfer(id);
    if (archived && !member.isAdmin) {
      const { plan } = await resolvePlan(t.sender_email);
      if (!plan.canArchive) throw new Error(`La formule « ${plan.name} » ne permet pas l'archivage.`);
    }
    const { error } = await createServiceClient().from("transfers").update({ archived }).eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

/* ---------- Statistiques (admins) ---------- */

export type TransferStats = { active: number; activeBytes: number; last30: number; downloads30: number; byMonth: { month: string; count: number; bytes: number }[] };

export async function getTransferStats(): Promise<ActionResult<TransferStats>> {
  return toResult(async () => {
    await requireAdmin();
    const s = createServiceClient();
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * 86400_000).toISOString();
    const since12m = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1).toISOString();
    const [{ data: active }, { count: last30 }, { count: downloads30 }, { data: year }] = await Promise.all([
      s.from("transfers").select("total_bytes, expires_at").eq("status", "ready"),
      s.from("transfers").select("id", { count: "exact", head: true }).gte("created_at", since30).neq("status", "uploading"),
      s.from("transfer_downloads").select("id", { count: "exact", head: true }).gte("at", since30),
      s.from("transfers").select("created_at, total_bytes").gte("created_at", since12m).neq("status", "uploading"),
    ]);
    const live = (active ?? []).filter((t) => !t.expires_at || new Date(t.expires_at).getTime() > Date.now());
    const months = new Map<string, { count: number; bytes: number }>();
    for (const t of year ?? []) {
      const k = t.created_at.slice(0, 7);
      const m = months.get(k) ?? { count: 0, bytes: 0 };
      m.count++;
      m.bytes += t.total_bytes;
      months.set(k, m);
    }
    return {
      active: live.length,
      activeBytes: live.reduce((n, t) => n + t.total_bytes, 0),
      last30: last30 ?? 0,
      downloads30: downloads30 ?? 0,
      byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
    };
  });
}

/* ---------- Onglet Statistiques ---------- */

export type TransferAnalytics = {
  totals: {
    transfers: number;
    bytes: number;
    files: number;
    views: number;
    uniqueVisitors: number;
    downloads: number;
    uniqueDownloaders: number;
    senders: number;
    memberSenders: number;
    externalSenders: number;
    recipients: number;
  };
  /** Pubs (admins) : cumul depuis leur création. */
  ads: { impressions: number; clicks: number } | null;
  bucket: "day" | "week" | "month";
  series: { key: string; transfers: number; views: number; downloads: number }[];
  topFiles: { id: string; name: string; transferTitle: string; code: string; sender: string; size: number; downloads: number; people: number }[];
  topTransfers: { id: string; title: string; code: string; sender: string; views: number; visitors: number; downloads: number }[];
  topSenders: { email: string; name: string; member: boolean; transfers: number; bytes: number; downloads: number }[];
};

const PAGE = 1000;

/** Lecture paginée (PostgREST plafonne à 1000 lignes par requête). */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 50_000) {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));
function bucketKey(iso: string, bucket: TransferAnalytics["bucket"]) {
  const d = dayKey(iso);
  if (bucket === "month") return d.slice(0, 7);
  if (bucket === "day") return d;
  const date = new Date(`${d}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); // lundi
  return date.toISOString().slice(0, 10);
}

export async function getTransferAnalytics(filters: { scope: "mine" | "all"; from?: string; to?: string }): Promise<ActionResult<TransferAnalytics>> {
  return toResult(async () => {
    const member = await requireMember();
    const supabase = await createClient();
    const mineOnly = filters.scope === "mine" || !member.isAdmin;
    const fromIso = filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : null;
    const toIso = filters.to ? new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86400_000).toISOString() : null;

    // Transferts concernés (tous ceux visibles ; « les miens » : envoyés par soi).
    const all = await fetchAll((a, b) => {
      let q = supabase
        .from("transfers")
        .select("id, code, title, sender_email, sender_name, sender_user_id, recipients, total_bytes, file_count, created_at, status")
        .neq("status", "uploading")
        .order("created_at")
        .range(a, b);
      if (mineOnly) q = q.eq("sender_user_id", member.id);
      return q;
    });
    const byId = new Map(all.map((t) => [t.id, t]));
    const inRange = (iso: string) => (!fromIso || iso >= fromIso) && (!toIso || iso < toIso);
    const transfers = all.filter((t) => inRange(t.created_at));

    const scoped = <T extends { transfer_id: string }>(rows: T[]) => rows.filter((r) => byId.has(r.transfer_id));
    const [views, downloads] = await Promise.all([
      fetchAll((a, b) => {
        let q = supabase.from("transfer_views").select("transfer_id, visitor, at").order("at").range(a, b);
        if (fromIso) q = q.gte("at", fromIso);
        if (toIso) q = q.lt("at", toIso);
        return q;
      }).then(scoped),
      fetchAll((a, b) => {
        let q = supabase.from("transfer_downloads").select("transfer_id, file_id, visitor, at").order("at").range(a, b);
        if (fromIso) q = q.gte("at", fromIso);
        if (toIso) q = q.lt("at", toIso);
        return q;
      }).then(scoped),
    ]);

    // Expéditeurs : membre du board si le transfert est rattaché à un compte.
    const senders = new Map<string, { email: string; name: string; member: boolean; transfers: number; bytes: number; downloads: number }>();
    for (const t of transfers) {
      const s = senders.get(t.sender_email) ?? { email: t.sender_email, name: t.sender_name, member: false, transfers: 0, bytes: 0, downloads: 0 };
      s.transfers++;
      s.bytes += t.total_bytes;
      s.member ||= !!t.sender_user_id;
      s.name ||= t.sender_name;
      senders.set(t.sender_email, s);
    }
    for (const d of downloads) {
      const s = senders.get(byId.get(d.transfer_id)!.sender_email);
      if (s) s.downloads++;
    }

    // Courbe : par jour (≤ 3 mois), par semaine (≤ 13 mois), par mois au-delà.
    const first = fromIso ?? all[0]?.created_at ?? new Date().toISOString();
    const end = toIso ? new Date(toIso).getTime() - 1 : Date.now();
    const spanDays = (end - new Date(first).getTime()) / 86400_000;
    const bucket: TransferAnalytics["bucket"] = spanDays <= 92 ? "day" : spanDays <= 400 ? "week" : "month";
    const series = new Map<string, { key: string; transfers: number; views: number; downloads: number }>();
    for (let t = new Date(first).getTime(); t <= end; t += 86400_000) {
      const key = bucketKey(new Date(t).toISOString(), bucket);
      if (!series.has(key)) series.set(key, { key, transfers: 0, views: 0, downloads: 0 });
    }
    const bump = (iso: string, k: "transfers" | "views" | "downloads") => {
      const key = bucketKey(iso, bucket);
      const row = series.get(key) ?? { key, transfers: 0, views: 0, downloads: 0 };
      row[k]++;
      series.set(key, row);
    };
    transfers.forEach((t) => bump(t.created_at, "transfers"));
    views.forEach((v) => bump(v.at, "views"));
    downloads.forEach((d) => bump(d.at, "downloads"));

    // Documents les plus téléchargés sur la période (personnes distinctes par empreinte).
    const perFile = new Map<string, { downloads: number; people: Set<string>; transferId: string }>();
    for (const d of downloads) {
      if (!d.file_id) continue;
      const f = perFile.get(d.file_id) ?? { downloads: 0, people: new Set<string>(), transferId: d.transfer_id };
      f.downloads++;
      if (d.visitor) f.people.add(d.visitor);
      perFile.set(d.file_id, f);
    }
    const topFileIds = [...perFile.entries()]
      .sort((a, b) => b[1].downloads - a[1].downloads)
      .slice(0, 20)
      .map(([id]) => id);
    const { data: fileRows } = topFileIds.length ? await supabase.from("transfer_files").select("id, name, size_bytes").in("id", topFileIds) : { data: [] };
    const fileMeta = new Map((fileRows ?? []).map((f) => [f.id, f]));

    const perTransfer = new Map<string, { views: number; visitors: Set<string>; downloads: number }>();
    const stat = (id: string) => {
      if (!perTransfer.has(id)) perTransfer.set(id, { views: 0, visitors: new Set(), downloads: 0 });
      return perTransfer.get(id)!;
    };
    views.forEach((v) => {
      const p = stat(v.transfer_id);
      p.views++;
      if (v.visitor) p.visitors.add(v.visitor);
    });
    downloads.forEach((d) => stat(d.transfer_id).downloads++);

    const recipients = new Set(transfers.flatMap((t) => t.recipients));
    const senderList = [...senders.values()];

    let ads: TransferAnalytics["ads"] = null;
    if (!mineOnly) {
      const { data: adRows } = await supabase.from("transfer_ads").select("impressions, clicks");
      ads = (adRows ?? []).reduce((acc, a) => ({ impressions: acc.impressions + a.impressions, clicks: acc.clicks + a.clicks }), { impressions: 0, clicks: 0 });
    }

    return {
      totals: {
        transfers: transfers.length,
        bytes: transfers.reduce((n, t) => n + t.total_bytes, 0),
        files: transfers.reduce((n, t) => n + t.file_count, 0),
        views: views.length,
        uniqueVisitors: new Set(views.map((v) => v.visitor).filter(Boolean)).size,
        downloads: downloads.length,
        uniqueDownloaders: new Set(downloads.map((d) => d.visitor).filter(Boolean)).size,
        senders: senderList.length,
        memberSenders: senderList.filter((s) => s.member).length,
        externalSenders: senderList.filter((s) => !s.member).length,
        recipients: recipients.size,
      },
      ads,
      bucket,
      series: [...series.values()].sort((a, b) => a.key.localeCompare(b.key)),
      topFiles: topFileIds.map((id) => {
        const f = perFile.get(id)!;
        const t = byId.get(f.transferId)!;
        return {
          id,
          name: fileMeta.get(id)?.name ?? "Fichier",
          size: fileMeta.get(id)?.size_bytes ?? 0,
          transferTitle: t.title,
          code: t.code,
          sender: t.sender_name || t.sender_email,
          downloads: f.downloads,
          people: f.people.size,
        };
      }),
      topTransfers: [...perTransfer.entries()]
        .sort((a, b) => b[1].views + b[1].downloads - (a[1].views + a[1].downloads))
        .slice(0, 15)
        .map(([id, p]) => {
          const t = byId.get(id)!;
          return { id, title: t.title || `${t.file_count} fichier${t.file_count > 1 ? "s" : ""}`, code: t.code, sender: t.sender_name || t.sender_email, views: p.views, visitors: p.visitors.size, downloads: p.downloads };
        }),
      topSenders: senderList.sort((a, b) => b.transfers - a.transfers || b.bytes - a.bytes).slice(0, 20),
    };
  });
}

/* ---------- Formules et attributions (admins) ---------- */

export type TransferPlanRow = {
  id: string;
  name: string;
  description: string;
  maxSizeBytes: number | null;
  maxDays: number | null;
  isDefault: boolean;
  isMembersDefault: boolean;
  canArchive: boolean;
  assignedCount: number;
};

export type TransferAssignmentRow = { email: string; planId: string; validUntil: string | null; note: string; memberName: string | null };

export async function listTransferPlans(): Promise<ActionResult<{ plans: TransferPlanRow[]; assignments: TransferAssignmentRow[]; people: { email: string; name: string }[] }>> {
  return toResult(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const [{ data: plans }, { data: assignments }, { data: people }] = await Promise.all([
      supabase.from("transfer_plans").select("*").order("position").order("created_at"),
      supabase.from("transfer_plan_assignments").select("*").order("email"),
      supabase.from("profiles").select("email, first_name, last_name").not("email", "is", null).order("last_name"),
    ]);
    const nameByEmail = new Map((people ?? []).map((p) => [(p.email ?? "").toLowerCase(), [p.first_name, p.last_name].filter(Boolean).join(" ")]));
    return {
      plans: (plans ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        maxSizeBytes: p.max_size_bytes,
        maxDays: p.max_days,
        isDefault: p.is_default,
        isMembersDefault: p.is_members_default,
        canArchive: p.can_archive,
        assignedCount: (assignments ?? []).filter((a) => a.plan_id === p.id).length,
      })),
      assignments: (assignments ?? []).map((a) => ({ email: a.email, planId: a.plan_id, validUntil: a.valid_until, note: a.note, memberName: nameByEmail.get(a.email) || null })),
      people: (people ?? []).filter((p) => p.email).map((p) => ({ email: p.email!.toLowerCase(), name: [p.first_name, p.last_name].filter(Boolean).join(" ") })),
    };
  });
}

export async function saveTransferPlan(plan: Omit<TransferPlanRow, "assignedCount" | "id"> & { id: string | null }): Promise<ActionResult<null>> {
  return toResult(async () => {
    await requireAdmin();
    if (!plan.name.trim()) throw new Error("Donnez un nom à la formule.");
    if (plan.maxSizeBytes !== null && !(plan.maxSizeBytes > 0)) throw new Error("Taille maximale invalide.");
    if (plan.maxDays !== null && !(plan.maxDays >= 1)) throw new Error("Durée maximale invalide.");
    const supabase = await createClient();
    // Une seule formule « par défaut » et une seule « membres » : on retire le drapeau aux autres d'abord.
    if (plan.isDefault) {
      let q = supabase.from("transfer_plans").update({ is_default: false }).eq("is_default", true);
      if (plan.id) q = q.neq("id", plan.id);
      await q;
    }
    if (plan.isMembersDefault) {
      let q = supabase.from("transfer_plans").update({ is_members_default: false }).eq("is_members_default", true);
      if (plan.id) q = q.neq("id", plan.id);
      await q;
    }
    const row = {
      name: plan.name.trim().slice(0, 80),
      description: plan.description.trim().slice(0, 300),
      max_size_bytes: plan.maxSizeBytes === null ? null : Math.round(plan.maxSizeBytes),
      max_days: plan.maxDays === null ? null : Math.round(plan.maxDays),
      is_default: plan.isDefault,
      is_members_default: plan.isMembersDefault,
      can_archive: plan.canArchive,
    };
    const { error } = plan.id ? await supabase.from("transfer_plans").update(row).eq("id", plan.id) : await supabase.from("transfer_plans").insert({ ...row, position: 100 });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function deleteTransferPlan(id: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const { data: p } = await supabase.from("transfer_plans").select("is_default, is_members_default").eq("id", id).single();
    if (p?.is_default || p?.is_members_default) throw new Error("Choisissez d'abord une autre formule par défaut / membres.");
    const { error } = await supabase.from("transfer_plans").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function saveTransferAssignment(a: { email: string; planId: string; validUntil: string | null; note: string }): Promise<ActionResult<null>> {
  return toResult(async () => {
    const admin = await requireAdmin();
    const email = a.email.trim().toLowerCase();
    if (!isEmail(email)) throw new Error("Adresse e-mail invalide.");
    if (!a.planId) throw new Error("Choisissez une formule.");
    const supabase = await createClient();
    const { error } = await supabase
      .from("transfer_plan_assignments")
      .upsert({ email, plan_id: a.planId, valid_until: a.validUntil || null, note: a.note.trim().slice(0, 300), created_by: admin.id });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function deleteTransferAssignment(email: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase.from("transfer_plan_assignments").delete().eq("email", email);
    if (error) throw new Error(error.message);
    return null;
  });
}

/* ---------- Publicités (admins) ---------- */

export type TransferAdRow = {
  id: string;
  title: string;
  advertiser: string;
  mediaType: "image" | "video";
  mediaDriveFileId: string;
  linkUrl: string | null;
  format: "wallpaper" | "banner";
  placements: ("upload" | "download")[];
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  weight: number;
  impressions: number;
  clicks: number;
};

export async function listTransferAds(): Promise<ActionResult<TransferAdRow[]>> {
  return toResult(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const { data, error } = await supabase.from("transfer_ads").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      advertiser: a.advertiser,
      mediaType: a.media_type,
      mediaDriveFileId: a.media_drive_file_id,
      linkUrl: a.link_url,
      format: a.format,
      placements: a.placements.filter((p): p is "upload" | "download" => p === "upload" || p === "download"),
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      active: a.active,
      weight: a.weight,
      impressions: a.impressions,
      clicks: a.clicks,
    }));
  });
}

export async function saveTransferAd(ad: Omit<TransferAdRow, "id" | "impressions" | "clicks"> & { id: string | null }): Promise<ActionResult<null>> {
  return toResult(async () => {
    const admin = await requireAdmin();
    if (!ad.title.trim()) throw new Error("Donnez un nom à la pub.");
    if (!ad.mediaDriveFileId) throw new Error("Ajoutez une image ou une vidéo.");
    if (!ad.placements.length) throw new Error("Choisissez au moins un emplacement.");
    const link = ad.linkUrl?.trim() || null;
    if (link && !/^https?:\/\//i.test(link)) throw new Error("Le lien doit commencer par https://");
    if (ad.startsAt && ad.endsAt && ad.endsAt < ad.startsAt) throw new Error("La fin est avant le début.");
    const row = {
      title: ad.title.trim().slice(0, 120),
      advertiser: ad.advertiser.trim().slice(0, 120),
      media_type: ad.mediaType,
      media_drive_file_id: ad.mediaDriveFileId,
      link_url: link,
      format: ad.format,
      placements: ad.placements,
      starts_at: ad.startsAt || null,
      ends_at: ad.endsAt || null,
      active: ad.active,
      weight: Math.min(100, Math.max(1, Math.round(ad.weight))),
    };
    const supabase = await createClient();
    const { error } = ad.id ? await supabase.from("transfer_ads").update(row).eq("id", ad.id) : await supabase.from("transfer_ads").insert({ ...row, created_by: admin.id });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function deleteTransferAd(id: string): Promise<ActionResult<null>> {
  return toResult(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const { data: ad } = await supabase.from("transfer_ads").select("media_drive_file_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("transfer_ads").delete().eq("id", id);
    if (error) throw new Error(error.message);
    if (ad) await (await getTransferStorage())?.trash(ad.media_drive_file_id).catch(() => undefined);
    return null;
  });
}
