import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { button, emailLayout, esc, siteUrl } from "@/lib/email/notificationEmails";
import { isTransactionalEmailConfigured, sendTransactionalBatch, type EmailMessage } from "@/lib/email/transactional";
import type { Database } from "@/lib/supabase/database.types";
import {
  CATERING_LABELS,
  FILE_KIND_LABELS,
  fmtHours,
  fmtPeriod,
  STATUS_LABELS,
  yesNo,
  type DeclarationStatus,
} from "@/lib/tournois/shared";

// Tournois — cœur serveur : dossier complet, récapitulatif PDF, envoi des messages (un mail par
// destinataire, bouton « Répondre » personnel, suivi de l'envoi), notifications du board.

type Tables = Database["public"]["Tables"];
export type DeclarationRow = Tables["tournament_declarations"]["Row"];
export type DistrictRow = Tables["tournament_districts"]["Row"];
export type FileRow = Tables["tournament_files"]["Row"];
export type Service = ReturnType<typeof createServiceClient>;

export interface FullDeclaration {
  declaration: DeclarationRow;
  district: DistrictRow | null;
  categories: (Tables["tournament_declaration_categories"]["Row"] & { label: string; kind: string })[];
  files: FileRow[];
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: sha256(token) };
};

export const replyUrl = (token: string) => `${siteUrl()}/tournoi/r/${token}`;
export const boardUrl = (declarationId: string) => `${siteUrl()}/?app=tournois&openTournoi=${declarationId}`;

export async function loadDeclaration(service: Service, id: string): Promise<FullDeclaration | null> {
  const { data: declaration } = await service.from("tournament_declarations").select("*").eq("id", id).maybeSingle();
  if (!declaration) return null;
  const [{ data: district }, { data: cats }, { data: catalog }, { data: files }] = await Promise.all([
    declaration.district_code
      ? service.from("tournament_districts").select("*").eq("code", declaration.district_code).maybeSingle()
      : Promise.resolve({ data: null }),
    service.from("tournament_declaration_categories").select("*").eq("declaration_id", id),
    service.from("tournament_categories").select("slug, label, kind, position"),
    service.from("tournament_files").select("*").eq("declaration_id", id).eq("status", "ready").order("created_at"),
  ]);
  const bySlug = new Map((catalog ?? []).map((c) => [c.slug, c]));
  const categories = (cats ?? [])
    .map((c) => ({ c, meta: bySlug.get(c.category_slug) }))
    .sort((a, b) => (a.meta?.position ?? 99) - (b.meta?.position ?? 99))
    .map(({ c, meta }) => ({ ...c, label: meta?.label ?? c.category_slug, kind: meta?.kind ?? "tournoi" }));
  return { declaration, district: (district as DistrictRow | null) ?? null, categories, files: files ?? [] };
}

export async function logActivity(service: Service, declarationId: string, actor: string | null, action: string, details: Record<string, unknown> = {}) {
  const { error } = await service.from("tournament_activity").insert({ declaration_id: declarationId, actor, action, details: details as never });
  if (error) console.warn("[tournois.activity]", error.message);
}

/** Notifications du board (cloche + push + e-mail selon les préférences de chacun). */
export async function notifyBoard(userIds: (string | null | undefined)[], n: { title: string; message: string; declarationId: string }) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  const { error } = await createServiceClient()
    .from("notifications")
    .insert(ids.map((user_id) => ({ user_id, type: "tournament_message" as const, title: n.title, message: n.message, data: { app: "tournois", tournoi_id: n.declarationId } })));
  if (error) console.warn("[tournois.notify]", error.message);
}

export async function managerIds(service: Service) {
  const { data } = await service.rpc("tournois_manager_ids");
  return ((data ?? []) as unknown[]).map((r) => (typeof r === "string" ? r : (r as { tournois_manager_ids: string }).tournois_manager_ids));
}

// --- Récapitulatif PDF --------------------------------------------------------------------------------

const NAVY = rgb(0.07, 0.19, 0.37);
const GREY = rgb(0.39, 0.45, 0.55);
const INK = rgb(0.12, 0.16, 0.23);

/** Caractères hors WinAnsi (emoji…) retirés : les polices standard du PDF ne les connaissent pas. */
const pdfSafe = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E -ÿŒœ€\n]/g, "");

