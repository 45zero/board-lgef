import "server-only";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { format } from "date-fns";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getTransferStorage, type TransferPreview } from "@/lib/transfer/storage";
import { GB, isEmail, type TransferAdView, type TransferPlanLimits, type UploadTarget } from "@/lib/transfer/shared";
import { sendCodeEmail, sendDownloadNoticeEmail, sendTransferEmails } from "@/lib/transfer/emails";

// LGEF Transfer — logique serveur (sans session : la page publique passe par ici en service role).
// Voir sql/2026-10-13_lgef_transfer.sql pour le modèle.

const svc = () => createServiceClient();

/* ---------- Jetons signés (vérification e-mail, envoi des morceaux) ---------- */

function secret() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY manquante");
  return key;
}

const hmac = (s: string) => createHmac("sha256", secret()).update(s).digest("hex");

/** Jeton `<expiration>.<signature>` pour un usage (« sender », « upload ») et un sujet (e-mail, id). */
export function signToken(purpose: string, subject: string, ttlMs: number) {
  const exp = Date.now() + ttlMs;
  return `${exp}.${hmac(`${purpose}:${subject}:${exp}`)}`;
}

export function verifyToken(purpose: string, subject: string, token: string | null | undefined) {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  const a = Buffer.from(hmac(`${purpose}:${subject}:${exp}`));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SENDER_TOKEN_TTL = 24 * 3600_000;
export const UPLOAD_TOKEN_TTL = 48 * 3600_000;

/* ---------- Adresses ---------- */

export function transferBaseUrl() {
  return (process.env.NEXT_PUBLIC_TRANSFER_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
}
export const transferLink = (code: string) => `${transferBaseUrl()}/t/${code}`;

const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

/* ---------- Formules ---------- */

const FALLBACK_PLAN: TransferPlanLimits = { id: "", name: "Gratuit", maxSizeBytes: 5 * GB, maxDays: 7, canArchive: false };

type PlanRow = { id: string; name: string; max_size_bytes: number | null; max_days: number | null; can_archive: boolean };
const toLimits = (p: PlanRow): TransferPlanLimits => ({ id: p.id, name: p.name, maxSizeBytes: p.max_size_bytes, maxDays: p.max_days, canArchive: p.can_archive });

/** Compte du board correspondant à une adresse (comparaison sans casse). */
export async function findMemberByEmail(email: string) {
  const escaped = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data } = await svc().from("profiles").select("id, first_name, last_name").ilike("email", escaped).limit(1).maybeSingle();
  return data ? { id: data.id, name: [data.first_name, data.last_name].filter(Boolean).join(" ") } : null;
}

/** Attribution nominative en cours > formule des membres (adresse d'un compte) > formule par défaut. */
export async function resolvePlan(email: string): Promise<{ plan: TransferPlanLimits; member: { id: string; name: string } | null }> {
  const s = svc();
  const [member, { data: assignment }, { data: plans }] = await Promise.all([
    findMemberByEmail(email),
    s.from("transfer_plan_assignments").select("plan_id, valid_until").eq("email", email).maybeSingle(),
    s.from("transfer_plans").select("id, name, max_size_bytes, max_days, can_archive, is_default, is_members_default"),
  ]);
  const all = plans ?? [];
  const assigned = assignment && (!assignment.valid_until || assignment.valid_until >= parisToday()) ? all.find((p) => p.id === assignment.plan_id) : undefined;
  const chosen = assigned ?? (member ? all.find((p) => p.is_members_default) : undefined) ?? all.find((p) => p.is_default);
  return { plan: chosen ? toLimits(chosen) : FALLBACK_PLAN, member };
}

/** Formule des expéditeurs sans compte (affichée avant vérification de l'adresse). */
export async function defaultPlan(): Promise<TransferPlanLimits> {
  const { data } = await svc().from("transfer_plans").select("id, name, max_size_bytes, max_days, can_archive").eq("is_default", true).maybeSingle();
  return data ? toLimits(data) : FALLBACK_PLAN;
}

/* ---------- Code de vérification de l'expéditeur ---------- */

const CODE_TTL = 15 * 60_000;

export async function sendVerificationCode(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!isEmail(email)) throw new Error("Adresse e-mail invalide.");
  const s = svc();
  const { data: existing } = await s.from("transfer_email_codes").select("sent_at").eq("email", email).maybeSingle();
  if (existing && Date.now() - new Date(existing.sent_at).getTime() < 45_000) throw new Error("Un code vient d'être envoyé — patientez quelques secondes avant d'en redemander un.");
  const code = String(randomInt(100000, 1000000));
  const { error } = await s.from("transfer_email_codes").upsert({
    email,
    code_hash: hmac(`code:${email}:${code}`),
    attempts: 0,
    expires_at: new Date(Date.now() + CODE_TTL).toISOString(),
    sent_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await sendCodeEmail(email, code);
}

/** Vérifie le code ; renvoie un jeton d'expéditeur (24 h) et sa formule. */
export async function verifyCode(rawEmail: string, rawCode: string) {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.replace(/\D/g, "");
  const s = svc();
  const { data: row } = await s.from("transfer_email_codes").select("*").eq("email", email).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) throw new Error("Code expiré — demandez-en un nouveau.");
  if (row.attempts >= 5) throw new Error("Trop d'essais — demandez un nouveau code.");
  const a = Buffer.from(hmac(`code:${email}:${code}`));
  const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await s.from("transfer_email_codes").update({ attempts: row.attempts + 1 }).eq("email", email);
    throw new Error("Code incorrect.");
  }
  await s.from("transfer_email_codes").delete().eq("email", email);
  const { plan, member } = await resolvePlan(email);
  return { senderToken: signToken("sender", email, SENDER_TOKEN_TTL), plan, memberName: member?.name ?? null };
}

