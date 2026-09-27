"use client";

// Habillage d'une photo avant publication : recadrage au format réseau, puis un gabarit — intégré
// (bandeau, cadre, titre) ou personnalisé par un administrateur (calque PNG transparent) — avec le
// texte saisi. Rendu dans un canvas, export JPEG 1080 px de large. Réglages : board_settings.habillage.

export type HabillageFormat = "portrait" | "carre" | "original";
export type BuiltinTemplate = "aucun" | "bandeau" | "cadre" | "titre";
/** Gabarit intégré, ou `custom:<id>` pour un gabarit personnalisé. */
export type HabillageTemplate = BuiltinTemplate | `custom:${string}`;

export type CustomHabillage = {
  id: string;
  name: string;
  /** URL publique du calque PNG par format (voir HABILLAGE_SIZES). */
  overlays: Partial<Record<"portrait" | "carre", string>>;
  textPosition: "top" | "bottom" | "none";
  textColor: string;
};

export type HabillageSettings = {
  /** Hauteur du logo LGEF, en px sur l'image finale (1080 px de large). */
  logoHeight: number;
  /** Taille maximale du texte (réduite automatiquement s'il est long), en px. */
  textMax: number;
  /** Ligne de signature sous le texte (vide : pas de signature). */
  signature: string;
  builtins: Record<Exclude<BuiltinTemplate, "aucun">, boolean>;
  custom: CustomHabillage[];
};

export const DEFAULT_HABILLAGE_SETTINGS: HabillageSettings = {
  logoHeight: 120,
  textMax: 68,
  signature: "Ligue Grand Est de Football",
  builtins: { bandeau: true, cadre: true, titre: true },
  custom: [],
};

export function withDefaults(s: Partial<HabillageSettings> | null | undefined): HabillageSettings {
  return {
    ...DEFAULT_HABILLAGE_SETTINGS,
    ...(s ?? {}),
    builtins: { ...DEFAULT_HABILLAGE_SETTINGS.builtins, ...(s?.builtins ?? {}) },
    custom: s?.custom ?? [],
  };
}

/** Dimensions de sortie, à respecter pour les calques des gabarits personnalisés. */
export const HABILLAGE_SIZES = {
  portrait: { width: 1080, height: 1350, label: "Portrait 4:5 — 1080 × 1350 px (recommandé Instagram / Facebook)" },
  carre: { width: 1080, height: 1080, label: "Carré 1:1 — 1080 × 1080 px" },
} as const;

export const BUILTIN_TEMPLATES: { id: Exclude<BuiltinTemplate, "aucun">; label: string; desc: string }[] = [
  { id: "bandeau", label: "Bandeau", desc: "Dégradé marine en bas, texte, logo et signature" },
  { id: "cadre", label: "Cadre", desc: "Bordure blanche, bande marine avec logo et texte" },
  { id: "titre", label: "Titre", desc: "Gros titre en capitales en haut, soulignement rouge" },
];

/** Gabarits proposés à l'utilisateur, selon les réglages de l'administrateur. */
export function availableTemplates(settings: HabillageSettings): { id: HabillageTemplate; label: string }[] {
  return [
    { id: "aucun", label: "Sans" },
    ...BUILTIN_TEMPLATES.filter((t) => settings.builtins[t.id]).map((t) => ({ id: t.id as HabillageTemplate, label: t.label })),
    ...settings.custom.map((c) => ({ id: `custom:${c.id}` as HabillageTemplate, label: c.name })),
  ];
}

export const HABILLAGE_FORMATS: { id: HabillageFormat; label: string }[] = [
  { id: "portrait", label: "4:5" },
  { id: "carre", label: "1:1" },
  { id: "original", label: "Original" },
];

const NAVY = "#0B1D3C";
const RED = "#E1141B";
const WIDTH = 1080;

const images = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(src: string) {
  if (!images.has(src)) {
    images.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous"; // calques du bucket public : le canvas reste exportable
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      })
    );
  }
  return images.get(src)!;
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
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `800 ${size}px ${uiFont()}`;
    if (wrap(ctx, text, maxWidth, 99).length <= maxLines) return { size, lines: wrap(ctx, text, maxWidth, 99) };
  }
  ctx.font = `800 ${min}px ${uiFont()}`;
  return { size: min, lines: wrap(ctx, text, maxWidth, maxLines) };
}

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

