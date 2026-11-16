"use server";

import { toResult, type ActionResult } from "@/lib/board/actionResult";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import {
  declarationSchema,
  daysUntil,
  fmtPeriod,
  replySchema,
  type ClubHit,
  type DeclarationInput,
  type PublicFormConfig,
  type ReplyInput,
} from "@/lib/tournois/shared";
import { declarationFolder, getTournamentStorage } from "@/lib/tournois/storage";
import { isEmail, loadDeclaration, logActivity, managerIds, notifyBoard, sendTournamentMessage, type OutRecipient } from "@/lib/tournois/core";
import { recipientByToken } from "@/lib/tournois/reply";

// Tournois — actions publiques (sans compte) : formulaire de déclaration (/tournoi) et page de réponse
// (/tournoi/r/<jeton>, bouton « Répondre » des mails). Clé service ; les droits passent par la
// possession de l'identifiant de dossier (dépôt en cours) ou du jeton de réponse.

export async function getTournamentFormConfig(): Promise<ActionResult<PublicFormConfig>> {
  return toResult(async () => {
    const service = createServiceClient();
    const [{ data: cats }, { data: settings }] = await Promise.all([
      service.from("tournament_categories").select("slug, label, kind, position").eq("active", true).order("position"),
      service.from("tournament_settings").select("min_notice_days, intro_text").eq("id", true).maybeSingle(),
    ]);
    return {
      categories: (cats ?? []).map(({ slug, label, kind }) => ({ slug, label, kind })),
      minNoticeDays: settings?.min_notice_days ?? 60,
      introText: settings?.intro_text ?? null,
    };
  });
}

export async function searchTournamentClubs(q: string): Promise<ActionResult<ClubHit[]>> {
  return toResult(async () => {
    const query = q.trim().slice(0, 80);
    if (query.length < 2) return [];
    const { data, error } = await createServiceClient().rpc("tournament_club_search", { q: query, max_rows: 12 });
    if (error) throw new Error("Recherche de club indisponible.");
    return ((data ?? []) as { club_number: string; club_name: string; city: string | null; district_code: string | null; district_name: string | null }[]).map((c) => ({
      clubNumber: c.club_number,
      clubName: c.club_name,
      city: c.city,
      districtCode: c.district_code,
      districtName: c.district_name,
    }));
  });
}

export async function listTournamentDistricts(): Promise<ActionResult<{ code: string; name: string }[]>> {
  return toResult(async () => {
    const { data } = await createServiceClient().from("tournament_districts").select("code, name, is_ligue, position").eq("active", true).order("position");
    return (data ?? []).filter((d) => !d.is_ligue).map((d) => ({ code: d.code, name: d.name }));
  });
}

export interface UploadSlot {
  index: number;
  fileId: string;
}