/* ---------- Création ---------- */

export type CreateTransferInput = {
  senderEmail: string;
  senderName: string;
  senderUserId: string | null;
  source: "public" | "board";
  title: string;
  message: string;
  recipients: string[];
  /** null = sans expiration */
  days: number | null;
  archived: boolean;
  notifyOnDownload: boolean;
  files: { name: string; mimeType: string; size: number }[];
  /** Fichiers déjà dans le Drive du board (envoi depuis le board, comptes seulement). */
  boardFileIds: string[];
};

const newCode = () => randomBytes(12).toString("base64url").replace(/[-_]/g, "").slice(0, 10).padEnd(10, "x");

export async function requireTransferStorage() {
  const storage = await getTransferStorage();
  if (!storage) throw new Error("Le Drive du board n'est pas configuré — LGEF Transfer est indisponible pour le moment.");
  return storage;
}

/** Limiteur de parallélisme pour les appels au Drive. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

export async function createTransfer(input: CreateTransferInput): Promise<{ transferId: string; code: string; uploadToken: string; targets: UploadTarget[] }> {
  const email = input.senderEmail.trim().toLowerCase();
  const recipients = [...new Set(input.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  if (recipients.some((r) => !isEmail(r))) throw new Error("Une adresse de destinataire est invalide.");
  if (recipients.length > 50) throw new Error("50 destinataires au maximum.");
  if (input.boardFileIds.length && !input.senderUserId) throw new Error("Seuls les comptes du board peuvent envoyer des fichiers du Drive.");
  const files = input.files.filter((f) => f.name && f.size >= 0);
  if (files.length + input.boardFileIds.length === 0) throw new Error("Ajoutez au moins un fichier.");
  if (files.length + input.boardFileIds.length > 500) throw new Error("500 fichiers au maximum par transfert.");

  const storage = await requireTransferStorage();
  // Adresse d'un compte du board (même envoyé depuis la page publique) : le transfert apparaît dans son onglet.
  const { plan, member } = await resolvePlan(email);

  const boardFiles = await mapLimit(input.boardFileIds, 5, async (id) => {
    const info = await storage.fileInfo(id).catch(() => null);
    if (!info || info.trashed) throw new Error("Un fichier du Drive est introuvable.");
    return { id, ...info };
  });

  const total = files.reduce((n, f) => n + f.size, 0) + boardFiles.reduce((n, f) => n + f.size, 0);
  if (plan.maxSizeBytes !== null && total > plan.maxSizeBytes) {
    throw new Error(`Votre formule « ${plan.name} » permet ${Math.round(plan.maxSizeBytes / GB)} Go par transfert.`);
  }
  if (plan.maxDays !== null && (input.days === null || input.days > plan.maxDays)) {
    throw new Error(`Votre formule « ${plan.name} » permet ${plan.maxDays} jours au maximum.`);
  }
  const days = input.days === null ? null : Math.max(1, Math.round(input.days));

  const s = svc();
  const now = new Date();
  let transfer: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 3 && !transfer; attempt++) {
    const { data, error } = await s
      .from("transfers")
      .insert({
        code: newCode(),
        source: input.source,
        sender_email: email,
        sender_name: input.senderName.trim().slice(0, 120),
        sender_user_id: input.senderUserId ?? member?.id ?? null,
        plan_id: plan.id || null,
        title: input.title.trim().slice(0, 200),
        message: input.message.trim().slice(0, 5000),
        recipients,
        notify_on_download: input.notifyOnDownload,
        archived: input.archived && plan.canArchive,
        total_bytes: total,
        file_count: files.length + boardFiles.length,
        expires_at: days === null ? null : new Date(now.getTime() + days * 86400_000).toISOString(),
      })
      .select("id, code")
      .single();
    if (data) transfer = data;
    else if (error && error.code !== "23505") throw new Error(error.message);
  }
  if (!transfer) throw new Error("Création du transfert impossible, réessayez.");
  const created = transfer;

  try {
    const folderId = await storage.transferFolder(`${format(now, "dd HH'h'mm")} - ${input.senderName.trim() || email} - ${created.code}`, now);
    await s.from("transfers").update({ drive_folder_id: folderId }).eq("id", created.id);

    const rows = [
      ...boardFiles.map((f, i) => ({
        transfer_id: created.id,
        name: f.name,
        mime_type: f.mimeType || "application/octet-stream",
        size_bytes: f.size,
        drive_file_id: f.id,
        from_board_drive: true,
        uploaded: true,
        position: i,
      })),
      ...files.map((f, i) => ({ transfer_id: created.id, name: f.name.slice(0, 255), mime_type: f.mimeType || "application/octet-stream", size_bytes: f.size, position: boardFiles.length + i })),
    ];
    const { data: inserted, error } = await s.from("transfer_files").insert(rows).select("id, name, mime_type, size_bytes, from_board_drive, position");
    if (error || !inserted) throw new Error(error?.message ?? "Enregistrement des fichiers impossible.");

    const toUpload = inserted.filter((r) => !r.from_board_drive).sort((a, b) => a.position - b.position);
    const targets = await mapLimit(toUpload, 5, async (r) => {
      const t = await storage.createUpload(folderId, { name: r.name, mimeType: r.mime_type, size: r.size_bytes });
      return { fileRowId: r.id, ...t };
    });
    return { transferId: created.id, code: created.code, uploadToken: signToken("upload", created.id, UPLOAD_TOKEN_TTL), targets };
  } catch (e) {
    await s.from("transfers").delete().eq("id", created.id);
    throw e;
  }
}

/* ---------- Finalisation ---------- */

