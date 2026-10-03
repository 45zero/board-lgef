"use server";

import { toResult } from "@/lib/board/actionResult";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { readInvoiceToken } from "@/lib/board/invoiceToken";

// Page publique /facture/<jeton> : le prestataire dépose ses factures depuis le lien reçu par e-mail,
// sans compte — une par intervention réclamée. Le jeton signé (invoiceToken.ts) dit pour quelle
// personne et quels événements ; chaque fichier part directement du navigateur vers le stockage privé
// « invoices » (lien d'envoi signé), rangé et enregistré comme ceux de l'appli calendrier
// (event_invoices, statut « pending »).

const BUCKET = "invoices";
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/;

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null } | null) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || p?.email || "—";

function payload(token: string, eventId?: string) {
  const p = readInvoiceToken(token);
  if (!p) throw new Error("Ce lien n'est plus valide. Demandez un nouveau lien à votre responsable.");
  if (eventId && !p.eventIds.includes(eventId)) throw new Error("Cette intervention ne fait pas partie de la demande.");
  return p;
}

export type InvoiceRequestItem = {
  eventId: string;
  eventTitle: string;
  eventStart: string;
  location: string | null;
  expectedAmount: number | null;
  existing: { status: string | null; amountTtc: number | null; comment: string | null } | null;
};

export type InvoiceRequestInfo = {
  personFirstName: string;
  requesterName: string;
  requesterEmail: string | null;
  comment: string | null;
  items: InvoiceRequestItem[];
};

export const getInvoiceRequest = async (token: string) =>
  toResult(async (): Promise<InvoiceRequestInfo> => {
    const p = payload(token);
    const service = createServiceClient();
    const [{ data: events }, { data: person }, { data: requester }, { data: adjs }, { data: rate }, { data: invoices }] = await Promise.all([
      service.from("events").select("id, title, start_date, location").in("id", p.eventIds),
      service.from("profiles").select("first_name, last_name, email").eq("id", p.userId).maybeSingle(),
      service.from("profiles").select("first_name, last_name, email").eq("id", p.requesterId).maybeSingle(),
      service.from("event_cost_adjustments").select("event_id, amount_eur").in("event_id", p.eventIds).eq("user_id", p.userId),
      service.from("staff_rates").select("amount_eur").eq("user_id", p.userId).maybeSingle(),
      service.from("event_invoices").select("event_id, status, amount_ttc, admin_comment, created_at").in("event_id", p.eventIds).eq("user_id", p.userId).order("created_at"),
    ]);
    if (!person || !events?.length) throw new Error("Ces interventions n'existent plus.");
    const adjBy = new Map((adjs ?? []).map((a) => [a.event_id, Number(a.amount_eur)]));
    const invoiceBy = new Map((invoices ?? []).map((i) => [i.event_id, i]));
    return {
      personFirstName: person.first_name?.trim() || personName(person),
      requesterName: personName(requester),
      requesterEmail: requester?.email ?? null,
      comment: p.comment,
      items: events
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .map((e) => {
          const inv = invoiceBy.get(e.id);
          return {
            eventId: e.id,
            eventTitle: e.title,
            eventStart: e.start_date,
            location: e.location,
            expectedAmount: adjBy.get(e.id) ?? (rate ? Number(rate.amount_eur) : null),
            existing: inv ? { status: inv.status, amountTtc: inv.amount_ttc === null ? null : Number(inv.amount_ttc), comment: inv.admin_comment } : null,
          };
        }),
    };
  });

/** Lien d'envoi signé vers le stockage privé (le fichier ne transite pas par le serveur). */
export const prepareInvoiceUpload = async (token: string, eventId: string, filename: string, contentType: string, size: number) =>
  toResult(async () => {
    const p = payload(token, eventId);
    if (!ACCEPTED.test(contentType)) throw new Error("Format accepté : PDF ou photo (JPG, PNG).");
    if (size > MAX_BYTES) throw new Error("Fichier trop lourd (15 Mo maximum).");
    const safe = filename.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]+/g, "_").slice(-120);
    const path = `prestataire_invoices/${p.userId}/${Date.now()}-${safe}`;
    const { data, error } = await createServiceClient().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "Envoi impossible.");
    return { path: data.path, uploadToken: data.token };
  });

/**
 * Enregistre une facture déposée pour une intervention : nouvelle facture « à valider » ; une facture
 * refusée est remplacée ; une facture déjà déposée reçoit le fichier en pièce jointe supplémentaire.
 * Le demandeur est prévenu.
 */
export const confirmInvoiceUpload = async (token: string, eventId: string, path: string, amountTtc: number | null, comment: string) =>
  toResult(async () => {
    const p = payload(token, eventId);
    if (!path.startsWith(`prestataire_invoices/${p.userId}/`)) throw new Error("Fichier invalide.");
    if (amountTtc === null) throw new Error("Indiquez le montant TTC de la facture.");
    if (!Number.isFinite(amountTtc) || amountTtc < 0 || amountTtc > 100000) throw new Error("Montant invalide.");
    const service = createServiceClient();
    const folder = path.slice(0, path.lastIndexOf("/"));
    const { data: listed } = await service.storage.from(BUCKET).list(folder, { search: path.slice(path.lastIndexOf("/") + 1) });
    if (!listed?.length) throw new Error("Le fichier n'est pas arrivé, réessayez.");

    const now = new Date().toISOString();
    const note = comment.trim() || null;
    const { data: existing } = await service
      .from("event_invoices")
      .select("id, status")
      .eq("event_id", eventId)
      .eq("user_id", p.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing) {
      const { error } = await service.from("event_invoices").insert({
        event_id: eventId,
        user_id: p.userId,
        amount_ttc: amountTtc,
        file_url: path,
        status: "pending",
        submitted_at: now,
        prestataire_comment: note,
      });
      if (error) throw new Error(error.message);
    } else if (existing.status === "rejected") {
      const { error } = await service
        .from("event_invoices")
        .update({ file_url: path, amount_ttc: amountTtc, status: "pending", submitted_at: now, prestataire_comment: note, admin_comment: null, updated_at: now })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await service.from("event_invoice_attachments").insert({ invoice_id: existing.id, file_url: path, custom_name: path.split("/").pop()?.replace(/^\d+-/, "") ?? null });
      if (error) throw new Error(error.message);
    }

    // Prévenir celui qui a réclamé la facture (et la retrouver dans l'Effectif).
    const [{ data: person }, { data: event }] = await Promise.all([
      service.from("profiles").select("first_name, last_name, email").eq("id", p.userId).maybeSingle(),
      service.from("events").select("title").eq("id", eventId).maybeSingle(),
    ]);
    if (p.requesterId) {
      const { error } = await service.rpc("create_notification", {
        p_user_id: p.requesterId,
        p_type: "expense_submitted",
        p_title: "Facture déposée",
        p_message: `${personName(person)} a déposé sa facture pour « ${event?.title ?? "l'événement"} » (${amountTtc.toLocaleString("fr-FR")} € TTC).`,
        p_actor_name: personName(person),
        p_data: { event_id: eventId, kind: "invoice_submitted" },
      });
      if (error) console.error("[invoice-public.notify]", error);
    }
  });
