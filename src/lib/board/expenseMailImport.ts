import "server-only";
import { randomUUID } from "node:crypto";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { getGoogleAccountById } from "@/lib/google/accounts";
import { getAttachment, getMessage, listMessages } from "@/lib/google/gmail";
import { archiveReceipts } from "@/lib/board/expenseArchive";
import { insertExpenseLines, isForeign, type NewExpenseLine } from "@/lib/board/expenseLines";
import { isReceiptOcrConfigured, readReceipt } from "@/lib/board/receiptOcr";
import { eventRanker, toReceiptInput } from "@/lib/board/receiptScan";

// Factures reçues par e-mail → frais (Frais → Paramètres → Factures par e-mail).
// Pour chaque règle active : mails de la boîte Gmail connectée qui correspondent (expéditeur, mots
// du sujet), reçus depuis la création de la règle, avec pièce jointe. Chaque PDF / photo est déposé
// dans expense_scans comme un justificatif apporté à la main, lu par Claude, puis ajouté aux frais
// de la personne : hors événement du mois de la facture, ou l'événement si la règle le demande et
// que le rapprochement est net. Le journal expense_mail_imports évite tout doublon.

type Service = ReturnType<typeof createServiceClient>;

export type ExpenseMailRule = {
  id: string;
  user_id: string;
  account_id: string;
  label: string;
  from_filter: string;
  subject_filter: string;
  match_events: boolean;
  enabled: boolean;
  created_at: string;
};

/** Mails examinés au plus par règle et par passage (le reste attend le passage suivant). */
const MAX_MESSAGES = 10;
/** En dessous : logo ou signature, pas une facture. */
const MIN_IMAGE_BYTES = 15_000;
const MAX_BYTES = 25 * 1024 * 1024;

const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };

/** Filtre Gmail d'un texte libre : entre guillemets s'il contient des espaces. */
const term = (s: string) => {
  const t = s.trim().replace(/"/g, "");
  return /\s/.test(t) ? `"${t}"` : t;
};

/** Requête Gmail d'une règle : expéditeur, sujet, pièce jointe, reçus depuis sa création. */
export function ruleQuery(rule: Pick<ExpenseMailRule, "from_filter" | "subject_filter" | "created_at">) {
  const parts = ["has:attachment", `after:${Math.floor(new Date(rule.created_at).getTime() / 1000)}`];
  if (rule.from_filter.trim()) parts.push(`from:(${term(rule.from_filter)})`);
  if (rule.subject_filter.trim()) parts.push(`subject:(${term(rule.subject_filter)})`);
  return parts.join(" ");
}

type Picked = { attachmentId: string; filename: string; ext: string; mimeType: string };

/** Pièces jointes à lire : les PDF ; à défaut, les photos assez grandes pour être une facture. */
function pickAttachments(atts: { attachmentId: string; filename: string; mimeType: string; size: number }[]): Picked[] {
  const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
  const pdfs = atts.filter((a) => a.mimeType === "application/pdf" || extOf(a.filename) === "pdf");
  if (pdfs.length) return pdfs.map((a) => ({ ...a, ext: "pdf", mimeType: "application/pdf" }));
  return atts.filter((a) => IMAGE_EXT[a.mimeType] && a.size >= MIN_IMAGE_BYTES).map((a) => ({ ...a, ext: IMAGE_EXT[a.mimeType] }));
}

type ImportOutcome = { status: "imported" | "ignored" | "error"; detail: string | null; expense_ids?: string[]; total?: number | null };

const money = (n: number, currency: string) => new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(n);
const euros = (n: number) => money(n, "EUR");

/** Passe une règle (au plus `maxMessages` mails, les plus anciens d'abord) : renvoie le nombre de factures importées et leur total. */
export async function runExpenseMailRule(
  service: Service,
  rule: ExpenseMailRule,
  maxMessages = MAX_MESSAGES
): Promise<{ imported: number; total: number; toConvert: number; error: string | null }> {
  let imported = 0;
  let total = 0;
  let toConvert = 0;
  try {
    if (!isReceiptOcrConfigured()) throw new Error("Lecture automatique indisponible (clé Claude absente).");
    const account = await getGoogleAccountById(rule.account_id);
    if (!account || account.user_id !== rule.user_id) throw new Error("Compte Google introuvable : reconnectez-le dans Paramètres → Comptes Google.");

    const { messages } = await listMessages(account, { query: ruleQuery(rule) });
    if (messages.length) {
      // Mails déjà passés (au moins une ligne au journal) : ignorés.
      const { data: done } = await service
        .from("expense_mail_imports")
        .select("gmail_message_id")
        .eq("user_id", rule.user_id)
        .in(
          "gmail_message_id",
          messages.map((m) => m.id)
        );
      const seen = new Set((done ?? []).map((d) => d.gmail_message_id));
      // Du plus ancien au plus récent.
      const todo = messages.filter((m) => !seen.has(m.id)).slice(-maxMessages).reverse();

      for (const m of todo) {
        const msg = await getMessage(account, m.id);
        const mailDate = msg.date && !Number.isNaN(Date.parse(msg.date)) ? new Date(msg.date).toISOString() : null;
        const base = { user_id: rule.user_id, rule_id: rule.id, gmail_message_id: m.id, mail_from: msg.from, mail_subject: msg.subject, mail_date: mailDate };
        const picked = pickAttachments(msg.attachments);
        if (!picked.length) {
          await service
            .from("expense_mail_imports")
            .upsert({ ...base, attachment_name: "", status: "ignored", detail: "Aucune pièce jointe PDF ou photo." }, { onConflict: "user_id,gmail_message_id,attachment_name", ignoreDuplicates: true });
          continue;
        }
        for (const att of picked) {
          const name = att.filename || `piece.${att.ext}`;
          // Réservation de la pièce jointe avant traitement : deux passages simultanés ne l'importent pas deux fois.
          const { data: claimed } = await service
            .from("expense_mail_imports")
            .upsert({ ...base, attachment_name: name, status: "error", detail: "Traitement en cours…" }, { onConflict: "user_id,gmail_message_id,attachment_name", ignoreDuplicates: true })
            .select("id");
          if (!claimed?.length) continue;
          const outcome = await importAttachment(service, rule, account, m.id, att, mailDate);
          await service.from("expense_mail_imports").update(outcome).eq("id", claimed[0].id);
          if (outcome.status === "imported") {
            imported++;
            total += outcome.total ?? 0;
            if (outcome.total == null) toConvert++;
          }
        }
      }
    }
    await service.from("expense_mail_rules").update({ last_checked_at: new Date().toISOString(), last_error: null }).eq("id", rule.id);
    return { imported, total, toConvert, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Erreur inattendue.";
    await service.from("expense_mail_rules").update({ last_checked_at: new Date().toISOString(), last_error: error }).eq("id", rule.id);
    return { imported, total, toConvert, error };
  }
}

/** Dépose, lit et ajoute aux frais une pièce jointe. */
async function importAttachment(
  service: Service,
  rule: ExpenseMailRule,
  account: NonNullable<Awaited<ReturnType<typeof getGoogleAccountById>>>,
  messageId: string,
  att: Picked,
  mailDate: string | null
): Promise<ImportOutcome> {
  const { data } = await getAttachment(account, messageId, att.attachmentId);
  const buffer = Buffer.from(data, "base64url");
  if (!buffer.length) return { status: "error", detail: "Pièce jointe vide." };
  if (buffer.length > MAX_BYTES) return { status: "ignored", detail: "Fichier trop volumineux (25 Mo maximum)." };

  // Même dépôt qu'un justificatif apporté à la main.
  const path = `expense_scans/${rule.user_id}/${randomUUID()}.${att.ext}`;
  const bucket = service.storage.from("expense_scans");
  const { error: upErr } = await bucket.upload(path, buffer, { contentType: att.mimeType });
  if (upErr) return { status: "error", detail: `Dépôt impossible : ${upErr.message}` };
  const url = bucket.getPublicUrl(path).data.publicUrl;
  const drop = async (status: "ignored" | "error", detail: string): Promise<ImportOutcome> => {
    await bucket.remove([path]);
    return { status, detail };
  };

  try {
    const scan = await readReceipt(await toReceiptInput(buffer, att.ext, att.filename || path.split("/").pop()!));
    if (!scan) return await drop("error", "Lecture par Claude impossible.");
    if (!scan.expenses.length) return await drop("ignored", "Aucune dépense reconnue (pas une facture ?).");

    const rank = rule.match_events ? await eventRanker(service, rule.user_id, scan.expenses) : null;
    const fallbackDate = (mailDate ?? new Date().toISOString()).slice(0, 10);
    const lines: NewExpenseLine[] = scan.expenses.map((e) => ({
      eventId: rank ? rank(e).suggestedEventId : null,
      category: e.category,
      amount: Math.round(e.amount * 100) / 100,
      date: e.date ?? fallbackDate,
      merchant: e.merchant,
      description: e.description,
      distanceKm: e.distanceKm,
      attachments: [{ url, type: att.mimeType }],
      currency: e.currency,
    }));
    const { ids, toArchive } = await insertExpenseLines(service, rule.user_id, lines);
    await archiveReceipts(toArchive).catch(() => undefined);
    const merchant = scan.expenses[0]?.merchant;
    // Facture en devise : montant d'origine, total en euros inconnu tant que la ligne n'est pas convertie.
    const foreign = lines.find((l) => isForeign(l.currency));
    if (foreign) {
      const amount = money(lines.filter((l) => l.currency === foreign.currency).reduce((n, l) => n + l.amount, 0), foreign.currency!);
      return { status: "imported", detail: `${merchant ? `${merchant} · ` : ""}${amount} — à convertir en euros`, expense_ids: ids, total: null };
    }
    const sum = lines.reduce((n, l) => n + l.amount, 0);
    return { status: "imported", detail: merchant ? `${merchant} · ${euros(sum)}` : euros(sum), expense_ids: ids, total: sum };
  } catch (e) {
    return await drop("error", e instanceof Error ? e.message : "Erreur inattendue.");
  }
}

/** Prévient la personne des factures ajoutées à ses frais. */
export async function notifyImported(service: Service, userId: string, count: number, total: number, toConvert = 0) {
  if (!count) return;
  const title = count > 1 ? `${count} factures ajoutées à vos frais` : "Facture ajoutée à vos frais";
  const convert =
    toConvert === 0 ? "" : toConvert === 1 ? " Une facture est en devise étrangère : convertissez-la en euros." : ` ${toConvert} factures sont en devise étrangère : convertissez-les en euros.`;
  const message = `${count > 1 ? `${count} factures reçues par e-mail ont été lues et ajoutées` : "Une facture reçue par e-mail a été lue et ajoutée"} à vos frais${toConvert < count ? ` (${euros(total)})` : ""}.${convert} Vérifiez avant de déclarer.`;
  const data = { kind: "expense_mail_import", app: "frais" };
  const { data: notif } = await service
    .from("notifications")
    .insert({ user_id: userId, type: "expense_submitted", title, message, data: data as never })
    .select("id")
    .single();
  await service
    .from("push_outbox")
    .insert({ user_id: userId, title, body: message, data, type: "expense_submitted", notification_id: notif?.id ?? null } as never);
}
