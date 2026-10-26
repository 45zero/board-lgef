"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import {
  STAFF_STATUSES,
  type Engagement,
  type Payable,
  type PrestataireCompany,
  type StaffOverview,
  type StaffPerson,
  type StaffStatus,
  type StandaloneInvoice,
} from "@/lib/board/staff";
import { loadEngagements } from "@/lib/board/staffCore";
import { createInvoiceToken } from "@/lib/board/invoiceToken";
import { getBoardDriveAccount } from "@/lib/board/teamDrive";
import { archiveSubFolder, eventArchiveFolder } from "@/lib/google/archiveFolders";
import { uploadFile } from "@/lib/google/drive";
import { isTransactionalEmailConfigured, sendTransactionalBatch } from "@/lib/email/transactional";
import { invoiceValidatorIds, prepareInvoiceDeposit, recordInvoiceDeposit, recordStandaloneInvoice, type StandaloneInput } from "@/lib/board/invoiceDeposit";
import { COMPTA_SLUG } from "@/lib/board/fraisFlavor";
import type { InvoiceRequestItem } from "@/app/actions/invoice-public";

// Effectif (sql/2026-10-03_staff_costs.sql) : mes N-1 (profiles.expense_validator_id = moi), tout le
// monde pour un administrateur. Le coût d'une personne = son forfait par intervention (staff_rates) —
// ou, pour le réseau, ses kilomètres aller-retour × KM_RATE —, ou le montant ajusté sur l'événement
// (event_cost_adjustments), pour chaque événement où elle est
// sollicitée (même règle que src/lib/board/solicitation.ts, sans le comité directeur) :
// confirmé (équipe, assignation, captation acceptée, match pris) ou prévisionnel (captation proposée).
// Lectures et écritures avec le client de service, après vérification des droits ici.

type Service = ReturnType<typeof createServiceClient>;

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "Sans nom";

async function viewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const service = createServiceClient();
  const [{ data: me }, { data: reports }, { data: compta }] = await Promise.all([
    service.from("profiles").select("role").eq("id", userId).single(),
    service.from("profiles").select("id").eq("expense_validator_id", userId),
    service.from("profile_specialties").select("user_id, specialties!inner(slug)").eq("user_id", userId).eq("specialties.slug", COMPTA_SLUG),
  ]);
  const isAdmin = me?.role === "admin" || me?.role === "super_user";
  // Compta (GED) : voit et valide les factures de tous les prestataires, comme un administrateur.
  const isCompta = (compta ?? []).length > 0;
  const reportIds = (reports ?? []).map((r) => r.id).filter((id) => id !== userId);
  return { userId, service, isAdmin, isCompta, reportIds };
}
type Viewer = Awaited<ReturnType<typeof viewer>>;

async function requireCanManage(v: Viewer, personId: string) {
  if (v.isAdmin || v.isCompta || v.reportIds.includes(personId)) return;
  throw new Error("Vous n'êtes ni le N+1 de cette personne ni administrateur.");
}

async function loadPeople(service: Service, ids: string[] | null): Promise<StaffPerson[]> {
  if (ids && ids.length === 0) return [];
  let q = service.from("profiles").select("id, first_name, last_name, email, expense_validator_id").order("last_name");
  if (ids) q = q.in("id", ids);
  const { data: profiles, error } = await q;
  if (error) throw new Error(error.message);
  const allIds = (profiles ?? []).map((p) => p.id);
  const managerIds = [...new Set((profiles ?? []).map((p) => p.expense_validator_id).filter((id): id is string => !!id))];
  const [{ data: links }, { data: rates }, { data: managers }] = await Promise.all([
    service.from("profile_specialties").select("user_id, specialties!inner(slug)").in("specialties.slug", STAFF_STATUSES).in("user_id", allIds),
    service.from("staff_rates").select("user_id, amount_eur").in("user_id", allIds),
    managerIds.length ? service.from("profiles").select("id, first_name, last_name, email").in("id", managerIds) : Promise.resolve({ data: [] }),
  ]);
  const statusBy = new Map(((links ?? []) as unknown as { user_id: string; specialties: { slug: string } }[]).map((l) => [l.user_id, l.specialties.slug as StaffStatus]));
  const rateBy = new Map((rates ?? []).map((r) => [r.user_id, Number(r.amount_eur)]));
  const managerBy = new Map((managers ?? []).map((m) => [m.id, personName(m)]));
  return (profiles ?? []).map((p) => ({
    id: p.id,
    name: personName(p),
    email: p.email,
    status: statusBy.get(p.id) ?? null,
    managerId: p.expense_validator_id,
    managerName: p.expense_validator_id ? (managerBy.get(p.expense_validator_id) ?? null) : null,
    rate: rateBy.has(p.id) ? rateBy.get(p.id)! : null,
  }));
}

