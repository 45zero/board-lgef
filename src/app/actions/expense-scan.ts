"use server";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getSolicitations } from "@/lib/board/solicitation";
import { isReceiptOcrConfigured, readReceipt, type ReceiptInput } from "@/lib/board/receiptOcr";
import type { ExpenseCategory } from "@/lib/board/expenseCategories";

// Justificatifs de frais : dépôt direct dans le bucket public expense_scans (URL signée, pas de
// limite de taille des fonctions), lecture par Claude, puis rapprochement avec les événements de
// la personne (date + lieu/nom), sinon recherche manuelle ou « hors événement ».

const BUCKET = "expense_scans";
const DAY = 86_400_000;

export type EventCandidate = { id: string; title: string; start: string; location: string | null; solicited: boolean };

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

async function toReceiptInput(buffer: Buffer, ext: string, fileName: string): Promise<ReceiptInput> {
  if (ext === "pdf") return { kind: "pdf", base64: buffer.toString("base64") };
  if (ext === "csv" || ext === "txt") return { kind: "text", text: buffer.toString("utf8").slice(0, 60_000).replaceAll(";", "\t"), fileName };
  if (ext === "xlsx") {
    const { readSheet } = await import("read-excel-file/node");
    const rows = (await readSheet(buffer)) as unknown[][];
    const text = rows
      .slice(0, 500)
      .map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : (c ?? "").toString())).join("\t"))
      .join("\n");
    return { kind: "text", text, fileName };
  }
  // Photo : orientation EXIF, taille raisonnable pour la lecture, JPEG.
  try {
    const jpeg = await sharp(buffer).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { kind: "image", mediaType: "image/jpeg", base64: jpeg.toString("base64") };
  } catch {
    throw new Error("Photo illisible : réessayez en JPEG ou PNG.");
  }
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const tokens = (s: string | null | undefined) => new Set(normalize(s ?? "").split(/[^a-z0-9]+/).filter((t) => t.length >= 4));

type EventRow = { id: string; title: string; start_date: string; end_date: string; location: string | null };

/**
 * Candidats pour une dépense : événements qui se déroulent autour de sa date (la veille pour un
 * hôtel ou un plein, le lendemain pour un retour), classés par sollicitation, proximité et
 * correspondance du lieu / nom. Retenu automatiquement si un candidat se détache nettement.
 */
function rank(
  expense: { date: string | null; place: string | null; merchant: string | null; eventHint: string | null; description: string | null },
  events: EventRow[],
  solicited: Set<string>
) {
  if (!expense.date) return { suggestedEventId: null, candidates: [] as EventCandidate[] };
  const day = new Date(`${expense.date}T12:00:00Z`).getTime();
  const words = new Set([...tokens(expense.place), ...tokens(expense.merchant), ...tokens(expense.eventHint), ...tokens(expense.description)]);
  const scored = events
    .map((e) => {
      const start = new Date(e.start_date).getTime();
      const end = new Date(e.end_date).getTime();
      const gap = day < start ? (start - day) / DAY : day > end ? (day - end) / DAY : 0;
      if (gap > 1.6) return null;
      const evWords = new Set([...tokens(e.title), ...tokens(e.location)]);
      const text = [...words].filter((w) => evWords.has(w)).length;
      const score = (solicited.has(e.id) ? 5 : 0) + Math.min(text, 3) * 2 - gap * 2;
      return { e, score };
    })
    .filter((x): x is { e: EventRow; score: number } => !!x)
    .sort((a, b) => b.score - a.score);

  const candidates = scored.slice(0, 5).map(({ e }) => ({ id: e.id, title: e.title, start: e.start_date, location: e.location, solicited: solicited.has(e.id) }));
  const [first, second] = scored;
  const clear = !!first && first.score >= 4 && (!second || first.score - second.score >= 3);
  return { suggestedEventId: clear ? first.e.id : null, candidates };
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
    const dates = scan.expenses.map((e) => e.date).filter((d): d is string => !!d).sort();
    let events: EventRow[] = [];
    let solicited = new Set<string>();
    if (dates.length) {
      const from = new Date(new Date(`${dates[0]}T00:00:00Z`).getTime() - 3 * DAY).toISOString();
      const to = new Date(new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime() + 3 * DAY).toISOString();
      const [{ data }, roles] = await Promise.all([
        service.from("events").select("id, title, start_date, end_date, location").lte("start_date", to).gte("end_date", from).limit(300),
        getSolicitations(service, userId, { includePendingDirector: true, includeProposedCoverage: true }),
      ]);
      events = data ?? [];
      solicited = new Set(roles.keys());
    }

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
        ...rank(e, events, solicited),
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
