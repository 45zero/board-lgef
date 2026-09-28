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
  /** Animations vidéo (issues d'un .mov avec couche alpha, converti en WebM VP9 transparent). */
  animations?: Partial<Record<VideoOrientation, HabillageAnimation>>;
  /** Animation jouée une fois au début de la vidéo, ou en boucle. */
  animationMode?: "once" | "loop";
  /** Contexte d'usage (« R1 », « Coupe de France »…) proposé au moment de filmer. */
  context?: string;
  /** Mots-clés (séparés par des virgules) reconnus dans le titre de l'événement en cours. */
  keywords?: string;
  /** Pré-roll propre à ce gabarit (sa compétition) ; à défaut, le pré-roll général. */
  preroll?: Preroll | null;
};

/** Pré-roll : transition (volet, fond, logo) jouée au début de chaque vidéo publiée. */
export type Preroll = {
  animations: Partial<Record<VideoOrientation, HabillageAnimation>>;
  /** Instant (s) où la vidéo démarre sous le volet qui s'ouvre. */
  revealAt: number;
};

/** Titre libre posé sur la photo ou la vidéo : position (fraction de la largeur / hauteur), taille, couleur. */
export type FreeTitle = { text: string; x: number; y: number; size: number; color: string };
/** Cadrage de la photo : zoom (≥ 1) et décalage (-1 à 1) dans la marge disponible. */
export type PhotoCrop = { zoom: number; dx: number; dy: number };
export const DEFAULT_CROP: PhotoCrop = { zoom: 1, dx: 0, dy: 0 };

export type VideoOrientation = "vertical" | "horizontal";
export type HabillageAnimation = { url: string; preview: string; duration: number };

/** Dimensions attendues des animations (.mov avec couche alpha). */
export const HABILLAGE_VIDEO_SIZES: Record<VideoOrientation, { width: number; height: number; label: string }> = {
  vertical: { width: 1080, height: 1920, label: "Vertical 9:16 — 1080 × 1920 px (Reels, Stories, Shorts)" },
  horizontal: { width: 1920, height: 1080, label: "Horizontal 16:9 — 1920 × 1080 px (YouTube, Facebook)" },
};

export const orientationOf = (v: { width: number; height: number }): VideoOrientation => (v.height >= v.width ? "vertical" : "horizontal");

/** Animation d'un gabarit pour une vidéo de cette orientation (ou l'autre, à défaut). */
export function animationFor(settings: HabillageSettings, template: HabillageTemplate, orientation: VideoOrientation) {
  const custom = settings.custom.find((c) => `custom:${c.id}` === template);
  const anim = custom?.animations?.[orientation] ?? custom?.animations?.[orientation === "vertical" ? "horizontal" : "vertical"];
  return anim ? { ...anim, mode: custom?.animationMode ?? "once" } : null;
}

