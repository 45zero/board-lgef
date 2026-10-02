"use server";

import { toResult } from "@/lib/board/actionResult";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { readInvoiceToken } from "@/lib/board/invoiceToken";

// Page publique /facture/<jeton> : le prestataire dépose sa facture depuis le lien reçu par e-mail,
// sans compte. Le jeton signé (invoiceToken.ts) dit pour quel événement et quelle personne ; le
// fichier part directement du navigateur vers le stockage privé « invoices » (lien d'envoi signé),
// rangé et enregistré comme ceux de l'appli calendrier (event_invoices, statut « pending »).

const BUCKET = "invoices";
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/;

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null } | null) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || p?.email || "—";

function payload(token: string) {
  const p = readInvoiceToken(token);
  if (!p) throw new Error("Ce lien n'est plus valide. Demandez un nouveau lien à votre responsable.");
  return p;
}

export type InvoiceRequestInfo = {
  personFirstName: string;
  eventTitle: string;
  eventStart: string;
  location: string | null;
  expectedAmount: number | null;
  requesterName: string;
  requesterEmail: string | null;
  existing: { status: string | null; amountTtc: number | null } | null;
};

export const getInvoiceRequest = async (token: string) =>
  toResult(async (): Promise<InvoiceRequestInfo> => {
    const p = payload(token);
    const service = createServiceClient();
    const [{ data: event }, { data: person }, { data: requester }, { data: adj }, { data: rate }, { data: existing }] = await Promise.all([
      service.from("events").select("title, start_date, location").eq("id", p.eventId).maybeSingle(),
      service.from("profiles").select("first_name, last_name, email").eq("id", p.userId).maybeSingle(),
      service.from("profiles").select("first_name, last_name, email").eq("id", p.requesterId).maybeSingle(),
      service.from("event_cost_adjustments").select("amount_eur").eq("event_id", p.eventId).eq("user_id", p.userId).maybeSingle(),
      service.from("staff_rates").select("amount_eur").eq("user_id", p.userId).maybeSingle(),
      service.from("event_invoices").select("status, amount_ttc").eq("event_id", p.eventId).eq("user_id", p.userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!event || !person) throw new Error("Cet événement n'existe plus.");
    return {
      personFirstName: person.first_name?.trim() || personName(person),
      eventTitle: event.title,
      eventStart: event.start_date,
      location: event.location,
      expectedAmount: adj ? Number(adj.amount_eur) : rate ? Number(rate.amount_eur) : null,
      requesterName: personName(requester),
      requesterEmail: requester?.email ?? null,
      existing: existing ? { status: existing.status, amountTtc: existing.amount_ttc === null ? null : Number(existing.amount_ttc) } : null,
    };
  });

/** Lien d'envoi signé vers le stockage privé (le fichier ne transite pas par le serveur). */
export const prepareInvoiceUpload = async (token: string, filename: string, contentType: string, size: number) =>
  toResult(async () => {
    const p = payload(token);
    if (!ACCEPTED.test(contentType)) throw new Error("Format accepté : PDF ou photo (JPG, PNG).");
    if (size > MAX_BYTES) throw new Error("Fichier trop lourd (15 Mo maximum).");
    const safe = filename.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]+/g, "_").slice(-120);
    const path = `prestataire_invoices/${p.userId}/${Date.now()}-${safe}`;
    const { data, error } = await createServiceClient().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "Envoi impossible.");
    return { path: data.path, uploadToken: data.token };
  });

/**
 * Enregistre la facture déposée : nouvelle facture « à valider » ; une facture refusée est remplacée ;
 * une facture déjà déposée reçoit le fichier en pièce jointe supplémentaire. Le demandeur est prévenu.
 */
export const confirmInvoiceUpload = async (token: string, path: string, amountTtc: number | null, comment: string) =>
  toResult(async () => {
    const p = payload(token);
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
      .eq("event_id", p.eventId)
      .eq("user_id", p.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing) {
      const { error } = await service.from("event_invoices").insert({
        event_id: p.eventId,
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
        .update({ file_url: path, amount_ttc: amountTtc, status: "pending", submitted_at: now, prestataire_comment: note, updated_at: now })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await service.from("event_invoice_attachments").insert({ invoice_id: existing.id, file_url: path, custom_name: path.split("/").pop()?.replace(/^\d+-/, "") ?? null });
      if (error) throw new Error(error.message);
    }

    // Prévenir celui qui a réclamé la facture (et la retrouver dans l'Effectif).
    const [{ data: person }, { data: event }] = await Promise.all([
      service.from("profiles").select("first_name, last_name, email").eq("id", p.userId).maybeSingle(),
      service.from("events").select("title").eq("id", p.eventId).maybeSingle(),
    ]);
    if (p.requesterId) {
      const { error } = await service.rpc("create_notification", {
        p_user_id: p.requesterId,
        p_type: "expense_submitted",
        p_title: "Facture déposée",
        p_message: `${personName(person)} a déposé sa facture pour « ${event?.title ?? "l'événement"} » (${amountTtc.toLocaleString("fr-FR")} € TTC).`,
        p_actor_name: personName(person),
        p_data: { event_id: p.eventId, kind: "invoice_submitted" },
      });
      if (error) console.error("[invoice-public.notify]", error);
    }
  });
