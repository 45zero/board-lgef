"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { toResult, type ActionResult } from "@/lib/board/actionResult";
import { getTransferMember } from "@/lib/transfer/session";
import { getTransferStorage } from "@/lib/transfer/storage";
import { closeTransfer, requireTransferStorage, resendTransferEmails, resolvePlan, transferLink } from "@/lib/transfer/core";
import { isEmail, type TransferPlanLimits, type TransferPreview } from "@/lib/transfer/shared";

// Onglet « LGEF Transfer » du board : ses transferts (tous pour les admins), gestion des formules,
// des attributions et des pubs. Lecture sous RLS ; écritures en service role après contrôle.

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
  lastDownloadAt: string | null;
  archived: boolean;
  createdAt: string;
  expiresAt: string | null;
  mine: boolean;
};

export type TransferFilters = { scope: "mine" | "all"; from?: string; to?: string; status?: TransferStatus | "downloaded" | "never" | ""; q?: string };

const effectiveStatus = (t: { status: TransferStatus; expires_at: string | null }): TransferStatus =>
  t.status === "ready" && t.expires_at && new Date(t.expires_at).getTime() < Date.now() ? "expired" : t.status;

export async function listTransfers(filters: TransferFilters): Promise<ActionResult<TransferRow[]>> {
  return toResult(async () => {
    const member = await requireMember();
    const supabase = await createClient();
    let q = supabase.from("transfers").select("*").order("created_at", { ascending: false }).limit(500);
    if (filters.scope === "mine" || !member.isAdmin) q = q.eq("sender_user_id", member.id);
    if (filters.from) q = q.gte("created_at", new Date(`${filters.from}T00:00:00`).toISOString());
    if (filters.to) q = q.lt("created_at", new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86400_000).toISOString());
    if (filters.status === "downloaded") q = q.gt("download_count", 0);
    if (filters.status === "never") q = q.eq("download_count", 0).eq("status", "ready");
    if (filters.status === "uploading" || filters.status === "revoked") q = q.eq("status", filters.status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const needle = (filters.q ?? "").trim().toLowerCase();
    return (data ?? [])
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
        lastDownloadAt: t.last_download_at,
        archived: t.archived,
        createdAt: t.created_at,
        expiresAt: t.expires_at,
        mine: t.sender_user_id === member.id,
      }))
      .filter((t) => (filters.status === "ready" || filters.status === "expired" || filters.status === "never" ? t.status === (filters.status === "never" ? "ready" : filters.status) : true))
      .filter((t) => !needle || [t.title, t.senderEmail, t.senderName, t.code, ...t.recipients].some((s) => s.toLowerCase().includes(needle)));
  });
}

export type TransferDetail = {
  files: { id: string; name: string; mimeType: string; size: number; downloadCount: number; fromBoardDrive: boolean; preview: TransferPreview }[];
  downloads: { at: string; fileName: string | null }[];
  message: string;
  driveFolderUrl: string | null;
};

export async function getTransferDetail(id: string): Promise<ActionResult<TransferDetail>> {
  return toResult(async () => {
    await requireMember();
    const supabase = await createClient();
    const { data: t } = await supabase.from("transfers").select("id, message, drive_folder_id, status, expires_at").eq("id", id).maybeSingle();
    if (!t) throw new Error("Transfert introuvable.");
    const [{ data: files }, { data: downloads }, storage] = await Promise.all([
      supabase.from("transfer_files").select("*").eq("transfer_id", id).order("position"),
      supabase.from("transfer_downloads").select("at, file_id").eq("transfer_id", id).order("at", { ascending: false }).limit(200),
      getTransferStorage(),
    ]);
    const names = new Map((files ?? []).map((f) => [f.id, f.name]));
    const live = effectiveStatus(t) === "ready";
    return {
      message: t.message,
      driveFolderUrl: t.drive_folder_id && storage?.provider === "google" ? `https://drive.google.com/drive/folders/${t.drive_folder_id}` : null,
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
    };
  });
}

/* ---------- Actions sur un transfert ---------- */

/** Transfert visible par l'utilisateur (RLS : le sien, ou admin). */
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