export async function declarationPdf(full: FullDeclaration): Promise<Uint8Array> {
  const { declaration: d, district, categories, files } = full;
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Déclaration ${d.ref ?? ""} - ${d.title}`));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const H = 842;
  const M = 44;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const ensure = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const lines: string[] = [];
    for (const para of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) > width && line) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      lines.push(line);
    }
    return lines;
  };
  const text = (s: string, opts: { x?: number; size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; width?: number } = {}) => {
    const size = opts.size ?? 10;
    for (const l of wrap(s, opts.f ?? font, size, opts.width ?? W - 2 * M)) {
      ensure(size + 4);
      page.drawText(l, { x: opts.x ?? M, y: y - size, size, font: opts.f ?? font, color: opts.color ?? INK });
      y -= size + 4;
    }
  };
  const section = (title: string) => {
    ensure(40);
    y -= 10;
    page.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 18, color: rgb(0.85, 0.91, 0.96) });
    page.drawText(pdfSafe(title.toUpperCase()), { x: M + 6, y: y - 13, size: 9.5, font: bold, color: NAVY });
    y -= 26;
  };
  const row = (label: string, value: string | null | undefined) => {
    const v = value?.toString().trim() || "-";
    const lines = wrap(v, font, 10, W - 2 * M - 170);
    ensure(lines.length * 14);
    page.drawText(pdfSafe(label), { x: M, y: y - 10, size: 9.5, font: bold, color: GREY });
    for (const l of lines) {
      page.drawText(l, { x: M + 170, y: y - 10, size: 10, font, color: INK });
      y -= 14;
    }
  };

  page.drawText(pdfSafe("DÉCLARATION DE TOURNOI / RASSEMBLEMENT"), { x: M, y: y - 16, size: 15, font: bold, color: NAVY });
  y -= 24;
  text(`Ligue du Grand Est de Football${district && !district.is_ligue ? ` - ${district.name}` : ""}`, { color: GREY });
  text(
    `Dossier ${d.ref ?? "-"} · déposé le ${new Date(d.submitted_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" })}${
      d.late ? " · HORS DÉLAI" : ""
    } · statut : ${STATUS_LABELS[d.status as DeclarationStatus]}`,
    { size: 9.5, color: GREY }
  );

  section("Club organisateur");
  row("Club", d.club_name);
  row("N° d'affiliation", d.club_number);
  row("District", district?.name);

  section("Manifestation");
  row("Appellation", d.title);
  row("Date", fmtPeriod(d.start_date, d.end_date));
  row("Horaires", fmtHours(d.start_time, d.end_time));
  row("Adresse", d.address);

  section("Responsable - référent");
  row("Nom", `${d.contact_first_name} ${d.contact_last_name}`);
  row("Portable", d.contact_phone);
  row("Tél. fixe", d.contact_landline);
  row("E-mail", d.contact_email);

  section("Organisation sportive");
  for (const c of categories) {
    ensure(40);
    text(`${c.label} (${c.kind})`, { f: bold, size: 10.5, color: NAVY });
    const bits = [
      c.teams != null && `${c.teams} équipes`,
      c.play_date && `le ${new Date(c.play_date + "T12:00:00").toLocaleDateString("fr-FR")}`,
      c.players_per_team != null && `${c.players_per_team} joueurs / équipe`,
      c.substitutes != null && `${c.substitutes} remplaçants`,
      c.match_minutes != null && `matchs de ${c.match_minutes} min`,
      c.matches_per_team != null && `${c.matches_per_team} matchs / équipe`,
      c.surface,
    ].filter(Boolean);
    text(bits.join(" · ") || "-", { x: M + 12, width: W - 2 * M - 12 });
  }
  row("Logiciel de gestion de la ligue", d.uses_league_software ? "Oui" : "Non");
  row("Clubs attendus", d.clubs_expected?.toString());
  row("Équipes d'autres districts", yesNo(d.other_districts));
  row("Équipes d'autres pays", yesNo(d.other_countries));
  row("Feuilles de match au début", yesNo(d.match_sheets_at_start));
  row("Commission de discipline", yesNo(d.discipline_commission));
  row("Charte des participants", yesNo(d.participant_charter));
  row("Messages éducatifs", d.educational_messages);

  section("Logistique");
  row("Buvette", yesNo(d.refreshments));
  row("Pôle restauration", d.catering ? CATERING_LABELS[d.catering] : null);
  row("Points chauds", yesNo(d.hot_points));
  row("Parkings", d.parking);
  row("Secours assurés par", d.first_aid);
  row("Spectateurs prévus", d.spectators_expected?.toString());

  section("Animations");
  text(d.animations || "-");
  section("Informations diverses");
  text(d.other_info || "-");

  if (files.length) {
    section("Pièces jointes");
    for (const f of files) text(`${FILE_KIND_LABELS[f.kind]} : ${f.file_name}`);
  }
  if (d.district_opinion) {
    section("Avis du district");
    row("Avis", d.district_opinion === "yes" ? "Favorable" : "Défavorable");
    row("Commentaire", d.district_opinion_note);
  }
  return pdf.save();
}

// --- Messages ----------------------------------------------------------------------------------------

export interface OutRecipient {
  email: string;
  name?: string | null;
  role: "contact" | "club" | "district" | "ligue" | "sender" | "other";
  field?: "to" | "cc";
}

export interface SendResult {
  messageId: string;
  sent: number;
  failed: { email: string; error: string }[];
}

const plainToHtml = (s: string) =>
  esc(s)
    .split(/\n{2,}/)
    .map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px;color:#1e293b">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/**
 * Enregistre puis envoie un message du dossier : un e-mail par destinataire (bouton « Répondre » personnel,
 * qui ouvre aussi le récapitulatif et les pièces jointes), délivrance suivie par destinataire.
 * `kind = 'note'` : rien n'est envoyé.
 */
export async function sendTournamentMessage(
  service: Service,
  opts: {
    full: FullDeclaration;
    kind: "mail" | "forward" | "auto" | "note";
    subject: string;
    body: string;
    sentBy: string | null;
    sender?: { name: string; email: string | null } | null;
    recipients: OutRecipient[];
    copyToSender?: boolean;
    fileIds?: string[];
    includePdf?: boolean;
  }
): Promise<SendResult> {
  const d = opts.full.declaration;
  const { data: message, error } = await service
    .from("tournament_messages")
    .insert({
      declaration_id: d.id,
      kind: opts.kind,
      subject: opts.subject,
      body: opts.body,
      sent_by: opts.sentBy,
      copy_to_sender: !!opts.copyToSender,
      include_pdf: !!opts.includePdf,
    })
    .select("id")
    .single();
  if (error || !message) throw new Error("Message non enregistré.");

  const fileIds = (opts.fileIds ?? []).filter((id) => opts.full.files.some((f) => f.id === id));
  if (fileIds.length) await service.from("tournament_message_files").insert(fileIds.map((file_id) => ({ message_id: message.id, file_id })));
  if (opts.kind === "note") return { messageId: message.id, sent: 0, failed: [] };

  // Destinataires dédoublonnés ; l'expéditeur en copie s'il l'a demandé.
  const seen = new Set<string>();
  const list: OutRecipient[] = [];
  const all = [...opts.recipients];
  if (opts.copyToSender && opts.sender?.email) all.push({ email: opts.sender.email, name: opts.sender.name, role: "sender", field: "cc" });
  for (const r of all) {
    const email = r.email.trim().toLowerCase();
    if (!isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    list.push({ ...r, email });
  }
  if (!list.length) {
    await service.from("tournament_messages").delete().eq("id", message.id);
    throw new Error("Aucun destinataire valide.");
  }

  const tokens = list.map(() => newToken());
  const { data: rows, error: rErr } = await service
    .from("tournament_message_recipients")
    .insert(list.map((r, i) => ({ message_id: message.id, email: r.email, name: r.name ?? null, role: r.role, field: r.field ?? "to", reply_token_hash: tokens[i].hash })))
    .select("id, email");
  if (rErr || !rows) throw new Error("Destinataires non enregistrés.");
  const idOf = new Map(rows.map((r) => [r.email, r.id]));

  const attached = opts.full.files.filter((f) => fileIds.includes(f.id));
  const hasPieces = attached.length > 0 || !!opts.includePdf;

  const messages: EmailMessage[] = list.map((r, i) => {
    const url = replyUrl(tokens[i].token);
    const card = `<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#F4F6FA;border-radius:10px"><tr><td style="padding:14px 16px">
  <div style="font-size:12px;color:#64748b;letter-spacing:.06em;text-transform:uppercase">Dossier ${esc(d.ref ?? "")}</div>
  <div style="font-size:16px;font-weight:800;color:#0E2A55;margin-top:2px">${esc(d.title)}</div>
  <div style="font-size:14px;color:#334155;margin-top:6px">${esc(d.club_name)}</div>
  <div style="font-size:14px;color:#334155;margin-top:2px">📅 ${esc(fmtPeriod(d.start_date, d.end_date))}</div>
  <div style="font-size:14px;color:#334155;margin-top:2px">📍 ${esc(d.address)}</div>
</td></tr></table>`;
    const pieces = hasPieces
      ? `<p style="font-size:14px;color:#334155;margin:0 0 6px"><b>Pièces jointes</b> (à ouvrir avec le bouton ci-dessous) :</p><ul style="margin:0 0 12px;padding-left:18px;font-size:14px;color:#334155">${
          opts.includePdf ? `<li>Récapitulatif de la déclaration (PDF)</li>` : ""
        }${attached.map((f) => `<li>${esc(FILE_KIND_LABELS[f.kind])} — ${esc(f.file_name)}</li>`).join("")}</ul>`
      : "";
    const alsoTo = list.filter((x) => x.email !== r.email && x.role !== "sender").map((x) => x.name || x.email);
    const html = emailLayout({
      firstName: null,
      title: opts.subject,
      body: `${plainToHtml(opts.body)}${card}${pieces}`,
      buttons: `${button("Répondre", url, "red")}${hasPieces ? button("Voir le dossier et les pièces", url, "ghost") : ""}`,
      footer: `${alsoTo.length ? `Message également envoyé à : ${esc(alsoTo.join(", "))}.<br>` : ""}Envoyé depuis le board de la Ligue du Grand Est de Football${
        opts.sender?.name ? ` par ${esc(opts.sender.name)}` : ""
      }. Pour répondre, utilisez le bouton « Répondre » : votre message arrive directement dans le dossier.`,
    }).replace(`<div style="font-size:14px;color:#64748b">Bonjour,</div>`, "");
    const text = [
      opts.subject,
      opts.body,
      `Dossier ${d.ref} — ${d.title} — ${d.club_name} — ${fmtPeriod(d.start_date, d.end_date)} — ${d.address}`,
      hasPieces ? `Pièces jointes : ${[opts.includePdf ? "récapitulatif PDF" : "", ...attached.map((f) => f.file_name)].filter(Boolean).join(", ")}` : "",
      `Répondre / voir le dossier : ${url}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return { to: [r.email], subject: opts.subject, html, text, replyTo: opts.sender?.email ?? null };
  });

  if (!isTransactionalEmailConfigured()) {
    await service.from("tournament_message_recipients").update({ delivery: "failed", error: "Envoi d'e-mails non configuré" }).eq("message_id", message.id);
    throw new Error("L'envoi d'e-mails n'est pas configuré sur le board.");
  }
  const sentIdx = new Set<number>();
  const { errors } = await sendTransactionalBatch(messages, async (indexes) => {
    indexes.forEach((i) => sentIdx.add(i));
    const ids = indexes.map((i) => idOf.get(list[i].email)).filter((x): x is string => !!x);
    if (ids.length) await service.from("tournament_message_recipients").update({ delivery: "sent" }).in("id", ids);
  });
  const failed = list.filter((_, i) => !sentIdx.has(i)).map((r) => ({ email: r.email, error: errors[0] ?? "Envoi refusé" }));
  if (failed.length) {
    await service
      .from("tournament_message_recipients")
      .update({ delivery: "failed", error: failed[0].error })
      .in(
        "id",
        failed.map((f) => idOf.get(f.email)).filter((x): x is string => !!x)
      );
  }
  return { messageId: message.id, sent: sentIdx.size, failed };
}

/** Prénom Nom (ou e-mail) d'un compte du board. */
export async function senderOf(service: Service, userId: string) {
  const { data } = await service.from("profiles").select("first_name, last_name, email").eq("id", userId).maybeSingle();
  const name = [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim() || data?.email || "L'équipe de la ligue";
  return { name, email: data?.email ?? null };
}