export async function completeTransfer(transferId: string, uploaded: { fileRowId: string; driveFileId: string }[]) {
  const s = svc();
  const { data: t } = await s.from("transfers").select("*").eq("id", transferId).single();
  if (!t) throw new Error("Transfert introuvable.");
  if (t.status === "ready") return { code: t.code, link: transferLink(t.code) };
  if (t.status !== "uploading") throw new Error("Ce transfert n'est plus modifiable.");
  const storage = await requireTransferStorage();
  const { data: files } = await s.from("transfer_files").select("*").eq("transfer_id", transferId).order("position");

  const byRow = new Map(uploaded.map((u) => [u.fileRowId, u.driveFileId]));
  await mapLimit(files ?? [], 5, async (f) => {
    if (f.from_board_drive) {
      await storage.publish(f.drive_file_id!);
      return;
    }
    const driveId = byRow.get(f.id);
    if (!driveId) throw new Error(`« ${f.name} » n'a pas été envoyé.`);
    const info = await storage.fileInfo(driveId).catch(() => null);
    if (!info || info.trashed || (t.drive_folder_id && !info.parents.includes(t.drive_folder_id))) throw new Error(`« ${f.name} » est introuvable dans le Drive.`);
    if (info.size !== f.size_bytes) {
      await storage.trash(driveId).catch(() => undefined);
      throw new Error(`« ${f.name} » est arrivé incomplet — renvoyez-le.`);
    }
    await storage.publish(driveId);
    await s.from("transfer_files").update({ drive_file_id: driveId, uploaded: true }).eq("id", f.id);
  });

  // La durée court à partir de la fin de l'envoi (un gros envoi peut prendre des heures).
  const now = Date.now();
  const expiresAt = t.expires_at ? new Date(new Date(t.expires_at).getTime() + (now - new Date(t.created_at).getTime())).toISOString() : null;
  await s.from("transfers").update({ status: "ready", ready_at: new Date(now).toISOString(), expires_at: expiresAt }).eq("id", transferId);

  await sendTransferEmails({ ...t, expires_at: expiresAt }, files ?? [], transferLink(t.code)).catch((e) => console.error("[transfer.complete] e-mails", e));
  return { code: t.code, link: transferLink(t.code) };
}

