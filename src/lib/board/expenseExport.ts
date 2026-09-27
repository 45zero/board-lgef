"use client";

import type { ExpenseExport, ExpenseExportLine } from "@/app/actions/expenses";
import { EXPENSE_STATUS_META } from "@/components/board/expenses/ExpenseStatus";
import { CATEGORY_META, EXPENSE_CATEGORIES, monthLabel } from "@/lib/board/expenseCategories";

// Fiche individuelle de frais d'un mois, reprise de l'appli calendrier : PDF (pdf-lib) avec
// signature manuscrite puis tous les justificatifs à la suite, ou Excel (exceljs). Les deux
// bibliothèques sont chargées à la demande.

const NAVY = { r: 0.07, g: 0.18, b: 0.35 };
const CATEGORY_COLUMNS = EXPENSE_CATEGORIES.map((c) => ({
  key: CATEGORY_META[c].column,
  label: c === "transport" ? "Transport" : c === "car_rental" ? "Location" : CATEGORY_META[c].label,
}));

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
const lineDate = (l: ExpenseExportLine) => l.expense_date ?? l.eventDate ?? l.created_at;
const lineLabel = (l: ExpenseExportLine) =>
  [l.eventTitle ?? "Hors événement", l.merchant_name || l.other_fees_description || l.description].filter(Boolean).join(" — ");
const amount = (l: ExpenseExportLine, key: string) => Number((l as unknown as Record<string, number | null>)[key] ?? 0);
const total = (lines: ExpenseExportLine[]) => lines.reduce((n, l) => n + Number(l.total_amount ?? 0), 0);
const euros = (n: number) => (n ? n.toFixed(2).replace(".", ",") : "");
const fileBase = (data: ExpenseExport) =>
  `Frais_${data.month}_${[data.person.lastName, data.person.firstName].filter(Boolean).join("_") || "LGEF"}`.replace(/[^\w-]+/g, "_");

function download(bytes: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function fetchBytes(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Image non JPEG/PNG (WebP, HEIC selon le navigateur…) → JPEG, via le canvas. */
async function toJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  if (!blob) throw new Error("Image illisible");
  return new Uint8Array(await blob.arrayBuffer());
}

const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50;

/** Les polices standard du PDF ne couvrent que le Latin-1 (+ quelques signes) : le reste est retiré. */
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF€’‘“”–—…•]/g, "").replace(/ {2,}/g, " ").trim();

