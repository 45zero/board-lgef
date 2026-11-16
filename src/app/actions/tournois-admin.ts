"use server";

import { z } from "zod";
import { toResult, type ActionResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { loadDeclaration, logActivity, managerIds, sendTournamentMessage, senderOf, type OutRecipient } from "@/lib/tournois/core";
import { declarationFolder, getTournamentStorage } from "@/lib/tournois/storage";
import { STATUS_LABELS, type DeclarationStatus } from "@/lib/tournois/shared";
import type { Database } from "@/lib/supabase/database.types";

// Tournois — actions de l'onglet Tournois du board (module « tournois », même règle d'accès que les
// autres onglets). Lecture et écriture par le serveur après contrôle de tournois_is_manager().

type T = Database["public"]["Tables"];
export type DistrictSettings = T["tournament_districts"]["Row"];
export type CategorySettings = T["tournament_categories"]["Row"];

async function requireManager() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const { data: ok, error } = await supabase.rpc("tournois_is_manager");
  if (error || ok !== true) throw new Error("Réservé à l'onglet Tournois.");
  return userId;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
const OPEN: DeclarationStatus[] = ["received", "reviewing", "info_requested"];

export interface TournoisOverview {
  me: { id: string; name: string; email: string | null };
  counts: { open: number; late: number; upcoming: number; unread: number };
  minNoticeDays: number;
  introText: string | null;
  districts: DistrictSettings[];
  categories: CategorySettings[];
  managers: { id: string; name: string }[];
}

export async function getTournoisOverview(): Promise<ActionResult<TournoisOverview>> {
  return toResult(async () => {
    const userId = await requireManager();
    const service = createServiceClient();
    const [me, open, late, upcoming, unread, settings, districts, categories, ids] = await Promise.all([
      senderOf(service, userId),
      service.from("tournament_declarations").select("id", { count: "exact", head: true }).in("status", OPEN).not("finalized_at", "is", null),
      service.from("tournament_declarations").select("id", { count: "exact", head: true }).in("status", OPEN).eq("late", true).not("finalized_at", "is", null),
      service.from("tournament_declarations").select("id", { count: "exact", head: true }).eq("status", "validated").gte("end_date", today()),
      service.from("tournament_messages").select("id", { count: "exact", head: true }).eq("kind", "reply").is("read_at", null),
      service.from("tournament_settings").select("min_notice_days, intro_text").eq("id", true).maybeSingle(),
      service.from("tournament_districts").select("*").order("position"),
      service.from("tournament_categories").select("*").order("position"),
      managerIds(service),
    ]);
    const { data: people } = ids.length ? await service.from("profiles").select("id, first_name, last_name, email").in("id", ids) : { data: [] };
    return {
      me: { id: userId, ...me },
      counts: { open: open.count ?? 0, late: late.count ?? 0, upcoming: upcoming.count ?? 0, unread: unread.count ?? 0 },
      minNoticeDays: settings.data?.min_notice_days ?? 60,
      introText: settings.data?.intro_text ?? null,
      districts: districts.data ?? [],
      categories: categories.data ?? [],
      managers: (people ?? [])
        .map((p) => ({ id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—" }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    };
  });
}

export interface DeclarationListRow {
  id: string;
  ref: string;
  status: DeclarationStatus;
  clubName: string;
  title: string;
  startDate: string;
  endDate: string;
  address: string;
  districtCode: string | null;
  late: boolean;
  submittedAt: string;
  assignedTo: string | null;
  categories: string[];
  unread: number;
  opinion: "yes" | "no" | null;
}

export async function listTournamentDeclarations(scope: "inbox" | "upcoming" | "all"): Promise<ActionResult<DeclarationListRow[]>> {
  return toResult(async () => {
    await requireManager();
    const service = createServiceClient();
    let q = service
      .from("tournament_declarations")
      .select("id, ref, status, club_name, title, start_date, end_date, address, district_code, late, submitted_at, assigned_to, district_opinion")
      .not("finalized_at", "is", null);
    if (scope === "inbox") q = q.in("status", OPEN).order("submitted_at", { ascending: false });
    else if (scope === "upcoming") q = q.eq("status", "validated").gte("end_date", today()).order("start_date");
    else q = q.order("submitted_at", { ascending: false }).limit(500);
    const { data, error } = await q;
    if (error) throw new Error("Liste indisponible.");
    const ids = (data ?? []).map((d) => d.id);
    const [{ data: cats }, { data: catalog }, { data: unread }] = ids.length
      ? await Promise.all([
          service.from("tournament_declaration_categories").select("declaration_id, category_slug").in("declaration_id", ids),
          service.from("tournament_categories").select("slug, label, position"),
          service.from("tournament_messages").select("declaration_id").in("declaration_id", ids).eq("kind", "reply").is("read_at", null),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
    const label = new Map((catalog ?? []).map((c) => [c.slug, c]));
    return (data ?? []).map((d) => ({
      id: d.id,
      ref: d.ref ?? "",
      status: d.status,
      clubName: d.club_name,
      title: d.title,
      startDate: d.start_date,
      endDate: d.end_date,
      address: d.address,
      districtCode: d.district_code,
      late: d.late,
      submittedAt: d.submitted_at,
      assignedTo: d.assigned_to,
      categories: (cats ?? [])
        .filter((c) => c.declaration_id === d.id)
        .sort((a, b) => (label.get(a.category_slug)?.position ?? 99) - (label.get(b.category_slug)?.position ?? 99))
        .map((c) => label.get(c.category_slug)?.label ?? c.category_slug),
      unread: (unread ?? []).filter((m) => m.declaration_id === d.id).length,
      opinion: d.district_opinion,
    }));
  });
}

export interface ThreadMessage {
  id: string;
  kind: "mail" | "forward" | "auto" | "note" | "reply";
  subject: string | null;
  body: string | null;
  at: string;
  author: string;
  fromEmail: string | null;
  parentId: string | null;
  includePdf: boolean;
  recipients: { email: string; name: string | null; role: string; field: string; delivery: string; error: string | null; openedAt: string | null; repliedAt: string | null }[];
  files: { id: string; name: string; kind: string; size: number | null }[];
}

export interface DeclarationDetail {
  declaration: T["tournament_declarations"]["Row"];
  district: DistrictSettings | null;
  ligue: DistrictSettings | null;
  categories: (T["tournament_declaration_categories"]["Row"] & { label: string; kind: string })[];
  files: { id: string; name: string; kind: string; size: number | null; source: string; mimeType: string | null; createdAt: string; messageId: string | null }[];
  thread: ThreadMessage[];
  activity: { at: string; actor: string; action: string; details: Record<string, unknown> }[];
  clubContact: { name: string | null; mobile: string | null; email: string | null } | null;
}

export async function getTournamentDeclaration(id: string): Promise<ActionResult<DeclarationDetail>> {
  return toResult(async () => {
    await requireManager();
    const service = createServiceClient();
    const full = await loadDeclaration(service, id);
    if (!full) throw new Error("Dossier introuvable.");
    const [{ data: messages }, { data: activity }, { data: ligue }, { data: club }] = await Promise.all([
      service.from("tournament_messages").select("*").eq("declaration_id", id).order("created_at"),
      service.from("tournament_activity").select("*").eq("declaration_id", id).order("created_at"),
      service.from("tournament_districts").select("*").eq("is_ligue", true).maybeSingle(),
      full.declaration.club_number
        ? service
            .from("tournament_clubs")
            .select("contact_civility, contact_first_name, contact_last_name, contact_mobile, contact_email")
            .eq("club_number", full.declaration.club_number)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const msgIds = (messages ?? []).map((m) => m.id);
    const [{ data: recipients }, { data: links }] = msgIds.length
      ? await Promise.all([
          service.from("tournament_message_recipients").select("*").in("message_id", msgIds),
          service.from("tournament_message_files").select("*").in("message_id", msgIds),
        ])
      : [{ data: [] }, { data: [] }];
    const people = new Set<string>([...(messages ?? []).map((m) => m.sent_by), ...(activity ?? []).map((a) => a.actor)].filter((x): x is string => !!x));
    const { data: profiles } = people.size ? await service.from("profiles").select("id, first_name, last_name, email").in("id", [...people]) : { data: [] };
    const nameOf = (uid: string | null) => {
      if (!uid) return "Automatique";
      const p = (profiles ?? []).find((x) => x.id === uid);
      return [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.email || "—";
    };
    const files = full.files.map((f) => ({ id: f.id, name: f.file_name, kind: f.kind, size: f.size_bytes, source: f.source, mimeType: f.mime_type, createdAt: f.created_at, messageId: f.message_id }));

    // Réponses ouvertes : marquées lues.
    const unread = (messages ?? []).filter((m) => m.kind === "reply" && !m.read_at).map((m) => m.id);
    if (unread.length) await service.from("tournament_messages").update({ read_at: new Date().toISOString() }).in("id", unread);

    return {
      declaration: full.declaration,
      district: full.district,
      ligue: (ligue as DistrictSettings | null) ?? null,
      categories: full.categories,
      files,
      thread: (messages ?? []).map((m) => ({
        id: m.id,
        kind: m.kind,
        subject: m.subject,
        body: m.body,
        at: m.created_at,
        author: m.kind === "reply" ? m.from_name || m.from_email || "Club" : nameOf(m.sent_by),
        fromEmail: m.from_email,
        parentId: m.parent_message_id,
        includePdf: m.include_pdf,
        recipients: (recipients ?? [])
          .filter((r) => r.message_id === m.id)
          .map((r) => ({ email: r.email, name: r.name, role: r.role, field: r.field, delivery: r.delivery, error: r.error, openedAt: r.opened_at, repliedAt: r.replied_at })),
        files: m.kind === "reply" ? files.filter((f) => f.messageId === m.id) : files.filter((f) => (links ?? []).some((l) => l.message_id === m.id && l.file_id === f.id)),
      })),
      activity: (activity ?? []).map((a) => ({ at: a.created_at, actor: nameOf(a.actor), action: a.action, details: (a.details ?? {}) as Record<string, unknown> })),
      clubContact: club
        ? { name: [club.contact_civility, club.contact_first_name, club.contact_last_name].filter(Boolean).join(" ") || null, mobile: club.contact_mobile, email: club.contact_email }
        : null,
    };
  });
}

const patchSchema = z.object({
  status: z.enum(["received", "reviewing", "info_requested", "validated", "refused", "cancelled"]).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  districtOpinion: z.enum(["yes", "no"]).nullable().optional(),
  districtOpinionNote: z.string().trim().max(2000).optional(),
  decisionNote: z.string().trim().max(2000).optional(),
});

export async function updateTournamentDeclaration(id: string, patch: z.input<typeof patchSchema>): Promise<ActionResult<true>> {
  return toResult(async () => {
    const userId = await requireManager();
    const p = patchSchema.parse(patch);
    const service = createServiceClient();
    const { data: before } = await service.from("tournament_declarations").select("status, assigned_to, district_opinion").eq("id", id).maybeSingle();
    if (!before) throw new Error("Dossier introuvable.");
    const update: T["tournament_declarations"]["Update"] = {};
    if (p.status !== undefined) {
      update.status = p.status;
      if (p.status === "validated" || p.status === "refused") {
        update.decided_by = userId;
        update.decided_at = new Date().toISOString();
      }
    }
    if (p.assignedTo !== undefined) update.assigned_to = p.assignedTo;
    if (p.districtOpinion !== undefined) update.district_opinion = p.districtOpinion;
    if (p.districtOpinionNote !== undefined) update.district_opinion_note = p.districtOpinionNote || null;
    if (p.decisionNote !== undefined) update.decision_note = p.decisionNote || null;
    const { error } = await service.from("tournament_declarations").update(update).eq("id", id);
    if (error) throw new Error("Modification impossible.");
    if (p.status && p.status !== before.status) await logActivity(service, id, userId, "status", { from: STATUS_LABELS[before.status], to: STATUS_LABELS[p.status] });
    if (p.assignedTo !== undefined && p.assignedTo !== before.assigned_to) {
      const { data: who } = p.assignedTo ? await service.from("profiles").select("first_name, last_name").eq("id", p.assignedTo).maybeSingle() : { data: null };
      await logActivity(service, id, userId, "assigned", { to: who ? [who.first_name, who.last_name].filter(Boolean).join(" ") : null });
    }
    if (p.districtOpinion !== undefined && p.districtOpinion !== before.district_opinion) await logActivity(service, id, userId, "opinion", { opinion: p.districtOpinion });
    return true as const;
  });
}

const recipientSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse invalide."),
  name: z.string().trim().max(160).nullable().optional(),
  role: z.enum(["contact", "club", "district", "ligue", "other"]),
  field: z.enum(["to", "cc"]).optional(),
});

const mailSchema = z.object({
  kind: z.enum(["mail", "forward", "note"]),
  subject: z.string().trim().max(240).default(""),
  body: z.string().trim().min(1, "Le message est vide.").max(20000),
  recipients: z.array(recipientSchema).max(40).default([]),
  copyToSender: z.boolean().default(false),
  fileIds: z.array(z.string().uuid()).max(20).default([]),
  includePdf: z.boolean().default(false),
});

export async function sendTournamentMail(
  id: string,
  input: z.input<typeof mailSchema>
): Promise<ActionResult<{ sent: number; failed: { email: string; error: string }[] }>> {
  return toResult(async () => {
    const userId = await requireManager();
    const m = mailSchema.parse(input);
    if (m.kind !== "note" && !m.recipients.length) throw new Error("Ajoutez au moins un destinataire.");
    if (m.kind !== "note" && !m.subject) throw new Error("L'objet est vide.");
    const service = createServiceClient();
    const full = await loadDeclaration(service, id);
    if (!full) throw new Error("Dossier introuvable.");
    const sender = await senderOf(service, userId);
    const res = await sendTournamentMessage(service, {
      full,
      kind: m.kind,
      subject: m.kind === "note" ? m.subject || "Note interne" : m.subject,
      body: m.body,
      sentBy: userId,
      sender,
      recipients: m.recipients as OutRecipient[],
      copyToSender: m.copyToSender,
      fileIds: m.fileIds,
      includePdf: m.includePdf,
    });
    await logActivity(service, id, userId, m.kind === "note" ? "note" : "mail", { to: m.recipients.map((r) => r.email), sent: res.sent, failed: res.failed.length });
    return { sent: res.sent, failed: res.failed };
  });
}

export async function getTournamentFolderUrl(id: string): Promise<ActionResult<string>> {
  return toResult(async () => {
    await requireManager();
    const service = createServiceClient();
    const full = await loadDeclaration(service, id);
    if (!full) throw new Error("Dossier introuvable.");
    const storage = await getTournamentStorage();
    if (!storage) throw new Error("Aucun Drive relié au board.");
    const d = full.declaration;
    return storage.folderUrl(declarationFolder({ ref: d.ref, title: d.title, start_date: d.start_date, districtName: full.district?.short_name ?? null }));
  });
}

// --- Réglages ----------------------------------------------------------------------------------------

const districtSchema = z.object({
  contactName: z.string().trim().max(160).default(""),
  emails: z.array(z.string().trim().toLowerCase().email("Une adresse e-mail est invalide.")).max(10),
  phone: z.string().trim().max(40).default(""),
  address: z.string().trim().max(300).default(""),
  autoSend: z.boolean(),
});

export async function saveTournamentDistrict(code: string, input: z.input<typeof districtSchema>): Promise<ActionResult<true>> {
  return toResult(async () => {
    await requireManager();
    const d = districtSchema.parse(input);
    if (d.autoSend && !d.emails.length) throw new Error("Ajoutez au moins une adresse pour l'envoi automatique.");
    const { error } = await createServiceClient()
      .from("tournament_districts")
      .update({ contact_name: d.contactName || null, emails: [...new Set(d.emails)], phone: d.phone || null, address: d.address || null, auto_send: d.autoSend })
      .eq("code", code);
    if (error) throw new Error("Enregistrement impossible.");
    return true as const;
  });
}

export async function setTournamentCategoryActive(slug: string, active: boolean): Promise<ActionResult<true>> {
  return toResult(async () => {
    await requireManager();
    const { error } = await createServiceClient().from("tournament_categories").update({ active }).eq("slug", slug);
    if (error) throw new Error("Enregistrement impossible.");
    return true as const;
  });
}

export async function saveTournamentSettings(input: { minNoticeDays: number; introText: string }): Promise<ActionResult<true>> {
  return toResult(async () => {
    const userId = await requireManager();
    const days = Math.round(Number(input.minNoticeDays));
    if (!Number.isFinite(days) || days < 0 || days > 365) throw new Error("Délai invalide (0 à 365 jours).");
    const { error } = await createServiceClient()
      .from("tournament_settings")
      .update({ min_notice_days: days, intro_text: input.introText.trim().slice(0, 2000) || null, updated_by: userId })
      .eq("id", true);
    if (error) throw new Error("Enregistrement impossible.");
    return true as const;
  });
}