/** Enregistre la déclaration et prépare l'envoi des pièces ; l'accusé part à la fin (finalize). */
export async function submitTournamentDeclaration(input: DeclarationInput): Promise<ActionResult<{ id: string; ref: string; uploads: UploadSlot[] }>> {
  return toResult(async () => {
    const parsed = declarationSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Formulaire incomplet.");
    const r = parsed.data;
    if (r.website) throw new Error("Envoi refusé.");
    const service = createServiceClient();

    // Club et district relus côté serveur (jamais pris tels quels du navigateur).
    const club = r.club.clubNumber
      ? (await service.from("tournament_clubs").select("club_number, name, district_code, official_email").eq("club_number", r.club.clubNumber).maybeSingle()).data
      : null;
    let districtCode = club?.district_code ?? null;
    if (!districtCode && r.districtCode) {
      const { data: d } = await service.from("tournament_districts").select("code").eq("code", r.districtCode).maybeSingle();
      districtCode = d?.code ?? null;
    }
    if (!districtCode) throw new Error("Choisissez votre district.");

    const { data: settings } = await service.from("tournament_settings").select("min_notice_days").eq("id", true).maybeSingle();
    const { data: activeCats } = await service.from("tournament_categories").select("slug").eq("active", true);
    const allowed = new Set((activeCats ?? []).map((c) => c.slug));
    const categories = r.categories.filter((c) => allowed.has(c.slug));
    if (!categories.length) throw new Error("Cochez au moins une catégorie.");
    if (daysUntil(r.startDate) < 0) throw new Error("La date du tournoi est déjà passée.");

    const storage = r.files.length ? await getTournamentStorage() : null;
    if (r.files.length && !storage) throw new Error("Le dépôt de pièces est momentanément indisponible : réessayez sans pièce jointe, vous pourrez les envoyer ensuite.");

    const nullIfEmpty = (s: string) => s.trim() || null;
    const { data: decl, error } = await service
      .from("tournament_declarations")
      .insert({
        club_number: club?.club_number ?? null,
        club_name: club?.name ?? r.club.clubName,
        club_official_email: club?.official_email ?? null,
        district_code: districtCode,
        title: r.title,
        start_date: r.startDate,
        end_date: r.endDate,
        start_time: nullIfEmpty(r.startTime),
        end_time: nullIfEmpty(r.endTime),
        address: r.address,
        contact_first_name: r.contactFirstName,
        contact_last_name: r.contactLastName,
        contact_phone: r.contactPhone,
        contact_landline: nullIfEmpty(r.contactLandline),
        contact_email: r.contactEmail,
        clubs_expected: r.clubsExpected,
        other_districts: r.otherDistricts,
        other_countries: r.otherCountries,
        participant_charter: r.participantCharter,
        educational_messages: nullIfEmpty(r.educationalMessages),
        match_sheets_at_start: r.matchSheetsAtStart,
        discipline_commission: r.disciplineCommission,
        refreshments: r.refreshments,
        catering: r.catering,
        hot_points: r.hotPoints,
        parking: nullIfEmpty(r.parking),
        first_aid: nullIfEmpty(r.firstAid),
        spectators_expected: r.spectatorsExpected,
        animations: nullIfEmpty(r.animations),
        other_info: nullIfEmpty(r.otherInfo),
        late: daysUntil(r.startDate) < (settings?.min_notice_days ?? 60),
      })
      .select("id, ref, title, start_date")
      .single();
    if (error || !decl) {
      console.error("[tournois.submit]", error);
      throw new Error("La déclaration n'a pas pu être enregistrée. Réessayez.");
    }

    const { error: cErr } = await service.from("tournament_declaration_categories").insert(
      categories.map((c) => ({
        declaration_id: decl.id,
        category_slug: c.slug,
        teams: c.teams,
        play_date: c.playDate || null,
        players_per_team: c.playersPerTeam,
        substitutes: c.substitutes,
        surface: c.surface || null,
        format: c.format,
        match_minutes: c.matchMinutes,
        min_play_minutes: c.minPlayMinutes,
        max_play_minutes: c.maxPlayMinutes,
      }))
    );
    if (cErr) console.error("[tournois.submit.categories]", cErr);

    const uploads: UploadSlot[] = [];
    if (storage && r.files.length) {
      const { data: district } = await service.from("tournament_districts").select("short_name").eq("code", districtCode).maybeSingle();
      const folder = declarationFolder({ ref: decl.ref, title: decl.title, start_date: decl.start_date, districtName: district?.short_name ?? null });
      for (const [index, f] of r.files.entries()) {
        const uploadUrl = await storage.createUpload(folder, { name: f.name, mimeType: f.mimeType });
        const { data: row } = await service
          .from("tournament_files")
          .insert({ declaration_id: decl.id, kind: f.kind, file_name: f.name, mime_type: f.mimeType || null, size_bytes: f.size, upload_url: uploadUrl, source: "form" })
          .select("id")
          .single();
        if (row) uploads.push({ index, fileId: row.id });
      }
    }
    return { id: decl.id, ref: decl.ref ?? "", uploads };
  });
}