export async function exportExpensesPdf(data: ExpenseExport, signaturePng: string) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const navy = rgb(NAVY.r, NAVY.g, NAVY.b);
  const grey = rgb(0.4, 0.4, 0.4);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Fiche individuelle de frais – ${monthLabel(data.month)}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [842, 595]; // A4 paysage
  const margin = 36;
  let page = pdf.addPage([W, H]);

  // Bandeau, logo, titre.
  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: navy });
  try {
    const logo = await pdf.embedPng(await fetchBytes("/lgef-logo.png"));
    const h = 56;
    page.drawImage(logo, { x: margin, y: H - 63, width: (logo.width * h) / logo.height, height: h });
  } catch {
    /* sans logo */
  }
  const title = safe(`FICHE INDIVIDUELLE DE FRAIS – ${monthLabel(data.month).toUpperCase()}`);
  page.drawText(title, { x: (W - bold.widthOfTextAtSize(title, 18)) / 2, y: H - 43, size: 18, font: bold, color: rgb(1, 1, 1) });

  // Identité.
  let y = H - 100;
  const p = data.person;
  const info: [string, string | null][] = [
    ["Nom", p.lastName],
    ["Prénom", p.firstName],
    ["Adresse", p.address],
    ["Véhicule", p.vehicle],
    ["Plaque", p.plate],
  ];
  for (const [label, value] of info) {
    page.drawText(`${label} :`, { x: margin, y, size: 11, font: bold });
    page.drawText(safe(value || "—"), { x: margin + 70, y, size: 11, font });
    y -= 17;
  }
  y -= 12;

  // Tableau.
  const headers = ["Date", "Événement / détail", ...CATEGORY_COLUMNS.map((c) => c.label), "KM", "Total", "Statut"];
  const units = [7, 26, 7, 7, 6, 6, 7, 6, 6, 6, 4, 7, 8];
  const usable = W - margin * 2;
  const widths = units.map((u) => (u / units.reduce((a, b) => a + b, 0)) * usable);
  const fit = (text: string, max: number, f: typeof font, size: number) => {
    let t = safe(text);
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    while (t && f.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
    return `${t}…`;
  };
  const drawRow = (cells: string[], f: typeof font, size: number) => {
    let x = margin;
    cells.forEach((c, i) => {
      const text = fit(c, widths[i] - 4, f, size);
      // Montants alignés à droite.
      const right = i >= 2 && i < cells.length - 1;
      page.drawText(text, { x: right ? x + widths[i] - 6 - f.widthOfTextAtSize(text, size) : x, y, size, font: f });
      x += widths[i];
    });
  };
  const drawHeader = () => {
    page.drawRectangle({ x: margin - 4, y: y - 5, width: usable + 8, height: 18, color: rgb(0.9, 0.93, 0.96) });
    drawRow(headers, bold, 8.5);
    y -= 20;
  };
  drawHeader();

  for (const l of data.lines) {
    if (y < 60) {
      page = pdf.addPage([W, H]);
      y = H - 50;
      drawHeader();
    }
    drawRow(
      [
        fmtDate(lineDate(l)),
        lineLabel(l),
        ...CATEGORY_COLUMNS.map((c) => euros(amount(l, c.key))),
        l.distance_km ? String(l.distance_km) : "",
        euros(Number(l.total_amount ?? 0)),
        EXPENSE_STATUS_META[l.status].label,
      ],
      font,
      8.5
    );
    y -= 6;
    page.drawLine({ start: { x: margin - 4, y }, end: { x: W - margin + 4, y }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });
    y -= 11;
  }

  // Total, date, signature.
  if (y < 150) {
    page = pdf.addPage([W, H]);
    y = H - 60;
  }
  y -= 10;
  const totalText = `TOTAL GÉNÉRAL : ${euros(total(data.lines)) || "0,00"} €`;
  page.drawText(totalText, { x: W - margin - bold.widthOfTextAtSize(totalText, 13), y, size: 13, font: bold, color: navy });
  page.drawText(`Document généré le ${new Date().toLocaleString("fr-FR")}`, { x: margin, y, size: 9, font, color: grey });
  y -= 40;
  page.drawText("Signature :", { x: margin, y, size: 11, font: bold });
  const sig = await pdf.embedPng(signaturePng);
  const sigW = Math.min(220, (sig.width * 70) / sig.height);
  page.drawImage(sig, { x: margin + 75, y: y - 50, width: sigW, height: (sig.height * sigW) / sig.width });
  page.drawLine({ start: { x: margin + 75, y: y - 52 }, end: { x: margin + 315, y: y - 52 }, thickness: 0.8, color: grey });

  // Justificatifs en annexe : une page par photo, les pages des PDF recopiées.
  let n = 0;
  for (const l of data.lines) {
    for (const a of l.attachments) {
      n += 1;
      const caption = `Justificatif ${n} — ${fmtDate(lineDate(l))} · ${lineLabel(l)} · ${euros(Number(l.total_amount ?? 0))} €`;
      try {
        const bytes = await fetchBytes(a.url);
        if (isPdf(bytes)) {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          for (const copied of await pdf.copyPages(src, src.getPageIndices())) pdf.addPage(copied);
          continue;
        }
        const image = isJpeg(bytes) ? await pdf.embedJpg(bytes) : isPng(bytes) ? await pdf.embedPng(bytes) : await pdf.embedJpg(await toJpeg(bytes));
        const [pw, ph] = [595, 842]; // A4 portrait
        const imgPage = pdf.addPage([pw, ph]);
        imgPage.drawText(fit(caption, pw - 60, font, 9), { x: 30, y: ph - 30, size: 9, font, color: grey });
        const scale = Math.min((pw - 60) / image.width, (ph - 80) / image.height);
        const [iw, ih] = [image.width * scale, image.height * scale];
        imgPage.drawImage(image, { x: (pw - iw) / 2, y: (ph - 50 - ih) / 2, width: iw, height: ih });
      } catch {
        // Fichier non intégrable (Excel, CSV…) : page de renvoi.
        const miss = pdf.addPage([595, 842]);
        miss.drawText(fit(caption, 535, font, 10), { x: 30, y: 800, size: 10, font });
        miss.drawText("Ce justificatif ne peut pas être intégré au PDF (format non image / non PDF).", { x: 30, y: 780, size: 10, font, color: grey });
      }
    }
  }

  download((await pdf.save()) as BlobPart, "application/pdf", `${fileBase(data)}.pdf`);
}

