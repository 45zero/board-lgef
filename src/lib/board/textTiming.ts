// Placement des calques et minutage des textes des habillages vidéo. Module sans directive : partagé
// par l'aperçu (navigateur) et l'assemblage FFmpeg (/api/media/video-habillage), qui doivent
// produire exactement le même mouvement.

/** Placement d'un calque ou d'une animation : centre (fraction de la largeur / hauteur) et échelle (1 = plein cadre). */
export type LayerPlacement = { x: number; y: number; scale: number };
export const DEFAULT_PLACEMENT: LayerPlacement = { x: 0.5, y: 0.5, scale: 1 };

/** Animation d'entrée ou de sortie d'un texte : coupe franche, fondu, ou glissement (avec fondu) depuis / vers un bord. */
export type TextMotion = "aucune" | "fondu" | "bas" | "haut" | "gauche" | "droite";
export const TEXT_MOTIONS: { id: TextMotion; label: string }[] = [
  { id: "aucune", label: "Sans" },
  { id: "fondu", label: "Fondu" },
  { id: "bas", label: "Bas" },
  { id: "haut", label: "Haut" },
  { id: "gauche", label: "Gauche" },
  { id: "droite", label: "Droite" },
];

/**
 * Apparition d'un texte dans une vidéo, en secondes depuis le début de la vidéo (pré-roll exclu) :
 * entrée à `start`, sortie à `end` (nul : jusqu'à la fin), chacune animée sur sa durée.
 */
export type TextTiming = { start: number; end: number | null; in: TextMotion; inDuration: number; out: TextMotion; outDuration: number };
export const DEFAULT_TIMING: TextTiming = { start: 0, end: null, in: "aucune", inDuration: 0.6, out: "aucune", outDuration: 0.6 };

/** Amplitude des glissements : part de la largeur (gauche / droite) ou de la hauteur (haut / bas). */
export const SLIDE_DISTANCE = 0.12;
const MOTION_DIR: Record<TextMotion, [number, number]> = { aucune: [0, 0], fondu: [0, 0], bas: [0, 1], haut: [0, -1], gauche: [-1, 0], droite: [1, 0] };
export const motionDirection = (m: TextMotion) => MOTION_DIR[m];

/**
 * État d'un texte à l'instant `t` : opacité (0 à 1) et décalage (fraction de la largeur / hauteur).
 * Même calcul que les expressions FFmpeg de /api/media/video-habillage (fondu linéaire, glissement
 * en sortie de courbe cubique).
 */
export function textStateAt(timing: TextTiming | null | undefined, t: number) {
  const tm = timing ?? DEFAULT_TIMING;
  const end = tm.end ?? Infinity;
  if (t < tm.start || t > end) return { opacity: 0, dx: 0, dy: 0 };
  let opacity = 1;
  let dx = 0;
  let dy = 0;
  if (tm.in !== "aucune" && tm.inDuration > 0) {
    const p = Math.min(1, (t - tm.start) / Math.min(tm.inDuration, end - tm.start));
    opacity = Math.min(opacity, p);
    const [ix, iy] = MOTION_DIR[tm.in];
    dx += ix * SLIDE_DISTANCE * (1 - p) ** 3;
    dy += iy * SLIDE_DISTANCE * (1 - p) ** 3;
  }
  if (tm.end !== null && tm.out !== "aucune" && tm.outDuration > 0) {
    const d = Math.min(tm.outDuration, end - tm.start);
    const q = Math.min(1, Math.max(0, (t - (end - d)) / d));
    opacity = Math.min(opacity, 1 - q);
    const [ox, oy] = MOTION_DIR[tm.out];
    dx += ox * SLIDE_DISTANCE * q ** 3;
    dy += oy * SLIDE_DISTANCE * q ** 3;
  }
  return { opacity, dx, dy };
}

/** Le minutage change-t-il quelque chose (sinon le texte reste figé dans le calque) ? */
export const isTimed = (t: TextTiming | null | undefined) => !!t && (t.start > 0 || t.end !== null || t.in !== "aucune");

/** Nombre borné (entrée réseau) : NaN → `fallback`. */
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const MOTIONS = new Set<TextMotion>(["aucune", "fondu", "bas", "haut", "gauche", "droite"]);

/** Minutage reçu du téléphone, nettoyé (valeurs bornées, animations connues). */
export function sanitizeTiming(raw: unknown): TextTiming {
  const r = (raw ?? {}) as Partial<Record<keyof TextTiming, unknown>>;
  const start = num(r.start, 0, 600, 0);
  const end = r.end === null || r.end === undefined ? null : Math.max(start + 0.1, num(r.end, 0, 600, start + 0.1));
  const motion = (m: unknown): TextMotion => (MOTIONS.has(m as TextMotion) ? (m as TextMotion) : "aucune");
  return { start, end, in: motion(r.in), inDuration: num(r.inDuration, 0, 10, 0.6), out: motion(r.out), outDuration: num(r.outDuration, 0, 10, 0.6) };
}

/** Placement reçu du téléphone, nettoyé. */
export function sanitizePlacement(raw: unknown): LayerPlacement {
  const r = (raw ?? {}) as Partial<Record<keyof LayerPlacement, unknown>>;
  return { x: num(r.x, -1, 2, 0.5), y: num(r.y, -1, 2, 0.5), scale: num(r.scale, 0.05, 4, 1) };
}

const f = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Filtres FFmpeg d'une couche de texte minutée (image plein cadre transparente), décalée de `offset` s
 * (pré-roll) : `fade` à appliquer à la couche (alpha), `x` / `y` / `enable` pour le filtre overlay.
 */
export function timedOverlayExprs(timing: TextTiming, offset: number) {
  const S = timing.start + offset;
  const E = timing.end === null ? null : timing.end + offset;
  const fades: string[] = [];
  const xs: string[] = [];
  const ys: string[] = [];
  if (timing.in !== "aucune" && timing.inDuration > 0) {
    const d = Math.min(timing.inDuration, E === null ? Infinity : E - S);
    fades.push(`fade=t=in:st=${f(S)}:d=${f(d)}:alpha=1`);
    const [ix, iy] = MOTION_DIR[timing.in];
    const ease = `pow(1-clip((t-${f(S)})/${f(d)},0,1),3)`;
    if (ix) xs.push(`${f(ix * SLIDE_DISTANCE)}*main_w*${ease}`);
    if (iy) ys.push(`${f(iy * SLIDE_DISTANCE)}*main_h*${ease}`);
  }
  if (E !== null && timing.out !== "aucune" && timing.outDuration > 0) {
    const d = Math.min(timing.outDuration, E - S);
    fades.push(`fade=t=out:st=${f(E - d)}:d=${f(d)}:alpha=1`);
    const [ox, oy] = MOTION_DIR[timing.out];
    const ease = `pow(clip((t-${f(E - d)})/${f(d)},0,1),3)`;
    if (ox) xs.push(`${f(ox * SLIDE_DISTANCE)}*main_w*${ease}`);
    if (oy) ys.push(`${f(oy * SLIDE_DISTANCE)}*main_h*${ease}`);
  }
  return {
    fade: fades.join(","),
    x: xs.length ? xs.join("+") : "0",
    y: ys.length ? ys.join("+") : "0",
    enable: E === null ? `gte(t,${f(S)})` : `between(t,${f(S)},${f(E)})`,
  };
}
