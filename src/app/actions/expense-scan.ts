"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getSolicitations } from "@/lib/board/solicitation";
import { isReceiptOcrConfigured, readReceipt } from "@/lib/board/receiptOcr";
import { eventRanker, toReceiptInput, type EventCandidate } from "@/lib/board/receiptScan";
import type { ExpenseCategory } from "@/lib/board/expenseCategories";

// Justificatifs de frais : dépôt direct dans le bucket public expense_scans (URL signée, pas de
// limite de taille des fonctions), lecture par Claude, puis rapprochement avec les événements de
// la personne (date + lieu/nom), sinon recherche manuelle ou « hors événement ».

const BUCKET = "expense_scans";
const DAY = 86_400_000;

export type { EventCandidate } from "@/lib/board/receiptScan";

export type ScannedExpense = {
  date: string | null;
  merchant: string | null;
  description: string | null;
  category: ExpenseCategory;
  amount: number;
  distanceKm: number | null;
  place: string | null;
  /** Événement retenu automatiquement (null : à choisir, ou hors événement). */
  suggestedEventId: string | null;
  candidates: EventCandidate[];
};

export type ScanResult = {
  error: string | null;
  fileUrl: string | null;
  fileType: string | null;
  documentType: string | null;
  expenses: ScannedExpense[];
};

async function currentUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return userId;
}

const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "pdf", "xlsx", "csv", "txt"];
const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

/** URL signée pour déposer un justificatif (chemin propre à la personne). */
export async function createReceiptUpload(fileName: string): Promise<{ error: string | null; path: string; token: string; publicUrl: string }> {
  try {
    const userId = await currentUserId();
    const ext = extOf(fileName);
    if (!ALLOWED_EXT.includes(ext)) throw new Error("Format non pris en charge (photo, PDF, Excel ou CSV).");
    const path = `expense_scans/${userId}/${randomUUID()}.${ext}`;
    const service = createServiceClient();
    const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "Dépôt impossible.");
    return { error: null, path, token: data.token, publicUrl: service.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue.", path: "", token: "", publicUrl: "" };
  }
}

/**
 * Lit un justificatif déposé (photo, PDF, Excel, CSV) et propose l'événement de chaque dépense.
 * `eventId` : dépôt depuis la fiche d'un événement — pas de rapprochement, l'événement est connu.
 */
export async function scanReceipt(path: string, opts: { eventId?: string } = {}): Promise<ScanResult> {
  const empty = { fileUrl: null, fileType: null, documentType: null, expenses: [] };
  try {
    const userId = await currentUserId();
    if (!path.startsWith(`expense_scans/${userId}/`) || path.includes("..")) throw new Error("Justificatif non reconnu.");
    const service = createServiceClient();
    const fileUrl = service.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const ext = extOf(path);
    const fileType = ext === "pdf" ? "application/pdf" : ["xlsx", "csv", "txt"].includes(ext) ? "spreadsheet" : "image";
    if (!isReceiptOcrConfigured()) return { ...empty, error: "Lecture automatique indisponible : saisissez le montant.", fileUrl, fileType };

    const { data: blob, error: dlError } = await service.storage.from(BUCKET).download(path);
    if (dlError || !blob) throw new Error("Justificatif introuvable.");
    const buffer = Buffer.from(await blob.arrayBuffer());
    if (buffer.length > 25 * 1024 * 1024) throw new Error("Fichier trop volumineux (25 Mo maximum).");

    const scan = await readReceipt(await toReceiptInput(buffer, ext, path.split("/").pop() ?? "justificatif"));
    if (!scan) return { ...empty, error: "Lecture impossible : saisissez les informations à la main.", fileUrl, fileType };
    if (scan.expenses.length === 0) return { ...empty, error: "Aucune dépense reconnue sur ce document.", fileUrl, fileType, documentType: scan.documentType };

    if (opts.eventId) {
      return {
        error: null,
        fileUrl,
        fileType,
        documentType: scan.documentType,
        expenses: scan.expenses.map((e) => ({
          date: e.date,
          merchant: e.merchant,
          description: e.description,
          category: e.category,
          amount: Math.round(e.amount * 100) / 100,
          distanceKm: e.distanceKm,
          place: e.place,
          suggestedEventId: opts.eventId!,
          candidates: [],
        })),
      };
    }

    // Rapprochement : événements autour des dates lues, mes sollicitations en priorité.
    const rank = await eventRanker(service, userId, scan.expenses);

    return {
      error: null,
      fileUrl,
      fileType,
      documentType: scan.documentType,
      expenses: scan.expenses.map((e) => ({
        date: e.date,
        merchant: e.merchant,
        description: e.description,
        category: e.category,
        amount: Math.round(e.amount * 100) / 100,
        distanceKm: e.distanceKm,
        place: e.place,
        ...rank(e),
      })),
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

/** Recherche d'un événement pour y rattacher une dépense (titre ou lieu ; autour d'une date sinon). */
export async function searchEventsForExpense(query: string, date: string | null): Promise<EventCandidate[]> {
  const userId = await currentUserId();
  const service = createServiceClient();
  const q = query.trim().replace(/[%,()]/g, " ");
  let req = service.from("events").select("id, title, start_date, end_date, location").order("start_date", { ascending: false }).limit(15);
  if (q) {
    req = req.or(`title.ilike.%${q}%,location.ilike.%${q}%`).gte("start_date", new Date(Date.now() - 548 * DAY).toISOString());
  } else if (date) {
    const day = new Date(`${date}T12:00:00Z`).getTime();
    req = req.lte("start_date", new Date(day + 7 * DAY).toISOString()).gte("end_date", new Date(day - 7 * DAY).toISOString());
  } else {
    req = req.lte("start_date", new Date().toISOString()).gte("start_date", new Date(Date.now() - 30 * DAY).toISOString());
  }
  const [{ data }, roles] = await Promise.all([req, getSolicitations(service, userId, { includePendingDirector: true, includeProposedCoverage: true })]);
  return (data ?? [])
    .map((e) => ({ id: e.id, title: e.title, start: e.start_date, location: e.location, solicited: roles.has(e.id) }))
    .sort((a, b) => Number(b.solicited) - Number(a.solicited));
}