/** Renvoie l'e-mail aux destinataires (depuis le board). */
export async function resendTransferEmails(transferId: string) {
  const s = svc();
  const { data: t } = await s.from("transfers").select("*").eq("id", transferId).single();
  if (!t || t.status !== "ready") throw new Error("Ce transfert n'est pas actif.");
  const { data: files } = await s.from("transfer_files").select("*").eq("transfer_id", transferId).order("position");
  await sendTransferEmails(t, files ?? [], transferLink(t.code), { recipientsOnly: true });
}

/* ---------- Page de téléchargement ---------- */

export type PublicTransferFile = { id: string; name: string; mimeType: string; size: number; preview: TransferPreview };
export type PublicTransfer =
  | { state: "missing" }
  | { state: "uploading" | "expired" | "revoked"; senderName: string }
  | {
      state: "ready";
      code: string;
      title: string;
      message: string;
      senderName: string;
      senderEmail: string;
      totalBytes: number;
      createdAt: string;
      expiresAt: string | null;
      files: PublicTransferFile[];
    };

const isExpired = (t: { status: string; expires_at: string | null }) => t.status === "expired" || (t.status === "ready" && !!t.expires_at && new Date(t.expires_at).getTime() < Date.now());

export async function getPublicTransfer(code: string): Promise<PublicTransfer> {
  if (!/^[A-Za-z0-9]{6,20}$/.test(code)) return { state: "missing" };
  const s = svc();
  const { data: t } = await s.from("transfers").select("*").eq("code", code).maybeSingle();
  if (!t) return { state: "missing" };
  const senderName = t.sender_name || t.sender_email;
  if (t.status === "revoked") return { state: "revoked", senderName };
  if (isExpired(t)) return { state: "expired", senderName };
  if (t.status === "uploading") return { state: "uploading", senderName };
  const storage = await getTransferStorage();
  const { data: files } = await s.from("transfer_files").select("id, name, mime_type, size_bytes, drive_file_id").eq("transfer_id", t.id).order("position");
  return {
    state: "ready",
    code: t.code,
    title: t.title,
    message: t.message,
    senderName,
    senderEmail: t.sender_email,
    totalBytes: t.total_bytes,
    createdAt: t.ready_at ?? t.created_at,
    expiresAt: t.expires_at,
    files: (files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mime_type,
      size: f.size_bytes,
      preview: storage && f.drive_file_id ? storage.preview(f.drive_file_id, f.mime_type) : { kind: "none" as const },
    })),
  };
}