/** Fin du dépôt (pièces envoyées) : accusé au déclarant + copie au club, envoi automatique aux districts, alerte du board. */
export async function finalizeTournamentDeclaration(id: string): Promise<ActionResult<{ ref: string; acknowledged: boolean }>> {
  return toResult(async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Dossier introuvable.");
    const service = createServiceClient();
    // Une seule finalisation (deux onglets, double clic…).
    const { data: claimed } = await service
      .from("tournament_declarations")
      .update({ finalized_at: new Date().toISOString() })
      .eq("id", id)
      .is("finalized_at", null)
      .select("id")
      .maybeSingle();
    const full = await loadDeclaration(service, id);
    if (!full) throw new Error("Dossier introuvable.");
    const d = full.declaration;
    if (!claimed) return { ref: d.ref ?? "", acknowledged: true };

    await logActivity(service, id, null, "submitted", { late: d.late, files: full.files.length });
    const formFiles = full.files.map((f) => f.id);

    // 1. Accusé au responsable, copie à l'adresse officielle du club.
    const ack: OutRecipient[] = [{ email: d.contact_email, name: `${d.contact_first_name} ${d.contact_last_name}`, role: "contact" }];
    if (d.club_official_email && isEmail(d.club_official_email)) ack.push({ email: d.club_official_email, name: d.club_name, role: "club", field: "cc" });
    let acknowledged = false;
    try {
      const res = await sendTournamentMessage(service, {
        full,
        kind: "auto",
        subject: `Déclaration ${d.ref} reçue — ${d.title}`,
        body: [
          `Votre déclaration de tournoi « ${d.title} » (${fmtPeriod(d.start_date, d.end_date)}) a bien été enregistrée le ${new Date(d.submitted_at).toLocaleString("fr-FR", {
            timeZone: "Europe/Paris",
            dateStyle: "long",
            timeStyle: "short",
          })} sous le numéro ${d.ref}.`,
          d.late
            ? "Attention : elle nous parvient moins de deux mois avant la manifestation. Elle sera étudiée, mais le district peut vous demander des compléments rapidement."
            : "",
          "Le district et la ligue l'étudient ; vous serez prévenu(e) par e-mail de la suite donnée. Pour ajouter une pièce ou poser une question, utilisez le bouton « Répondre » ci-dessous.",
          d.club_official_email ? "Une copie de ce message est adressée à la messagerie officielle du club." : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        sentBy: null,
        recipients: ack,
        fileIds: formFiles,
        includePdf: true,
      });
      acknowledged = res.sent > 0;
    } catch (e) {
      console.error("[tournois.finalize.ack]", e);
    }

    // 2. Envoi automatique aux destinataires cochés dans les réglages (district du club, ligue).
    const { data: autos } = await service.from("tournament_districts").select("code, name, emails, is_ligue").eq("auto_send", true).eq("active", true);
    const targets = (autos ?? []).filter((x) => x.is_ligue || x.code === d.district_code);
    const recipients: OutRecipient[] = targets.flatMap((t) => t.emails.map((email) => ({ email, name: t.name, role: t.is_ligue ? ("ligue" as const) : ("district" as const) })));
    if (recipients.length) {
      try {
        await sendTournamentMessage(service, {
          full,
          kind: "forward",
          subject: `Nouvelle déclaration de tournoi ${d.ref} — ${d.club_name}`,
          body: `Le club ${d.club_name} vient de déclarer « ${d.title} » (${fmtPeriod(d.start_date, d.end_date)}, ${d.address}).${
            d.late ? "\n\nDéclaration hors délai (moins de deux mois avant la manifestation)." : ""
          }\n\nLe récapitulatif complet et les pièces sont accessibles avec le bouton ci-dessous ; vous pouvez y répondre directement.`,
          sentBy: null,
          recipients,
          fileIds: formFiles,
          includePdf: true,
        });
      } catch (e) {
        console.error("[tournois.finalize.auto]", e);
      }
    }

    await notifyBoard(await managerIds(service), {
      title: `Nouvelle déclaration de tournoi${d.late ? " (hors délai)" : ""}`,
      message: `${d.club_name} — « ${d.title} », ${fmtPeriod(d.start_date, d.end_date)}.`,
      declarationId: id,
    });
    return { ref: d.ref ?? "", acknowledged };
  });
}

// --- Page de réponse ---------------------------------------------------------------------------------

export interface ReplyContext {
  ref: string;
  title: string;
  clubName: string;
  period: string;
  address: string;
  subject: string;
  body: string;
  senderName: string | null;
  sentAt: string;
  recipientName: string | null;
  recipientEmail: string;
  files: { id: string; name: string; kind: string; size: number | null }[];
  pdf: boolean;
  replies: { at: string; body: string; files: number }[];
}

export async function getReplyContext(token: string): Promise<ActionResult<ReplyContext>> {
  return toResult(async () => {
    const ctx = await recipientByToken(token);
    if (!ctx) throw new Error("Ce lien n'est pas valide. Utilisez le bouton du dernier e-mail reçu.");
    const { service, rec, message, files, pdf } = ctx;
    const { data: d } = await service.from("tournament_declarations").select("ref, title, club_name, start_date, end_date, address").eq("id", message.declaration_id).maybeSingle();
    if (!d) throw new Error("Ce dossier n'existe plus.");
    if (!rec.opened_at) await service.from("tournament_message_recipients").update({ opened_at: new Date().toISOString() }).eq("id", rec.id);
    let senderName: string | null = null;
    if (message.sent_by) {
      const { data: p } = await service.from("profiles").select("first_name, last_name").eq("id", message.sent_by).maybeSingle();
      senderName = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || null;
    }
    const { data: replies } = await service
      .from("tournament_messages")
      .select("id, body, created_at")
      .eq("parent_message_id", message.id)
      .eq("kind", "reply")
      .eq("from_email", rec.email)
      .order("created_at");
    const replyIds = (replies ?? []).map((r) => r.id);
    const { data: replyFiles } = replyIds.length ? await service.from("tournament_files").select("message_id").in("message_id", replyIds).eq("status", "ready") : { data: [] };
    return {
      ref: d.ref ?? "",
      title: d.title,
      clubName: d.club_name,
      period: fmtPeriod(d.start_date, d.end_date),
      address: d.address,
      subject: message.subject ?? "",
      body: message.body ?? "",
      senderName,
      sentAt: message.created_at,
      recipientName: rec.name,
      recipientEmail: rec.email,
      files: files.map((f) => ({ id: f.id, name: f.file_name, kind: f.kind, size: f.size_bytes })),
      pdf,
      replies: (replies ?? []).map((r) => ({ at: r.created_at, body: r.body ?? "", files: (replyFiles ?? []).filter((f) => f.message_id === r.id).length })),
    };
  });
}