/** Module Effectif : personnes, tarifs et interventions de l'année. scope « all » : administrateurs. */
export const getStaffOverview = async (year: number, scope: "mine" | "all") =>
  toResult(async (): Promise<StaffOverview> => {
    const v = await viewer();
    const all = scope === "all" && (v.isAdmin || v.isCompta);
    const loaded = await loadPeople(v.service, all ? null : v.reportIds);
    // Vue « tous » : les personnes qui ont un statut (salarié, réseau, prestataire, bénévole).
    const people = all ? loaded.filter((p) => p.status) : loaded;
    const engagements = await loadEngagements(v.service, people.map((p) => p.id), new Date(year, 0, 1).toISOString(), new Date(year + 1, 0, 1).toISOString());
    return { viewer: { id: v.userId, isAdmin: v.isAdmin, hasReports: v.reportIds.length > 0 }, year, people, engagements };
  });

/** Forfait par intervention (null : retirer). */
export const setStaffRate = async (personId: string, amount: number | null) =>
  toResult(async () => {
    const v = await viewer();
    await requireCanManage(v, personId);
    if (amount === null) {
      const { error } = await v.service.from("staff_rates").delete().eq("user_id", personId);
      if (error) throw new Error(error.message);
      return;
    }
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) throw new Error("Montant invalide.");
    const { error } = await v.service
      .from("staff_rates")
      .upsert({ user_id: personId, amount_eur: Math.round(amount * 100) / 100, updated_by: v.userId, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  });

/** Montant ajusté pour une personne sur un événement (null : revenir au forfait). */
export const setEventCostAdjustment = async (eventId: string, personId: string, amount: number | null, note?: string) =>
  toResult(async () => {
    const v = await viewer();
    await requireCanManage(v, personId);
    if (amount === null) {
      const { error } = await v.service.from("event_cost_adjustments").delete().eq("event_id", eventId).eq("user_id", personId);
      if (error) throw new Error(error.message);
      return;
    }
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) throw new Error("Montant invalide.");
    const { error } = await v.service.from("event_cost_adjustments").upsert({
      event_id: eventId,
      user_id: personId,
      amount_eur: Math.round(amount * 100) / 100,
      note: note?.trim() || null,
      updated_by: v.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  });

export type EventCostLine = Engagement & { name: string; status: StaffStatus; rate: number | null };

/**
 * Coût d'un événement pour son lecteur : les personnes sollicitées dont il a la charge (ses N-1, ou
 * tout le monde pour un administrateur). null : rien à montrer (ni N+1, ni administrateur).
 */
export const getEventCosts = async (eventId: string) =>
  toResult(async (): Promise<EventCostLine[] | null> => {
    const v = await viewer();
    if (!v.isAdmin && !v.reportIds.length) return null;
    const { data: ev } = await v.service.from("events").select("start_date").eq("id", eventId).maybeSingle();
    if (!ev) return null;
    const day = new Date(ev.start_date).getTime();
    const engagements = await loadEngagements(
      v.service,
      v.isAdmin ? null : v.reportIds,
      new Date(day - 1000).toISOString(),
      new Date(day + 1000).toISOString(),
      [eventId]
    );
    const people = new Map((await loadPeople(v.service, [...new Set(engagements.map((e) => e.userId))])).map((p) => [p.id, p]));
    return engagements.map((e) => ({ ...e, name: people.get(e.userId)?.name ?? "—", status: people.get(e.userId)?.status ?? null, rate: people.get(e.userId)?.rate ?? null }));
  });

/** Coût d'une période (week-end) pour le lecteur : ses N-1, ou tout le monde pour un administrateur. */
export const getPeriodCosts = async (fromISO: string, toISO: string) =>
  toResult(async (): Promise<{ confirmed: number; pending: number; people: number } | null> => {
    const v = await viewer();
    if (!v.isAdmin && !v.reportIds.length) return null;
    const engagements = (await loadEngagements(v.service, v.isAdmin ? null : v.reportIds, fromISO, toISO)).filter((e) => e.amount > 0);
    return {
      confirmed: engagements.filter((e) => e.confirmed).reduce((n, e) => n + e.amount, 0),
      pending: engagements.filter((e) => !e.confirmed).reduce((n, e) => n + e.amount, 0),
      people: new Set(engagements.map((e) => e.userId)).size,
    };
  });

/** Fichiers d'une facture (stockage privé « invoices ») : liens temporaires, pour le N+1 ou un administrateur. */
export const getInvoiceFiles = async (invoiceId: string) =>
  toResult(async (): Promise<{ name: string; url: string }[]> => {
    const v = await viewer();
    const { data: invoice } = await v.service.from("event_invoices").select("id, user_id, file_url").eq("id", invoiceId).maybeSingle();
    if (!invoice?.user_id) throw new Error("Facture introuvable.");
    await requireCanManage(v, invoice.user_id);
    const { data: atts } = await v.service.from("event_invoice_attachments").select("file_url, custom_name").eq("invoice_id", invoiceId).order("created_at");
    const paths = [
      ...(invoice.file_url ? [{ path: invoice.file_url, name: "Facture" }] : []),
      ...(atts ?? []).filter((a) => a.file_url).map((a) => ({ path: a.file_url!, name: a.custom_name || "Pièce jointe" })),
    ];
    const out: { name: string; url: string }[] = [];
    for (const p of paths) {
      // Chemins enregistrés tels quels par l'appli calendrier : « prestataire_invoices/<user>/<fichier> », ou une URL complète.
      if (/^https?:\/\//.test(p.path)) {
        out.push({ name: p.name, url: p.path });
        continue;
      }
      const { data } = await v.service.storage.from("invoices").createSignedUrl(p.path, 600);
      if (data?.signedUrl) out.push({ name: p.name === "Facture" ? decodeURIComponent(p.path.split("/").pop() ?? "Facture") : p.name, url: data.signedUrl });
    }
    if (!out.length) throw new Error("Aucun fichier joint à cette facture.");
    return out;
  });

/** Administrateur : me désigne comme N+1 de cette personne (bouton « Ajouter un N-1 » de l'Effectif). */
export const addMyReport = async (personId: string) =>
  toResult(async () => {
    const v = await viewer();
    if (!v.isAdmin) throw new Error("Réservé aux administrateurs (le N+1 se règle dans Administration → Utilisateurs).");
    if (personId === v.userId) throw new Error("Vous ne pouvez pas être votre propre N+1.");
    const { error } = await v.service.from("profiles").update({ expense_validator_id: v.userId }).eq("id", personId);
    if (error) throw new Error(error.message);
  });

/** Comptes qui pourraient devenir mes N-1 (tous sauf moi et mes N-1 actuels). */
export const listReportCandidates = async () =>
  toResult(async (): Promise<{ id: string; name: string; email: string | null; managerName: string | null }[]> => {
    const v = await viewer();
    if (!v.isAdmin) return [];
    const { data } = await v.service.from("profiles").select("id, first_name, last_name, email, expense_validator_id").order("last_name");
    const names = new Map((data ?? []).map((p) => [p.id, personName(p)]));
    return (data ?? [])
      .filter((p) => p.id !== v.userId && p.expense_validator_id !== v.userId)
      .map((p) => ({ id: p.id, name: personName(p), email: p.email, managerName: p.expense_validator_id ? (names.get(p.expense_validator_id) ?? null) : null }));
  });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** E-mail sobre aux couleurs de la Ligue : titre, paragraphes, tableau, bouton, mode d'emploi. */
function mailLayout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f2f5fb;font-family:Arial,Helvetica,sans-serif;color:#07172e">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5fb;padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0b1d3c;padding:22px 28px;color:#ffffff">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.7">Ligue du Grand Est de Football</div>
<div style="font-size:20px;font-weight:bold;margin-top:6px">${title}</div></td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.55">${body}</td></tr></table></td></tr></table></body></html>`;
}

/**
 * Réclame ses factures à un prestataire (interventions sans facture) : un seul e-mail pour toutes,
 * avec le mot du demandeur, la liste (date, événement, lieu, montant convenu), un bouton qui ouvre
 * /facture/<jeton> pour les déposer une à une sans compte, et un mode d'emploi en trois étapes.
 * La réponse à l'e-mail arrive au demandeur.
 */
export const requestInvoices = async (personId: string, eventIds: string[], comment?: string) =>
  toResult(async (): Promise<{ email: string; count: number }> => {
    const v = await viewer();
    await requireCanManage(v, personId);
    const ids = [...new Set(eventIds)].slice(0, 30);
    if (!ids.length) throw new Error("Aucune intervention à réclamer.");
    if (!isTransactionalEmailConfigured()) throw new Error("L'envoi d'e-mails n'est pas configuré (Brevo / Resend).");
    const [{ data: person }, { data: me }, { data: events }] = await Promise.all([
      v.service.from("profiles").select("first_name, last_name, email").eq("id", personId).single(),
      v.service.from("profiles").select("first_name, last_name, email").eq("id", v.userId).single(),
      v.service.from("events").select("id, title, start_date, location").in("id", ids).order("start_date"),
    ]);
    if (!person?.email) throw new Error("Cette personne n'a pas d'adresse e-mail.");
    if (!events?.length) throw new Error("Événements introuvables.");
    const starts = events.map((e) => new Date(e.start_date).getTime());
    const engagements = await loadEngagements(v.service, [personId], new Date(Math.min(...starts) - 1000).toISOString(), new Date(Math.max(...starts) + 1000).toISOString(), ids);
    const amountBy = new Map(engagements.map((e) => [e.eventId, e.amount]));

    const note = comment?.trim() || null;
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://board.lgef.fr").replace(/\/$/, "");
    const link = `${site}/facture/${createInvoiceToken({ eventIds: events.map((e) => e.id), userId: personId, requesterId: v.userId, comment: note })}`;
    const first = person.first_name?.trim() || personName(person);
    const requester = me ? personName(me) : "Votre responsable";
    const n = events.length;
    const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" });
    const money = (x: number | undefined) => (x ? x.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "—");
    const total = events.reduce((sum, e) => sum + (amountBy.get(e.id) ?? 0), 0);
    const steps = [
      ["Une facture par intervention", "au nom de la Ligue du Grand Est de Football, avec la date et l'événement."],
      ["Cliquez sur « Déposer mes factures »", "chaque intervention a sa ligne : joignez le PDF (ou une photo lisible)."],
      ["Vérifiez le montant TTC", "puis déposez. Vous êtes prévenu par e-mail dès qu'elle est validée, ou s'il faut la corriger."],
    ];

    const html = mailLayout(
      n > 1 ? `${n} factures à déposer` : "Facture à déposer",
      `<p style="margin:0 0 14px">Bonjour ${esc(first)},</p>
${note ? `<div style="margin:0 0 16px;padding:12px 14px;background:#e9effa;border-left:4px solid #12305f;border-radius:8px;font-size:14px"><div style="font-size:12px;color:#525e77;margin-bottom:4px">Message de ${esc(requester)}</div>${esc(note).replace(/\n/g, "<br>")}</div>` : ""}
<p style="margin:0 0 14px">Il nous manque votre facture pour ${n > 1 ? `ces ${n} interventions` : "cette intervention"} :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e9f4;border-radius:12px;font-size:14px">
${events
  .map(
    (e, i) => `<tr><td style="padding:10px 14px;${i ? "border-top:1px solid #e3e9f4;" : ""}"><div style="font-weight:bold">${esc(e.title)}</div><div style="font-size:12px;color:#525e77">${esc(day(e.start_date))}${e.location ? ` · ${esc(e.location)}` : ""}</div></td><td align="right" style="padding:10px 14px;white-space:nowrap;font-weight:bold;${i ? "border-top:1px solid #e3e9f4;" : ""}">${money(amountBy.get(e.id))}</td></tr>`
  )
  .join("")}
${n > 1 && total ? `<tr><td style="padding:10px 14px;border-top:2px solid #ccd6e5;color:#525e77">Total convenu</td><td align="right" style="padding:10px 14px;border-top:2px solid #ccd6e5;font-weight:bold">${money(total)}</td></tr>` : ""}
</table>
<p style="margin:22px 0;text-align:center"><a href="${link}" style="display:inline-block;background:#e1141b;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:12px">${n > 1 ? "Déposer mes factures" : "Déposer ma facture"}</a></p>
<div style="margin:0 0 16px;padding:14px;background:#f2f5fb;border-radius:12px;font-size:13px">
<div style="font-weight:bold;margin-bottom:8px">Comment ça marche ?</div>
${steps.map(([t, d], i) => `<div style="margin:0 0 6px"><b>${i + 1}. ${esc(t)}</b> — ${esc(d)}</div>`).join("")}
</div>
<p style="margin:0;font-size:12px;color:#79859a">Lien personnel, sans mot de passe, valable 45 jours. Une question ? Répondez simplement à cet e-mail (${esc(requester)}).</p>`
    );
    const text = [
      `Bonjour ${first},`,
      "",
      ...(note ? [`Message de ${requester} : ${note}`, ""] : []),
      `Il nous manque votre facture pour ${n > 1 ? `ces ${n} interventions` : "cette intervention"} :`,
      ...events.map((e) => `- ${day(e.start_date)} · ${e.title}${e.location ? ` (${e.location})` : ""} — ${money(amountBy.get(e.id))}`),
      "",
      `Déposez ${n > 1 ? "vos factures" : "votre facture"} ici (sans mot de passe) : ${link}`,
      "",
      "Comment ça marche ?",
      ...steps.map(([t, d], i) => `${i + 1}. ${t} — ${d}`),
      "",
      `Lien valable 45 jours. Une question ? Répondez à cet e-mail (${requester}).`,
    ].join("\n");

    const { errors } = await sendTransactionalBatch(
      [{ to: [person.email], subject: n > 1 ? `${n} factures à déposer — Ligue du Grand Est de Football` : `Facture à déposer — ${events[0].title}`, html, text, replyTo: me?.email ?? null }],
      async () => {}
    );
    if (errors.length) throw new Error(`Envoi impossible : ${errors[0]}`);
    return { email: person.email, count: n };
  });

/**
 * Copie des fichiers d'une facture validée dans le Drive du board, avec ceux de l'événement :
 *   LGEF Drive / AAAA / MM - Mois / JJ - Événement / Factures / <date - personne - Facture - montant>
 * Au mieux : sans Drive connecté ou en cas d'erreur, la facture reste dans le stockage (rien de perdu).
 */
async function archiveInvoice(service: Service, invoice: { id: string; file_url: string | null; amount_ttc: number | null }, person: string, event: { title: string; start_date: string }) {
  const account = await getBoardDriveAccount();
  if (!account) return 0;
  const { data: atts } = await service.from("event_invoice_attachments").select("file_url, custom_name").eq("invoice_id", invoice.id).order("created_at");
  const paths = [invoice.file_url, ...(atts ?? []).map((a) => a.file_url)].filter((p): p is string => !!p && !/^https?:\/\//.test(p));
  if (!paths.length) return 0;
  const cache = new Map();
  const folder = await archiveSubFolder(account, await eventArchiveFolder(account, { title: event.title, start: new Date(event.start_date) }, cache), "Factures", cache);
  const day = event.start_date.slice(0, 10);
  const amount = invoice.amount_ttc !== null ? ` - ${Number(invoice.amount_ttc).toFixed(2).replace(".", ",")} €` : "";
  let archived = 0;
  for (const [i, path] of paths.entries()) {
    try {
      const { data: blob } = await service.storage.from("invoices").download(path);
      if (!blob) continue;
      const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
      const name = `${day} - ${person} - Facture${paths.length > 1 ? ` ${i + 1}` : ""}${amount}${ext}`.replace(/[/\\:*?"<>|]+/g, " ");
      await uploadFile(account, {
        name,
        parentId: folder.id,
        mimeType: blob.type || "application/octet-stream",
        data: Buffer.from(await blob.arrayBuffer()),
        description: `Facture de ${person} pour « ${event.title} » — validée le ${new Date().toLocaleDateString("fr-FR")}`,
      });
      archived++;
    } catch (e) {
      console.error("[staff.archiveInvoice]", e);
    }
  }
  return archived;
}

/**
 * Le N+1 (ou un administrateur) valide ou refuse une facture. Le prestataire est prévenu (board et
 * e-mail) ; en cas de refus, l'e-mail donne le motif et un nouveau lien de dépôt. Validée : copiée
 * dans le Drive du board avec l'événement.
 */
export const reviewInvoice = async (invoiceId: string, decision: "approved" | "rejected", comment?: string) =>
  toResult(async (): Promise<{ archived: number }> => {
    const v = await viewer();
    const { data: invoice } = await v.service.from("event_invoices").select("id, user_id, event_id, file_url, amount_ttc, status, label").eq("id", invoiceId).maybeSingle();
    if (!invoice?.user_id) throw new Error("Facture introuvable.");
    await requireCanManage(v, invoice.user_id);
    const motive = comment?.trim() ?? "";

    const { error } = await v.service
      .from("event_invoices")
      .update({ status: decision, admin_comment: motive || null, updated_at: new Date().toISOString() })
      .eq("id", invoiceId);
    if (error) throw new Error(error.message);

    const [{ data: person }, { data: me }, { data: event }] = await Promise.all([
      v.service.from("profiles").select("first_name, last_name, email").eq("id", invoice.user_id).single(),
      v.service.from("profiles").select("first_name, last_name, email").eq("id", v.userId).single(),
      invoice.event_id ? v.service.from("events").select("title, start_date").eq("id", invoice.event_id).single() : Promise.resolve({ data: null }),
    ]);
    const who = person ? personName(person) : "—";
    const reviewer = me ? personName(me) : "Votre responsable";
    // Facture sans événement : son objet (forfait, matériel…).
    const eventTitle = event?.title ?? invoice.label ?? "votre facture";
    const amount = invoice.amount_ttc !== null ? Number(invoice.amount_ttc).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : null;

    await v.service.rpc("create_notification", {
      p_user_id: invoice.user_id,
      p_type: decision === "approved" ? "expense_approved" : "expense_rejected",
      p_title: decision === "approved" ? "Facture validée" : "Facture refusée",
      p_message:
        decision === "approved"
          ? `Votre facture pour « ${eventTitle} »${amount ? ` (${amount})` : ""} a été validée.`
          : `Votre facture pour « ${eventTitle} » a été refusée${motive ? ` : ${motive}` : "."}`,
      p_actor_name: reviewer,
      // Déjà prévenu par l'e-mail détaillé ci-dessous : pas de second e-mail de notification.
      p_data: { event_id: invoice.event_id, kind: "invoice_reviewed", decision, skip_email: true },
    });

    if (person?.email && isTransactionalEmailConfigured()) {
      const first = person.first_name?.trim() || who;
      const link =
        decision === "rejected" && invoice.event_id
          ? `${(process.env.NEXT_PUBLIC_SITE_URL || "https://board.lgef.fr").replace(/\/$/, "")}/facture/${createInvoiceToken({ eventIds: [invoice.event_id], userId: invoice.user_id, requesterId: v.userId, comment: null })}`
          : null;
      const lines =
        decision === "approved"
          ? [`Votre facture pour « ${eventTitle} »${amount ? ` (${amount})` : ""} a été validée par ${reviewer}.`, "Elle sera transmise pour paiement."]
          : [`Votre facture pour « ${eventTitle} » a été refusée par ${reviewer}.`, ...(motive ? [`Motif : ${motive}`] : []), link ? "Vous pouvez déposer une facture corrigée avec le bouton ci-dessous." : "Vous pouvez déposer une facture corrigée depuis le board (Factures)."];
      const html = `<!doctype html><html><body style="margin:0;background:#f2f5fb;font-family:Arial,Helvetica,sans-serif;color:#07172e">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5fb;padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:${decision === "approved" ? "#146447" : "#0b1d3c"};padding:22px 28px;color:#ffffff">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.7">Ligue du Grand Est de Football</div>
<div style="font-size:20px;font-weight:bold;margin-top:6px">${decision === "approved" ? "Facture validée" : "Facture refusée"}</div></td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.55">
<p style="margin:0 0 14px">Bonjour ${esc(first)},</p>
${lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join("")}
${link ? `<p style="margin:18px 0"><a href="${link}" style="display:inline-block;background:#e1141b;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:12px">Déposer une facture corrigée</a></p>` : ""}
<p style="margin:12px 0 0;font-size:12px;color:#79859a">Pour toute question, répondez simplement à cet e-mail.</p>
</td></tr></table></td></tr></table></body></html>`;
      const text = [`Bonjour ${first},`, "", ...lines, ...(link ? ["", `Déposer une facture corrigée : ${link}`] : []), "", "Pour toute question, répondez à cet e-mail."].join("\n");
      await sendTransactionalBatch(
        [{ to: [person.email], subject: `${decision === "approved" ? "Facture validée" : "Facture refusée"} — ${eventTitle}`, html, text, replyTo: me?.email ?? null }],
        async () => {}
      ).catch((e) => console.error("[staff.reviewInvoice.mail]", e));
    }

    const archived = decision === "approved" && event ? await archiveInvoice(v.service, invoice, who, event).catch((e) => (console.error("[staff.reviewInvoice.archive]", e), 0)) : 0;
    return { archived };
  });

/* ---------- Factures : le prestataire connecté (module Frais → « Factures ») ---------- */

/** Mes interventions confirmées de l'année, avec la facture déposée pour chacune. */
export const getMyInvoiceItems = async (year: number) =>
  toResult(async (): Promise<InvoiceRequestItem[]> => {
    const v = await viewer();
    const list = (await loadEngagements(v.service, [v.userId], new Date(year, 0, 1).toISOString(), new Date(year + 1, 0, 1).toISOString())).filter((e) => e.confirmed);
    if (!list.length) return [];
    const ids = list.map((e) => e.eventId);
    const { data: events } = await v.service.from("events").select("id, location").in("id", ids);
    const locationBy = new Map((events ?? []).map((e) => [e.id, e.location as string | null]));
    return list.map((e) => ({
      eventId: e.eventId,
      eventTitle: e.title,
      eventStart: e.start,
      location: locationBy.get(e.eventId) ?? null,
      expectedAmount: e.amount || null,
      existing: e.invoice ? { status: e.invoice.status, amountTtc: e.invoice.amountTtc, comment: e.invoice.comment } : null,
    }));
  });

/** Je dépose une facture : seulement pour un événement où j'interviens. */
async function requireMyEngagement(v: Viewer, eventId: string) {
  const mine = await loadEngagements(v.service, [v.userId], "1970-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z", [eventId]);
  if (!mine.some((e) => e.confirmed)) throw new Error("Vous n'intervenez pas sur cet événement.");
}

export const prepareMyInvoiceUpload = async (eventId: string, filename: string, contentType: string, size: number) =>
  toResult(async () => {
    const v = await viewer();
    await requireMyEngagement(v, eventId);
    return prepareInvoiceDeposit(v.userId, filename, contentType, size);
  });

/** Enregistre ma facture ; mon N+1 est prévenu (la compta si je n'en ai pas). */
export const confirmMyInvoiceUpload = async (eventId: string, path: string, amountTtc: number | null, comment: string) =>
  toResult(async () => {
    const v = await viewer();
    await requireMyEngagement(v, eventId);
    await recordInvoiceDeposit({ userId: v.userId, eventId, path, amountTtc, comment, source: "board" }, await invoiceValidatorIds(v.userId));
  });

/* ---------- Factures sans intervention, paiement, fiche société (GED) ---------- */

const requireCompta = (v: Viewer) => {
  if (!v.isAdmin && !v.isCompta) throw new Error("Réservé à la compta et aux administrateurs.");
};

/** Pour qui je dépose : moi, ou (N+1, compta) un prestataire que je gère. */
async function depositTarget(v: Viewer, forUserId: string | null | undefined) {
  if (!forUserId || forUserId === v.userId) return v.userId;
  await requireCanManage(v, forUserId);
  return forUserId;
}

export const prepareStandaloneUpload = async (forUserId: string | null, filename: string, contentType: string, size: number) =>
  toResult(async () => {
    const v = await viewer();
    return prepareInvoiceDeposit(await depositTarget(v, forUserId), filename, contentType, size);
  });

/**
 * Facture sans intervention, déposée par le prestataire (ses valideurs sont prévenus) ou saisie pour
 * lui par son N+1 / la compta. Doublon probable : erreur « DOUBLON : … », à confirmer avec `force`.
 */
export const createStandaloneInvoice = async (input: Omit<StandaloneInput, "userId" | "source"> & { forUserId: string | null }) =>
  toResult(async () => {
    const v = await viewer();
    const userId = await depositTarget(v, input.forUserId);
    await recordStandaloneInvoice({ ...input, userId, source: "board" }, userId === v.userId ? await invoiceValidatorIds(userId) : []);
  });

type InvoiceRow = {
  id: string;
  user_id: string | null;
  event_id: string | null;
  label: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  amount_ttc: number | null;
  amount_ht: number | null;
  status: string | null;
  admin_comment: string | null;
  payment_status: string | null;
  paid_at: string | null;
  file_url: string | null;
  created_at: string | null;
};
const INVOICE_COLUMNS = "id, user_id, event_id, label, invoice_number, invoice_date, amount_ttc, amount_ht, status, admin_comment, payment_status, paid_at, file_url, created_at";
const invoiceDay = (r: InvoiceRow) => r.invoice_date ?? (r.created_at ?? new Date().toISOString()).slice(0, 10);

/** Factures sans intervention de l'année : les miennes (« me »), de mes prestataires (« mine ») ou de tous (« all », compta). */
export const getStandaloneInvoices = async (year: number, scope: "me" | "mine" | "all") =>
  toResult(async (): Promise<StandaloneInvoice[]> => {
    const v = await viewer();
    if (scope === "all") requireCompta(v);
    const ids = scope === "me" ? [v.userId] : scope === "mine" ? v.reportIds : null;
    if (ids && !ids.length) return [];
    let q = v.service.from("event_invoices").select(INVOICE_COLUMNS).is("event_id", null).order("created_at");
    if (ids) q = q.in("user_id", ids);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as InvoiceRow[]).filter((r) => r.user_id && invoiceDay(r).startsWith(String(year)));
    if (!rows.length) return [];
    const [{ data: people }, { data: atts }] = await Promise.all([
      v.service.from("profiles").select("id, first_name, last_name, email").in("id", [...new Set(rows.map((r) => r.user_id!))]),
      v.service.from("event_invoice_attachments").select("invoice_id").in("invoice_id", rows.map((r) => r.id)),
    ]);
    const nameBy = new Map((people ?? []).map((p) => [p.id, personName(p)]));
    const attCount = new Map<string, number>();
    for (const a of atts ?? []) if (a.invoice_id) attCount.set(a.invoice_id, (attCount.get(a.invoice_id) ?? 0) + 1);
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id!,
      personName: nameBy.get(r.user_id!) ?? "—",
      label: r.label ?? "Facture",
      invoiceNumber: r.invoice_number,
      date: invoiceDay(r),
      amountTtc: Number(r.amount_ttc ?? 0),
      amountHt: r.amount_ht === null ? null : Number(r.amount_ht),
      invoice: {
        id: r.id,
        status: r.status,
        amountTtc: r.amount_ttc === null ? null : Number(r.amount_ttc),
        files: (r.file_url ? 1 : 0) + (attCount.get(r.id) ?? 0),
        comment: r.admin_comment,
        paidAt: r.payment_status === "paid" ? (r.paid_at ?? r.created_at) : null,
      },
    }));
  });

/** À payer (compta) : factures et notes de frais validées de l'année, payées ou non. */
export const getPayables = async (year: number) =>
  toResult(async (): Promise<Payable[]> => {
    const v = await viewer();
    requireCompta(v);
    const [{ data: invs, error: e1 }, { data: subs, error: e2 }] = await Promise.all([
      v.service.from("event_invoices").select(INVOICE_COLUMNS).eq("status", "approved"),
      v.service.from("expense_submissions").select("id, user_id, event_id, period_month, total_amount, paid_at, submitted_at").eq("status", "approved"),
    ]);
    if (e1 || e2) throw new Error((e1 ?? e2)!.message);
    const eventIds = [...new Set([...(invs ?? []), ...(subs ?? [])].map((r) => r.event_id).filter((id): id is string => !!id))];
    const events: { id: string; title: string; start_date: string }[] = [];
    for (let i = 0; i < eventIds.length; i += 200) {
      const { data } = await v.service.from("events").select("id, title, start_date").in("id", eventIds.slice(i, i + 200));
      events.push(...(data ?? []));
    }
    const eventBy = new Map(events.map((e) => [e.id, e]));
    const personIds = [...new Set([...(invs ?? []).map((r) => r.user_id), ...(subs ?? []).map((r) => r.user_id)].filter((id): id is string => !!id))];
    const { data: people } = personIds.length ? await v.service.from("profiles").select("id, first_name, last_name, email").in("id", personIds) : { data: [] };
    const nameBy = new Map((people ?? []).map((p) => [p.id, personName(p)]));
    const out: Payable[] = [];
    for (const r of (invs ?? []) as InvoiceRow[]) {
      if (!r.user_id) continue;
      const ev = r.event_id ? eventBy.get(r.event_id) : null;
      out.push({
        kind: "invoice",
        id: r.id,
        personId: r.user_id,
        personName: nameBy.get(r.user_id) ?? "—",
        title: ev?.title ?? r.label ?? "Facture",
        eventId: ev ? r.event_id : null,
        date: ev?.start_date ?? `${invoiceDay(r)}T12:00:00.000Z`,
        amount: Number(r.amount_ttc ?? 0),
        paidAt: r.payment_status === "paid" ? (r.paid_at ?? r.created_at) : null,
      });
    }
    for (const r of subs ?? []) {
      const ev = r.event_id ? eventBy.get(r.event_id) : null;
      // « Pas de frais » validé : rien à rembourser.
      if ((r.event_id && !ev) || Number(r.total_amount ?? 0) <= 0) continue;
      out.push({
        kind: "expense",
        id: r.id,
        personId: r.user_id,
        personName: nameBy.get(r.user_id) ?? "—",
        title: ev?.title ?? `Frais hors événement`,
        eventId: ev ? r.event_id : null,
        date: ev?.start_date ?? (r.period_month ? `${r.period_month}-01T12:00:00.000Z` : r.submitted_at),
        amount: Number(r.total_amount ?? 0),
        paidAt: r.paid_at,
      });
    }
    return out.filter((p) => p.date.startsWith(String(year))).sort((a, b) => a.date.localeCompare(b.date));
  });

/**
 * Marque payée (date AAAA-MM-JJ) ou non payée (null) une facture validée ou une note de frais
 * validée (remboursée). La personne est prévenue du paiement.
 */
export const setPaid = async (kind: "invoice" | "expense", id: string, paidOn: string | null) =>
  toResult(async () => {
    const v = await viewer();
    requireCompta(v);
    if (paidOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw new Error("Date de paiement invalide.");
    const paidAt = paidOn ? new Date(`${paidOn}T12:00:00`).toISOString() : null;
    const table = kind === "invoice" ? "event_invoices" : "expense_submissions";
    const { data: row } = await v.service.from(table).select("id, user_id, status").eq("id", id).maybeSingle();
    if (!row?.user_id) throw new Error("Introuvable.");
    if (row.status !== "approved") throw new Error("Seul ce qui est validé peut être payé.");
    const paidBy = paidAt ? v.userId : null;
    const { error } =
      kind === "invoice"
        ? await v.service.from("event_invoices").update({ payment_status: paidAt ? "paid" : "unpaid", paid_at: paidAt, paid_by: paidBy, updated_at: new Date().toISOString() }).eq("id", id)
        : await v.service.from("expense_submissions").update({ paid_at: paidAt, paid_by: paidBy }).eq("id", id);
    if (error) throw new Error(error.message);
    if (paidOn) {
      const { error: nErr } = await v.service.rpc("create_notification", {
        p_user_id: row.user_id,
        p_type: "expense_approved",
        p_title: kind === "invoice" ? "Facture payée" : "Frais remboursés",
        p_message: `${kind === "invoice" ? "Votre facture a été payée" : "Vos frais ont été remboursés"} le ${new Date(`${paidOn}T12:00:00`).toLocaleDateString("fr-FR")}.`,
        p_actor_name: "Comptabilité",
        p_data: { kind: kind === "invoice" ? "invoice_paid" : "expense_paid", id },
      });
      if (nErr) console.error("[staff.setPaid.notify]", nErr);
    }
  });

const emptyCompany: PrestataireCompany = { companyName: "", siret: "", vatNumber: "", iban: "", billingAddress: "", mailDomains: [] };

/** Fiche société d'un prestataire (la mienne si `userId` est vide) : lui, son N+1, la compta. */
export const getPrestataireCompany = async (userId: string | null) =>
  toResult(async (): Promise<PrestataireCompany> => {
    const v = await viewer();
    const id = await depositTarget(v, userId);
    const { data } = await v.service.from("prestataire_profiles").select("*").eq("user_id", id).maybeSingle();
    if (!data) return emptyCompany;
    return {
      companyName: data.company_name ?? "",
      siret: data.siret ?? "",
      vatNumber: data.vat_number ?? "",
      iban: data.iban ?? "",
      billingAddress: data.billing_address ?? "",
      mailDomains: data.mail_domains ?? [],
    };
  });

export const savePrestataireCompany = async (userId: string | null, c: PrestataireCompany) =>
  toResult(async () => {
    const v = await viewer();
    const id = await depositTarget(v, userId);
    const siret = c.siret.replace(/\s/g, "");
    if (siret && !/^\d{14}$/.test(siret)) throw new Error("Le SIRET compte 14 chiffres.");
    const domains = [...new Set(c.mailDomains.map((d) => d.trim().toLowerCase().replace(/^.*@/, "")).filter(Boolean))];
    if (domains.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) throw new Error("Domaine e-mail invalide (ex. traiteurmarie.com).");
    const clean = (x: string) => x.trim() || null;
    const { error } = await v.service.from("prestataire_profiles").upsert({
      user_id: id,
      company_name: clean(c.companyName),
      siret: siret || null,
      vat_number: clean(c.vatNumber),
      iban: c.iban.replace(/\s/g, "").toUpperCase() || null,
      billing_address: clean(c.billingAddress),
      mail_domains: domains,
      updated_by: v.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  });