export type HabillageSettings = {
  /** Hauteur du logo LGEF, en px sur l'image finale (1080 px de large). */
  logoHeight: number;
  /** Taille maximale du texte (réduite automatiquement s'il est long), en px. */
  textMax: number;
  /** Ligne de signature sous le texte (vide : pas de signature). */
  signature: string;
  builtins: Record<Exclude<BuiltinTemplate, "aucun">, boolean>;
  custom: CustomHabillage[];
  preroll?: Preroll | null;
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

/**
 * Gabarits proposés à l'utilisateur, selon les réglages de l'administrateur. Avec un contexte
 * (« R1 »…) : ses gabarits d'abord, puis les gabarits génériques (sans contexte).
 */
export function availableTemplates(settings: HabillageSettings, context: string | null = null): { id: HabillageTemplate; label: string }[] {
  const custom = settings.custom
    .filter((c) => !context || !c.context || c.context === context)
    .sort((a, b) => Number(!!b.context && b.context === context) - Number(!!a.context && a.context === context));
  return [
    { id: "aucun", label: "Sans" },
    ...custom.map((c) => ({ id: `custom:${c.id}` as HabillageTemplate, label: c.name })),
    ...BUILTIN_TEMPLATES.filter((t) => settings.builtins[t.id]).map((t) => ({ id: t.id as HabillageTemplate, label: t.label })),
  ];
}

/** Contextes définis par l'administrateur (R1, Coupe de France…). */
export function contextsOf(settings: HabillageSettings): string[] {
  return [...new Set(settings.custom.map((c) => c.context?.trim()).filter((c): c is string => !!c))];
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Contexte reconnu dans le titre d'un événement (contexte lui-même ou mots-clés du gabarit). */
export function contextFromEventTitle(settings: HabillageSettings, title: string): string | null {
  const t = ` ${fold(title)} `;
  for (const c of settings.custom) {
    if (!c.context) continue;
    const words = [c.context, ...(c.keywords ?? "").split(",")].map((w) => fold(w.trim())).filter(Boolean);
    if (words.some((w) => new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`).test(t))) return c.context;
  }
  return null;
}

/**
 * Pré-roll d'une vidéo : uniquement celui de l'environnement choisi (pas de pré-roll général) ;
 * pour cette orientation, ou l'autre à défaut.
 */
export function prerollFor(settings: HabillageSettings, orientation: VideoOrientation, template?: HabillageTemplate) {
  const p = settings.custom.find((c) => `custom:${c.id}` === template)?.preroll;
  const anim = p?.animations?.[orientation] ?? p?.animations?.[orientation === "vertical" ? "horizontal" : "vertical"];
  return anim ? { ...anim, revealAt: Math.min(Math.max(p?.revealAt ?? anim.duration / 2, 0), anim.duration) } : null;
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

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
  crop: PhotoCrop = DEFAULT_CROP
) {
  const scale = Math.max(w / img.width, h / img.height) * Math.max(1, crop.zoom);
  const sw = w / scale;
  const sh = h / scale;
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  const sx = ((img.width - sw) / 2) * (1 - clamp(crop.dx));
  const sy = ((img.height - sh) / 2) * (1 - clamp(crop.dy));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
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

type RenderOptions = {
  template: HabillageTemplate;
  format: HabillageFormat;
  text: string;
  settings?: HabillageSettings;
  /** Calque vidéo : dimensions de la vidéo finale (1080 px de large). */
  overlaySize?: { width: number; height: number };
  /** Vidéo avec animation : le calque PNG du gabarit n'est pas figé par-dessus (l'animation le remplace). */
  skipOverlayImage?: boolean;
  /** Cadrage de la photo (zoom, position). */
  crop?: PhotoCrop;
  /** Titre libre, placé et dimensionné par l'utilisateur, dessiné par-dessus le gabarit. */
  title?: FreeTitle | null;
};

/**
 * Dessine l'habillage sur `canvas` (l'aperçu et l'export partagent le même rendu). Sans image
 * (`img` nul) et avec `overlaySize` : calque seul sur fond transparent, à incruster dans une vidéo.
 */
export async function renderHabillage(canvas: HTMLCanvasElement, img: (CanvasImageSource & { width: number; height: number }) | null, opts: RenderOptions) {
  await renderTemplate(canvas, img, opts);
  const t = opts.title;
  if (!t?.text.trim()) return;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  // Taille exprimée pour 1080 px de large ; texte centré sur (x, y), 90 % de la largeur au plus.
  const size = Math.round(t.size * (W / WIDTH));
  ctx.font = `800 ${size}px ${uiFont()}`;
  const lines = wrap(ctx, t.text.trim(), W * 0.9, 4);
  const lineH = size * 1.12;
  const top = t.y * H - ((lines.length - 1) * lineH) / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = size * 0.25;
  ctx.shadowOffsetY = size * 0.06;
  ctx.fillStyle = t.color;
  lines.forEach((l, i) => ctx.fillText(l, t.x * W, top + i * lineH));
  ctx.shadowColor = "transparent";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

async function renderTemplate(
  canvas: HTMLCanvasElement,
  img: (CanvasImageSource & { width: number; height: number }) | null,
  opts: RenderOptions
) {
  const settings = opts.settings ?? DEFAULT_HABILLAGE_SETTINGS;
  const { width: W, height: H } = opts.overlaySize ?? outputSize(opts.format, img?.width ?? WIDTH, img?.height ?? 1350);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  const photo = (x: number, y: number, w: number, h: number) => {
    if (img) drawCover(ctx, img, x, y, w, h, opts.crop);
  };
  const logo = await loadImage("/lgef-logo.png");
  const text = opts.text.trim();
  const logoH = settings.logoHeight;
  const tMax = settings.textMax;
  const tMin = Math.max(24, Math.round(tMax * 0.55));
  ctx.textBaseline = "alphabetic";

  if (opts.template.startsWith("custom:")) {
    const custom = settings.custom.find((c) => `custom:${c.id}` === opts.template);
    photo(0, 0, W, H);
    if (!custom) return;
    const key = opts.format === "carre" ? "carre" : "portrait";
    // Photo sans calque fixe : l'image clé de l'animation sert de calque.
    const src = opts.skipOverlayImage
      ? undefined
      : (custom.overlays[key] ?? custom.overlays.portrait ?? custom.overlays.carre ?? custom.animations?.vertical?.preview ?? custom.animations?.horizontal?.preview);
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
    photo(pad, pad, W - pad * 2, H - pad - strip);
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

  photo(0, 0, W, H);

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
