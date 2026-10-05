import "server-only";
import sharp from "sharp";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { getSolicitations } from "@/lib/board/solicitation";
import type { ReceiptInput } from "@/lib/board/receiptOcr";

// Lecture d'un justificatif et rapprochement de ses dépenses avec les événements de la personne :
// partagé par le dépôt à la main (actions/expense-scan.ts) et l'import des factures reçues par
// e-mail (lib/board/expenseMailImport.ts).

const DAY = 86_400_000;

export type EventCandidate = { id: string; title: string; start: string; location: string | null; solicited: boolean };
type RankInput = { date: string | null; place: string | null; merchant: string | null; eventHint: string | null; description: string | null };

/** Fichier (photo, PDF, Excel, CSV) → contenu lisible par Claude. */
export async function toReceiptInput(buffer: Buffer, ext: string, fileName: string): Promise<ReceiptInput> {
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

export type EventRow = { id: string; title: string; start_date: string; end_date: string; location: string | null };

/**
 * Candidats pour une dépense : événements qui se déroulent autour de sa date (la veille pour un
 * hôtel ou un plein, le lendemain pour un retour), classés par sollicitation, proximité et
 * correspondance du lieu / nom. Retenu automatiquement si un candidat se détache nettement.
 */
function rank(
  expense: RankInput,
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
 * Prépare le rapprochement des dépenses lues : charge les événements autour de leurs dates et les
 * sollicitations de la personne, puis renvoie le classement de chaque dépense (voir rank).
 */
export async function eventRanker(service: ReturnType<typeof createServiceClient>, userId: string, expenses: RankInput[]) {
  const dates = expenses.map((e) => e.date).filter((d): d is string => !!d).sort();
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
  return (expense: RankInput) => rank(expense, events, solicited);
}