/** Logo LGEF à sa hauteur réglée, proportions d'origine respectées ; renvoie sa largeur. */
function drawLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, x: number, y: number, height: number) {
  if (!logo) return 0;
  const width = (logo.naturalWidth / logo.naturalHeight) * height;
  ctx.drawImage(logo, x, y, width, height);
  return width;
}

function signature(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  if (!text.trim()) return;
  ctx.fillStyle = RED;
  ctx.fillRect(x, y - 3, 60, 6);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `700 26px ${uiFont()}`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 76, y);
  ctx.textBaseline = "alphabetic";
}

/** Dessine l'habillage sur `canvas` (l'aperçu et l'export partagent le même rendu). */
export async function renderHabillage(
  canvas: HTMLCanvasElement,
  img: CanvasImageSource & { width: number; height: number },
  opts: { template: HabillageTemplate; format: HabillageFormat; text: string; settings?: HabillageSettings }
) {
  const settings = opts.settings ?? DEFAULT_HABILLAGE_SETTINGS;
  const { width: W, height: H } = outputSize(opts.format, img.width, img.height);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const logo = await loadImage("/lgef-logo.png");
  const text = opts.text.trim();
  const logoH = settings.logoHeight;
  const tMax = settings.textMax;
  const tMin = Math.max(24, Math.round(tMax * 0.55));
  ctx.textBaseline = "alphabetic";

  if (opts.template.startsWith("custom:")) {
    const custom = settings.custom.find((c) => `custom:${c.id}` === opts.template);
    drawCover(ctx, img, 0, 0, W, H);
    if (!custom) return;
    const key = opts.format === "carre" ? "carre" : "portrait";
    const src = custom.overlays[key] ?? custom.overlays.portrait ?? custom.overlays.carre;
    const overlay = src ? await loadImage(src) : null;
    if (overlay) drawCover(ctx, overlay, 0, 0, W, H);
    if (text && custom.textPosition !== "none") {
      const pad = 72;
      const { size, lines } = fitText(ctx, text, W - pad * 2, 3, tMax, tMin);
      ctx.fillStyle = custom.textColor || "#FFFFFF";
      const top = custom.textPosition === "top" ? pad + size : H - pad - (lines.length - 1) * size * 1.12;
      lines.forEach((l, i) => ctx.fillText(l, pad, top + i * size * 1.12));
    }
    return;
  }

  if (opts.template === "cadre") {
    const pad = 40;
    const strip = Math.max(logoH + 60, 170);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);
    drawCover(ctx, img, pad, pad, W - pad * 2, H - pad - strip);
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, H - strip, W, strip);
    const lw = drawLogo(ctx, logo, pad, H - strip + (strip - logoH) / 2, logoH);
    const left = pad + lw + 30;
    if (text) {
      const { size, lines } = fitText(ctx, text, W - left - pad, 2, Math.min(tMax, 56), Math.min(tMin, 30));
      ctx.fillStyle = "#FFFFFF";
      lines.forEach((l, i) => ctx.fillText(l, left, H - strip + 30 + size + i * size * 1.15));
    }
    signature(ctx, settings.signature, left, H - 34);
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
    const lw = logo ? (logo.naturalWidth / logo.naturalHeight) * logoH : 0;
    drawLogo(ctx, logo, W - pad - lw, H - pad - logoH, logoH);
    if (text) {
      const { size, lines } = fitText(ctx, text, W - pad * 2 - lw - 30, 3, tMax, tMin);
      ctx.fillStyle = "#FFFFFF";
      const top = H - pad - 56 - (lines.length - 1) * size * 1.12;
      lines.forEach((l, i) => ctx.fillText(l, pad, top + i * size * 1.12));
    }
    signature(ctx, settings.signature, pad, H - pad);
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
    const lw = logo ? (logo.naturalWidth / logo.naturalHeight) * logoH : 0;
    drawLogo(ctx, logo, W - pad - lw, pad, logoH);
    if (text) {
      const { size, lines } = fitText(ctx, text.toUpperCase(), W - pad * 2 - lw - 30, 3, Math.round(tMax * 1.15), tMin);
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