/** Enregistre la réponse ; s'il y a des pièces, elles s'envoient ensuite et la notification part à la fin. */
export async function submitTournamentReply(token: string, input: ReplyInput): Promise<ActionResult<{ messageId: string; uploads: UploadSlot[] }>> {
  return toResult(async () => {
    const parsed = replySchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Message incomplet.");
    const r = parsed.data;
    if (r.website) throw new Error("Envoi refusé.");
    const ctx = await recipientByToken(token);
    if (!ctx) throw new Error("Ce lien n'est pas valide.");
    const { service, rec, message } = ctx;

    const storage = r.files.length ? await getTournamentStorage() : null;
    if (r.files.length && !storage) throw new Error("L'envoi de pièces est momentanément indisponible : envoyez votre message sans pièce jointe.");

    const { data: reply, error } = await service
      .from("tournament_messages")
      .insert({
        declaration_id: message.declaration_id,
        kind: "reply",
        subject: `Re: ${message.subject ?? ""}`.trim(),
        body: r.message,
        parent_message_id: message.id,
        from_name: r.name,
        from_email: rec.email,
      })
      .select("id")
      .single();
    if (error || !reply) throw new Error("Votre message n'a pas pu être enregistré. Réessayez.");

    const uploads: UploadSlot[] = [];
    if (storage && r.files.length) {
      const full = await loadDeclaration(service, message.declaration_id);
      const { data: district } = full?.declaration.district_code
        ? await service.from("tournament_districts").select("short_name").eq("code", full.declaration.district_code).maybeSingle()
        : { data: null };
      const folder = [
        ...declarationFolder({
          ref: full?.declaration.ref ?? null,
          title: full?.declaration.title ?? "Dossier",
          start_date: full?.declaration.start_date ?? new Date().toISOString().slice(0, 10),
          districtName: district?.short_name ?? null,
        }),
        "Réponses",
      ];
      for (const [index, f] of r.files.entries()) {
        const uploadUrl = await storage.createUpload(folder, { name: f.name, mimeType: f.mimeType });
        const { data: row } = await service
          .from("tournament_files")
          .insert({
            declaration_id: message.declaration_id,
            message_id: reply.id,
            kind: "reply",
            file_name: f.name,
            mime_type: f.mimeType || null,
            size_bytes: f.size,
            upload_url: uploadUrl,
            source: "reply",
          })
          .select("id")
          .single();
        if (row) uploads.push({ index, fileId: row.id });
      }
    }
    if (!uploads.length) await announceReply(token, reply.id);
    return { messageId: reply.id, uploads };
  });
}

export async function finalizeTournamentReply(token: string, messageId: string): Promise<ActionResult<true>> {
  return toResult(async () => {
    await announceReply(token, messageId);
    return true as const;
  });
}

async function announceReply(token: string, replyId: string) {
  const ctx = await recipientByToken(token);
  if (!ctx) throw new Error("Ce lien n'est pas valide.");
  const { service, rec, message } = ctx;
  const { data: reply } = await service.from("tournament_messages").select("id, from_name, parent_message_id").eq("id", replyId).maybeSingle();
  if (!reply || reply.parent_message_id !== message.id) throw new Error("Message introuvable.");
  await service.from("tournament_message_recipients").update({ replied_at: new Date().toISOString() }).eq("id", rec.id);
  const { data: d } = await service.from("tournament_declarations").select("id, ref, title, assigned_to").eq("id", message.declaration_id).maybeSingle();
  if (!d) return;
  await logActivity(service, d.id, null, "reply", { from: rec.email });
  const targets = [message.sent_by, d.assigned_to].filter(Boolean) as string[];
  await notifyBoard(targets.length ? targets : await managerIds(service), {
    title: `Réponse reçue — dossier ${d.ref}`,
    message: `${reply.from_name || rec.name || rec.email} a répondu au sujet de « ${d.title} ».`,
    declarationId: d.id,
  });
}