export async function exportExpensesXlsx(data: ExpenseExport) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Frais");
  const headers = ["Date", "Événement", "Détail", ...CATEGORY_COLUMNS.map((c) => `${c.label} (€)`), "KM", "Total (€)", "Statut", "Justificatifs"];
  const kmCol = 4 + CATEGORY_COLUMNS.length;
  const totalCol = kmCol + 1;
  const lastLetter = String.fromCharCode(64 + headers.length);

  ws.mergeCells(`A1:${lastLetter}1`);
  const head = ws.getCell("A1");
  head.value = `FICHE INDIVIDUELLE DE FRAIS – ${monthLabel(data.month).toUpperCase()}`;
  head.font = { size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  head.alignment = { vertical: "middle", horizontal: "center" };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF122E59" } };
  ws.getRow(1).height = 48;
  try {
    const bytes = await fetchBytes("/lgef-logo.png");
    const logo = wb.addImage({ buffer: bytes.buffer as ArrayBuffer, extension: "png" });
    ws.addImage(logo, { tl: { col: 0.15, row: 0.08 }, ext: { width: 48, height: 59 } });
  } catch {
    /* sans logo */
  }

  const p = data.person;
  ws.addRow([]);
  for (const [label, value] of [
    ["Nom", p.lastName],
    ["Prénom", p.firstName],
    ["Adresse", p.address],
    ["Véhicule", p.vehicle],
    ["Plaque", p.plate],
  ] as const) {
    ws.addRow([label, value ?? ""]).getCell(1).font = { bold: true };
  }
  ws.addRow([]);

  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6ECF5" } };
    cell.border = { bottom: { style: "thin" } };
  });

  const money = "#,##0.00";
  const firstData = headerRow.number + 1;
  for (const l of data.lines) {
    // Lien cliquable seulement vers une URL publique (les URL signées expirent).
    const link = l.attachments.find((a) => !a.url.includes("/object/sign/"));
    const count = l.attachments.length;
    const row = ws.addRow([
      new Date(lineDate(l)),
      l.eventTitle ?? "Hors événement",
      l.merchant_name || l.other_fees_description || l.description || "",
      ...CATEGORY_COLUMNS.map((c) => amount(l, c.key) || null),
      l.distance_km || null,
      Number(l.total_amount ?? 0),
      EXPENSE_STATUS_META[l.status].label,
      link ? { text: `${count} pièce${count > 1 ? "s" : ""}`, hyperlink: link.url } : count ? String(count) : "",
    ]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    for (let c = 4; c <= totalCol; c++) if (c !== kmCol) row.getCell(c).numFmt = money;
    if (link) row.getCell(headers.length).font = { color: { argb: "FF1D4ED8" }, underline: true };
  }
  const lastData = ws.lastRow!.number;

  // Totaux en formules : la fiche reste juste si elle est retouchée dans Excel.
  const totals = ws.addRow(["", "", "TOTAL"]);
  totals.font = { bold: true };
  for (let c = 4; c <= totalCol; c++) {
    const col = ws.getColumn(c).letter;
    totals.getCell(c).value = data.lines.length ? { formula: `SUM(${col}${firstData}:${col}${lastData})` } : 0;
    if (c !== kmCol) totals.getCell(c).numFmt = money;
    totals.getCell(c).border = { top: { style: "thin" } };
  }

  headers.forEach((_, i) => (ws.getColumn(i + 1).width = [12, 32, 28][i] ?? 12));
  ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  ws.getColumn(3).alignment = { wrapText: true, vertical: "top" };

  download(await wb.xlsx.writeBuffer(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${fileBase(data)}.xlsx`);
}
