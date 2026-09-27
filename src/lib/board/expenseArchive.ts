import "server-only";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getGoogleAccountById } from "@/lib/google/accounts";
import { uploadFile } from "@/lib/google/drive";
import { archiveSubFolder, eventArchiveFolder, monthArchiveFolder, type FolderCache } from "@/lib/google/archiveFolders";
import { CATEGORY_META, type ExpenseCategory } from "@/lib/board/expenseCategories";

// Copie des justificatifs de frais dans le Drive du board, rangés comme le reste des archives :
//   LGEF Drive / AAAA / MM - Mois / JJ - Événement / Frais / <date - personne - catégorie - fournisseur - montant>
//   LGEF Drive / AAAA / MM - Mois / Frais hors événement / …   (mois de la dépense)
// Au mieux : sans Drive connecté ou en cas d'erreur, le justificatif reste dans le stockage Supabase.

const FOLDER_NAME = "Frais";
const NO_EVENT_FOLDER_NAME = "Frais hors événement";

export type ReceiptToArchive = {
  userId: string;
  eventId: string | null;
  /** 'YYYY-MM-DD' */
  date: string | null;
  category: ExpenseCategory;
  merchant: string | null;
  amount: number;
  url: string;
  type: string | null;
};

const clean = (s: string) => s.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
const euros = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export async function archiveReceipts(receipts: ReceiptToArchive[]) {
  if (!receipts.length) return;
  const service = createServiceClient();
  const { data: settings } = await service.from("board_settings").select("drive_connected_account_id").eq("id", true).single();
  const account = settings?.drive_connected_account_id ? await getGoogleAccountById(settings.drive_connected_account_id) : null;
  if (!account) return;

  const cache: FolderCache = new Map();
  const userIds = [...new Set(receipts.map((r) => r.userId))];
  const eventIds = [...new Set(receipts.map((r) => r.eventId).filter((id): id is string => !!id))];
  const [{ data: people }, { data: events }] = await Promise.all([
    service.from("profiles").select("id, first_name, last_name, email").in("id", userIds),
    eventIds.length
      ? service.from("events").select("id, title, start_date").in("id", eventIds)
      : Promise.resolve({ data: [] as { id: string; title: string; start_date: string }[] }),
  ]);
  const personById = new Map((people ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—"]));
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));
  const marker = "/storage/v1/object/public/expense_scans/";

  // Un même fichier (feuille de frais à plusieurs lignes) n'est archivé qu'une fois par dossier.
  const archived = new Set<string>();
  for (const r of receipts) {
    try {
      const event = r.eventId ? eventById.get(r.eventId) : null;
      const key = `${r.eventId ?? r.date?.slice(0, 7)}|${r.url}`;
      if (archived.has(key)) continue;
      archived.add(key);

      const path = decodeURIComponent(r.url.split(marker)[1] ?? "");
      if (!path) continue;
      const { data: blob } = await service.storage.from("expense_scans").download(path);
      if (!blob) continue;

      const day = r.date ? new Date(`${r.date}T12:00:00`) : new Date();
      const parent = event
        ? await archiveSubFolder(account, await eventArchiveFolder(account, { title: event.title, start: new Date(event.start_date) }, cache), FOLDER_NAME, cache)
        : await archiveSubFolder(account, await monthArchiveFolder(account, day, cache), NO_EVENT_FOLDER_NAME, cache);

      const ext = path.split(".").pop() ?? "jpg";
      const person = personById.get(r.userId) ?? "—";
      const label = CATEGORY_META[r.category].label.replace(/ \(.*\)$/, "");
      const name = clean([format(day, "yyyy-MM-dd"), person, label, r.merchant ?? "", euros(r.amount)].filter(Boolean).join(" - "));
      await uploadFile(account, {
        name: `${name}.${ext}`,
        parentId: parent.id,
        mimeType: blob.type || r.type || "application/octet-stream",
        data: Buffer.from(await blob.arrayBuffer()),
        description: [
          `Justificatif de frais de ${person}`,
          event ? `Événement : ${event.title} (${format(new Date(event.start_date), "d MMMM yyyy", { locale: fr })})` : "Hors événement",
          `Dépense : ${label}${r.merchant ? ` · ${r.merchant}` : ""} · ${euros(r.amount)} · ${format(day, "d MMMM yyyy", { locale: fr })}`,
        ].join("\n"),
      });
    } catch (e) {
      console.error("[archiveReceipts]", e);
    }
  }
}
