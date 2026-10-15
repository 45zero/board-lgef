import "server-only";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Dépôt d'une facture de prestataire, commun au lien sans compte (/facture/<jeton>,
// actions/invoice-public.ts) et au prestataire connecté au board (Factures, actions/staff.ts) :
// le fichier part du navigateur vers le stockage privé « invoices » (lien d'envoi signé), puis
// la facture est enregistrée (event_invoices, statut « pending ») et les valideurs prévenus.

const BUCKET = "invoices";
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/;

type Service = ReturnType<typeof createServiceClient>;

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null } | null) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || p?.email || "—";

/** Lien d'envoi signé vers le stockage privé (le fichier ne transite pas par le serveur). */
export async function prepareInvoiceDeposit(userId: string, filename: string, contentType: string, size: number) {
  if (!ACCEPTED.test(contentType)) throw new Error("Format accepté : PDF ou photo (JPG, PNG).");
  if (size > MAX_BYTES) throw new Error("Fichier trop lourd (15 Mo maximum).");
  const safe = filename.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]+/g, "_").slice(-120);
  const path = `prestataire_invoices/${userId}/${Date.now()}-${safe}`;
  const { data, error } = await createServiceClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Envoi impossible.");
  return { path: data.path, uploadToken: data.token };
}

/**
 * Enregistre une facture déposée pour une intervention : nouvelle facture « à valider » ; une facture
 * refusée est remplacée ; une facture déjà déposée reçoit le fichier en pièce jointe supplémentaire.
 * `notifyIds` (celui qui l'a réclamée, ou le N+1) sont prévenus.
 */
export async function recordInvoiceDeposit(
  input: { userId: string; eventId: string; path: string; amountTtc: number | null; comment: string },
  notifyIds: string[]
) {
  const { userId, eventId, path, amountTtc, comment } = input;
  if (!path.startsWith(`prestataire_invoices/${userId}/`)) throw new Error("Fichier invalide.");
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
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    const { error } = await service.from("event_invoices").insert({
      event_id: eventId,
      user_id: userId,
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

  await notifyDeposit(service, userId, eventId, amountTtc, [...new Set(notifyIds.filter((id) => id && id !== userId))]);
}

async function notifyDeposit(service: Service, userId: string, eventId: string, amountTtc: number, notifyIds: string[]) {
  if (!notifyIds.length) return;
  const [{ data: person }, { data: event }] = await Promise.all([
    service.from("profiles").select("first_name, last_name, email").eq("id", userId).maybeSingle(),
    service.from("events").select("title").eq("id", eventId).maybeSingle(),
  ]);
  for (const id of notifyIds) {
    const { error } = await service.rpc("create_notification", {
      p_user_id: id,
      p_type: "expense_submitted",
      p_title: "Facture déposée",
      p_message: `${personName(person)} a déposé sa facture pour « ${event?.title ?? "l'événement"} » (${amountTtc.toLocaleString("fr-FR")} € TTC).`,
      p_actor_name: personName(person),
      p_data: { event_id: eventId, kind: "invoice_submitted" },
    });
    if (error) console.error("[invoiceDeposit.notify]", error);
  }
}
