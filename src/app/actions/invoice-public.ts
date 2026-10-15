"use server";

import { toResult } from "@/lib/board/actionResult";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { readInvoiceToken } from "@/lib/board/invoiceToken";
import { prepareInvoiceDeposit, recordInvoiceDeposit } from "@/lib/board/invoiceDeposit";

// Page publique /facture/<jeton> : le prestataire dépose ses factures depuis le lien reçu par e-mail,
// sans compte — une par intervention réclamée. Le jeton signé (invoiceToken.ts) dit pour quelle
// personne et quels événements ; dépôt et enregistrement communs avec le board (invoiceDeposit.ts).

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
  toResult(async () => prepareInvoiceDeposit(payload(token, eventId).userId, filename, contentType, size));

/** Enregistre la facture déposée (voir invoiceDeposit.ts) ; celui qui l'a réclamée est prévenu. */
export const confirmInvoiceUpload = async (token: string, eventId: string, path: string, amountTtc: number | null, comment: string) =>
  toResult(async () => {
    const p = payload(token, eventId);
    await recordInvoiceDeposit({ userId: p.userId, eventId, path, amountTtc, comment, source: "link" }, p.requesterId ? [p.requesterId] : []);
  });
