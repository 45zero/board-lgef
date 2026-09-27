"use client";

// Habillage d'une photo avant publication : recadrage au format réseau, puis un des gabarits LGEF
// (bandeau, cadre, titre) avec le texte saisi. Rendu dans un canvas, export JPEG 1080 px de large.

export type HabillageTemplate = "aucun" | "bandeau" | "cadre" | "titre";
export type HabillageFormat = "portrait" | "carre" | "original";

export const HABILLAGE_TEMPLATES: { id: HabillageTemplate; label: string }[] = [
  { id: "aucun", label: "Sans" },
  { id: "bandeau", label: "Bandeau" },
  { id: "cadre", label: "Cadre" },
  { id: "titre", label: "Titre" },
];

export const HABILLAGE_FORMATS: { id: HabillageFormat; label: string }[] = [
  { id: "portrait", label: "4:5" },
  { id: "carre", label: "1:1" },
  { id: "original", label: "Original" },
];

const NAVY = "#0B1D3C";
const RED = "#E1141B";
const WIDTH = 1080;

let logoPromise: Promise<HTMLImageElement | null> | null = null;
function loadLogo() {
  logoPromise ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/lgef-logo.png";
  });
  return logoPromise;
}

/** Police de l'interface (Manrope chargée par Next, nom de famille généré). */
function uiFont() {
  return typeof document !== "undefined" ? getComputedStyle(document.body).fontFamily : "sans-serif";
}

export function loadBitmap(file: File) {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

function outputSize(format: HabillageFormat, w: number, h: number) {
  if (format === "portrait") return { width: WIDTH, height: 1350 };
  if (format === "carre") return { width: WIDTH, height: WIDTH };
  // Original, borné aux rapports acceptés par Instagram (1.91:1 à 4:5).
  const ratio = Math.min(Math.max(h / w, 1 / 1.91), 1.25);
  return { width: WIDTH, height: Math.round(WIDTH * ratio) };
}

/** Découpe le texte en lignes tenant dans `maxWidth`, au plus `maxLines` (points de suspension). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, "")}…`;
    return kept;
  }
  return lines;
}

/** Taille de police qui fait tenir le texte en `maxLines` lignes, entre `max` et `min`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number, max: number, min: number) {
  for (let size = max; size >= min; size -= 4) {
    ctx.font = `800 ${size}px ${uiFont()}`;
    const lines = wrap(ctx, text, maxWidth, 99);
    if (lines.length <= maxLines) return { size, lines };
  }
  ctx.font = `800 ${min}px ${uiFont()}`;
  return { size: min, lines: wrap(ctx, text, maxWidth, maxLines) };
}

function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function signature(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = RED;
  ctx.fillRect(x, y - 5, 60, 6);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `700 26px ${uiFont()}`;
  ctx.textBaseline = "middle";
  ctx.fillText("Ligue Grand Est de Football", x + 76, y - 2);
  ctx.textBaseline = "alphabetic";
}

/** Dessine l'habillage sur `canvas` (l'aperçu et l'export partagent le même rendu). */
export async function renderHabillage(
  canvas: HTMLCanvasElement,
  img: ImageBitmap,
  opts: { template: HabillageTemplate; format: HabillageFormat; text: string }
) {
  const { width: W, height: H } = outputSize(opts.format, img.width, img.height);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const logo = await loadLogo();
  const text = opts.text.trim();
  ctx.textBaseline = "alphabetic";

  if (opts.template === "cadre") {
    const pad = 40;
    const strip = 190;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);
    drawCover(ctx, img, pad, pad, W - pad * 2, H - pad - strip);
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, H - strip, W, strip);
    if (logo) ctx.drawImage(logo, pad, H - strip + 35, 120, 120);
    const left = pad + 150;
    if (text) {
      const { size, lines } = fitText(ctx, text, W - left - pad, 2, 50, 30);
      ctx.fillStyle = "#FFFFFF";
      lines.forEach((l, i) => ctx.fillText(l, left, H - strip + 70 + i * size * 1.15));
    }
    signature(ctx, left, H - 38);
    return;
  }

  drawCover(ctx, img, 0, 0, W, H);

  if (opts.template === "bandeau") {
    const band = Math.round(H * 0.42);
    const grad = ctx.createLinearGradient(0, H - band, 0, H);
    grad.addColorStop(0, "rgba(11,29,60,0)");
    grad.addColorStop(0.45, "rgba(11,29,60,0.78)");
    grad.addColorStop(1, "rgba(11,29,60,0.96)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - band, W, band);
    const pad = 64;
    if (logo) ctx.drawImage(logo, W - pad - 110, H - pad - 150, 110, 110);
    if (text) {
      const { size, lines } = fitText(ctx, text, W - pad * 2 - 130, 3, 72, 40);
      ctx.fillStyle = "#FFFFFF";
      const top = H - pad - 60 - (lines.length - 1) * size * 1.12;
      lines.forEach((l, i) => ctx.fillText(l, pad, top + i * size * 1.12));
    }
    signature(ctx, pad, H - pad + 6);
    return;
  }

  if (opts.template === "titre") {
    const band = Math.round(H * 0.4);
    const grad = ctx.createLinearGradient(0, 0, 0, band);
    grad.addColorStop(0, "rgba(6,14,28,0.92)");
    grad.addColorStop(1, "rgba(6,14,28,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, band);
    const pad = 64;
    if (logo) ctx.drawImage(logo, W - pad - 100, pad, 100, 100);
    if (text) {
      const { size, lines } = fitText(ctx, text.toUpperCase(), W - pad * 2 - 120, 3, 84, 44);
      ctx.fillStyle = "#FFFFFF";
      lines.forEach((l, i) => ctx.fillText(l, pad, pad + size + i * size * 1.08));
      ctx.fillStyle = RED;
      ctx.fillRect(pad, pad + size + (lines.length - 1) * size * 1.08 + 30, 120, 10);
    }
  }
  // « aucun » : la photo recadrée seule.
}

/** Exporte le canvas en fichier JPEG prêt à publier. */
export function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], name, { type: "image/jpeg" })) : reject(new Error("Export de l'image impossible."))),
      "image/jpeg",
      0.92
    )
  );
}