/** Compte le téléchargement et renvoie l'URL directe du fichier ; null si le lien n'est plus valable. */
export async function registerDownload(code: string, fileId: string) {
  const s = svc();
  const { data: t } = await s
    .from("transfers")
    .select("id, code, title, status, expires_at, download_count, notify_on_download, sender_email, sender_name")
    .eq("code", code)
    .maybeSingle();
  if (!t || t.status !== "ready" || isExpired(t)) return null;
  const { data: f } = await s.from("transfer_files").select("id, name, drive_file_id").eq("id", fileId).eq("transfer_id", t.id).maybeSingle();
  if (!f?.drive_file_id) return null;
  const storage = await getTransferStorage();
  if (!storage) return null;
  await s.rpc("transfer_count_download", { p_transfer: t.id, p_file: f.id });
  if (t.download_count === 0 && t.notify_on_download) {
    await sendDownloadNoticeEmail(t, f.name, transferLink(t.code)).catch((e) => console.error("[transfer.download] e-mail", e));
  }
  return storage.downloadUrl(f.drive_file_id);
}

/* ---------- Expiration / coupure ---------- */

/**
 * Coupe le lien. Fichiers envoyés : corbeille du Drive, ou — transfert archivé — gardés mais plus
 * accessibles par lien. Fichiers venus du Drive du board : jamais touchés (ils ont pu être partagés
 * ailleurs) ; seule la page LGEF Transfer cesse de les proposer.
 */
export async function closeTransfer(transferId: string, status: "expired" | "revoked") {
  const s = svc();
  const { data: t } = await s.from("transfers").select("id, archived, status").eq("id", transferId).single();
  if (!t || t.status === "expired" || t.status === "revoked") return;
  await s.from("transfers").update({ status }).eq("id", transferId);
  const storage = await getTransferStorage();
  if (!storage) return;
  const { data: files } = await s.from("transfer_files").select("drive_file_id, from_board_drive").eq("transfer_id", transferId);
  // Partage public retiré d'abord : un fichier à la corbeille reste téléchargeable par son lien Google sinon.
  await mapLimit((files ?? []).filter((f) => f.drive_file_id && !f.from_board_drive), 5, async (f) => {
    await storage.unpublish(f.drive_file_id!).catch((e) => console.error("[transfer.close] partage", e));
    if (!t.archived) await storage.trash(f.drive_file_id!).catch((e) => console.error("[transfer.close] corbeille", e));
  });
}

/** Tâche quotidienne : transferts arrivés à expiration, et envois abandonnés depuis plus de 2 jours. */
export async function expireDueTransfers() {
  const s = svc();
  const nowIso = new Date().toISOString();
  const [{ data: due }, { data: stale }] = await Promise.all([
    s.from("transfers").select("id").eq("status", "ready").lt("expires_at", nowIso).limit(200),
    s.from("transfers").select("id").eq("status", "uploading").lt("created_at", new Date(Date.now() - 2 * 86400_000).toISOString()).limit(200),
  ]);
  for (const t of due ?? []) await closeTransfer(t.id, "expired");
  for (const t of stale ?? []) await closeTransfer(t.id, "revoked");
  return { expired: due?.length ?? 0, abandoned: stale?.length ?? 0 };
}

/* ---------- Publicités ---------- */

/** Tire une pub en ligne pour l'emplacement (pondérée) et compte l'affichage. */
export async function pickAd(placement: "upload" | "download"): Promise<TransferAdView | null> {
  const s = svc();
  const today = parisToday();
  const { data } = await s
    .from("transfer_ads")
    .select("id, media_type, media_drive_file_id, format, link_url, advertiser, weight, starts_at, ends_at")
    .eq("active", true)
    .contains("placements", [placement]);
  const live = (data ?? []).filter((a) => (!a.starts_at || a.starts_at <= today) && (!a.ends_at || a.ends_at >= today));
  if (!live.length) return null;
  let r = Math.random() * live.reduce((n, a) => n + a.weight, 0);
  const ad = live.find((a) => (r -= a.weight) < 0) ?? live[0];
  await s.rpc("transfer_ad_hit", { p_ad: ad.id, p_click: false });
  return {
    id: ad.id,
    mediaType: ad.media_type,
    format: ad.format,
    // ?v= : le visuel est mis en cache (CDN) — changer de fichier change l'adresse.
    mediaUrl: `/api/transfer/ads/${ad.id}/media?v=${encodeURIComponent(ad.media_drive_file_id)}`,
    clickUrl: ad.link_url ? `/api/transfer/ads/${ad.id}/click` : null,
    advertiser: ad.advertiser,
  };
}
