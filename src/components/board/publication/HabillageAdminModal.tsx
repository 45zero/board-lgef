"use client";

import { useEffect, useRef, useState } from "react";
import { X, Upload, Trash2, Plus, ImageIcon, Loader2, Play, Square, Move, RotateCcw } from "lucide-react";
import { TextTimingEditor } from "@/components/board/publication/TextTimingEditor";
import { createClient } from "@/lib/supabase/client";
import {
  createHabillageAnimationUpload,
  createHabillageOverlayUpload,
  getHabillageSettings,
  saveHabillageSettings,
} from "@/app/actions/board-settings";
import {
  BUILTIN_TEMPLATES,
  HABILLAGE_FORMATS,
  HABILLAGE_SIZES,
  HABILLAGE_VIDEO_SIZES,
  DEFAULT_PLACEMENT,
  animationFor,
  customOf,
  textStateAt,
  type LayerPlacement,
  type Preroll,
  type VideoOrientation,
  availableTemplates,
  loadBitmap,
  renderHabillage,
  withDefaults,
  type CustomHabillage,
  type HabillageFormat,
  type HabillageSettings,
  type HabillageTemplate,
} from "@/lib/board/habillage";

const label = "mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4";
const input = "rounded-btn border border-line bg-card px-2.5 py-1.5 text-sm outline-none focus:border-link";
const chip = (active: boolean) => `shrink-0 rounded-full px-3 py-1 text-xs font-bold ${active ? "bg-navy text-white" : "bg-subtle text-ink-3"}`;

/** Aperçu : formats photo, ou cadre d'une vidéo verticale / horizontale (animation, textes minutés). */
type PreviewMode = HabillageFormat | VideoOrientation;
const PREVIEW_MODES: { id: PreviewMode; label: string }[] = [
  ...HABILLAGE_FORMATS.map((f) => ({ id: f.id as PreviewMode, label: f.label })),
  { id: "vertical", label: "Vidéo 9:16" },
  { id: "horizontal", label: "Vidéo 16:9" },
];
/** Cadre de l'aperçu vidéo (1080 px de large, comme le calque incrusté). */
const VIDEO_FRAME: Record<VideoOrientation, { width: number; height: number }> = {
  vertical: { width: 1080, height: 1920 },
  horizontal: { width: 1080, height: 608 },
};

/** Photo d'exemple pour l'aperçu, tant qu'aucune photo de test n'est choisie. */
function samplePhoto(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 1500;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 1200, 1500);
  g.addColorStop(0, "#2F7A4D");
  g.addColorStop(1, "#14402A");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1200, 1500);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 8;
  ctx.strokeRect(80, 120, 1040, 1260);
  ctx.beginPath();
  ctx.arc(600, 750, 160, 0, Math.PI * 2);
  ctx.moveTo(80, 750);
  ctx.lineTo(1120, 750);
  ctx.stroke();
  return c;
}

/** Vérifie les dimensions d'un calque par rapport au format attendu. */
async function checkSize(file: File, format: "portrait" | "carre") {
  const bmp = await createImageBitmap(file);
  const want = HABILLAGE_SIZES[format];
  return { ok: bmp.width * want.height === bmp.height * want.width, got: `${bmp.width} × ${bmp.height} px` };
}

/**
 * Habillages des publications (administrateurs) : tailles du logo et du texte, signature,
 * gabarits intégrés proposés, gabarits personnalisés (calques PNG transparents), avec aperçu.
 */
export function HabillageAdminModal({
  onClose,
  focus,
  onSaved,
}: {
  onClose: () => void;
  /** « general » : réglages communs ; « new » : crée un environnement ; sinon l'id d'un environnement. */
  focus?: string;
  onSaved?: () => void;
}) {
  const [settings, setSettings] = useState<HabillageSettings | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(focus && focus !== "general" && focus !== "new" ? focus : null);
  const [template, setTemplate] = useState<HabillageTemplate>("bandeau");
  const [preview, setPreview] = useState<PreviewMode>("portrait");
  const videoMode = preview === "vertical" || preview === "horizontal" ? preview : null;
  const format: HabillageFormat = videoMode ? "portrait" : (preview as HabillageFormat);
  const setFormat = (f: HabillageFormat) => setPreview(f);
  // Lecture de l'apparition du texte (aperçu vidéo) et déplacement du calque au doigt.
  const [playing, setPlaying] = useState(false);
  const [moving, setMoving] = useState(false);
  const textCanvasRef = useRef<HTMLCanvasElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const moveStart = useRef<{ x: number; y: number; p: LayerPlacement } | null>(null);
  const [sampleText, setSampleText] = useState("Rentrée de l'arbitrage 2026");
  const [photo, setPhoto] = useState<(CanvasImageSource & { width: number; height: number }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    getHabillageSettings()
      .catch(() => null)
      .then((raw) => {
        const s = withDefaults(raw);
        if (focus === "new") {
          // Nouvel environnement (R1, Coupe de France…) : créé tout de suite, ouvert seul.
          const id = Math.random().toString(36).slice(2, 10);
          s.custom = [...s.custom, { id, name: "", context: "", overlays: {}, textPosition: "bottom", textColor: "#FFFFFF" }];
          setFocusedId(id);
          setTemplate(`custom:${id}`);
        } else if (focus && focus !== "general") {
          setTemplate(`custom:${focus}`);
        }
        setSettings(s);
      });
  }, [focus]);

  const tpl = settings ? customOf(settings, template) : null;
  const anim = settings && videoMode ? animationFor(settings, template, videoMode) : null;

  // Aperçu en deux couches : le gabarit (photo, calque ou animation placés) et, par-dessus, le texte
  // de l'habillage, que la lecture fait apparaître selon son minutage.
  useEffect(() => {
    if (!settings || !canvasRef.current || !textCanvasRef.current) return;
    const opts = {
      template,
      format,
      text: sampleText,
      settings,
      overlaySize: videoMode ? VIDEO_FRAME[videoMode] : undefined,
      skipOverlayImage: !!anim,
      animationPreview: anim ? (videoMode ?? undefined) : undefined,
    };
    const img = photo ?? samplePhoto();
    void renderHabillage(canvasRef.current, img, { ...opts, layer: "base" });
    void renderHabillage(textCanvasRef.current, img, { ...opts, layer: "text" });
  }, [settings, template, format, sampleText, photo, videoMode, anim]);

  // Lecture : boucle sur une durée qui couvre l'apparition et la disparition du texte.
  const timing = tpl?.textTiming;
  useEffect(() => {
    const el = textCanvasRef.current;
    if (!el) return;
    if (!playing) {
      el.style.opacity = "1";
      el.style.transform = "";
      return;
    }
    const total = Math.max(6, (timing?.end ?? timing?.start ?? 0) + 2);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = ((now - t0) / 1000) % total;
      const st = textStateAt(timing, t);
      el.style.opacity = String(st.opacity);
      el.style.transform = `translate(${st.dx * 100}%, ${st.dy * 100}%)`;
      if (clockRef.current) clockRef.current.textContent = `${t.toFixed(1)} s`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, timing]);

  if (!settings) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
        <Loader2 className="animate-spin text-white" />
      </div>
    );
  }

  const update = (p: Partial<HabillageSettings>) => setSettings((s) => (s ? { ...s, ...p } : s));
  const updateCustom = (id: string, p: Partial<CustomHabillage>) =>
    setSettings((s) => (s ? { ...s, custom: s.custom.map((c) => (c.id === id ? { ...c, ...p } : c)) } : s));

  // Élément placé dans l'aperçu : l'animation (aperçu vidéo, ou photo sans calque), sinon le calque PNG.
  const fixedOverlay = !!(tpl?.overlays.portrait || tpl?.overlays.carre);
  const usesAnim = videoMode ? !!anim : !fixedOverlay && !!(tpl?.animations?.vertical || tpl?.animations?.horizontal);
  const placeKey: "animationPlacement" | "overlayPlacement" | null = !tpl ? null : usesAnim ? "animationPlacement" : fixedOverlay ? "overlayPlacement" : null;
  const placement = (tpl && placeKey && tpl[placeKey]) || DEFAULT_PLACEMENT;
  const setPlacement = (p: LayerPlacement | undefined) => tpl && placeKey && updateCustom(tpl.id, { [placeKey]: p });
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const moveHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!moving) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      moveStart.current = { x: e.clientX, y: e.clientY, p: placement };
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const st = moveStart.current;
      if (!moving || !st) return;
      const r = e.currentTarget.getBoundingClientRect();
      setPlacement({ ...st.p, x: clamp(st.p.x + (e.clientX - st.x) / r.width, -0.5, 1.5), y: clamp(st.p.y + (e.clientY - st.y) / r.height, -0.5, 1.5) });
    },
    onPointerUp: () => (moveStart.current = null),
    onPointerCancel: () => (moveStart.current = null),
  };

  const showGeneral = !focus || focus === "general";
  const showCustom = focus !== "general";
  const visibleCustom = focusedId ? settings.custom.filter((c) => c.id === focusedId) : settings.custom;

  const addCustom = () => {
    const id = Math.random().toString(36).slice(2, 10);
    update({ custom: [...settings.custom, { id, name: "Nouvel habillage", overlays: {}, textPosition: "bottom", textColor: "#FFFFFF" }] });
    setTemplate(`custom:${id}`);
  };

  const uploadOverlay = async (c: CustomHabillage, fmt: "portrait" | "carre", file: File) => {
    setMessage(null);
    const size = await checkSize(file, fmt);
    if (!size.ok) {
      const want = HABILLAGE_SIZES[fmt];
      setMessage({ tone: "bad", text: `Le calque ${fmt === "portrait" ? "4:5" : "1:1"} fait ${size.got} : attendu ${want.width} × ${want.height} px.` });
      return;
    }
    setBusy(`${c.id}:${fmt}`);
    try {
      const target = await createHabillageOverlayUpload(file.name);
      const { error } = await createClient().storage.from("board-assets").uploadToSignedUrl(target.path, target.token, file, { contentType: "image/png" });
      if (error) throw new Error(error.message);
      updateCustom(c.id, { overlays: { ...c.overlays, [fmt]: target.publicUrl } });
      setFormat(fmt);
      setTemplate(`custom:${c.id}`);
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Envoi impossible." });
    } finally {
      setBusy(null);
    }
  };

  /** .mov (couche alpha) : dépôt, puis conversion en WebM transparent par le serveur. */
  const convertAnimation = async (orientation: VideoOrientation, file: File) => {
    const target = await createHabillageAnimationUpload(file.name);
    const { error } = await createClient()
      .storage.from("board-assets")
      .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || "video/quicktime" });
    if (error) throw new Error(error.message);
    setMessage({ tone: "ok", text: "Animation envoyée — conversion en cours (environ 1 minute par tranche de 10 s)…" });
    const res = await fetch("/api/media/habillage-animation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourcePath: target.path, orientation }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; preview?: string; duration?: number; error?: string };
    if (!res.ok || !body.url || !body.preview) throw new Error(body.error ?? "Conversion impossible.");
    return { url: body.url, preview: body.preview, duration: body.duration ?? 0 };
  };

  /** Pré-roll (volet) : une animation par orientation, générale ou propre à un gabarit (`customId`). */
  const uploadPreroll = async (orientation: VideoOrientation, file: File, customId?: string) => {
    setMessage(null);
    setBusy(`preroll:${customId ?? "general"}:${orientation}`);
    try {
      const anim = await convertAnimation(orientation, file);
      const merge = (prev: Preroll | null | undefined): Preroll => {
        const base = prev ?? { animations: {}, revealAt: Math.round((anim.duration / 2) * 10) / 10 };
        return { ...base, animations: { ...base.animations, [orientation]: anim } };
      };
      setSettings((st) => {
        if (!st) return st;
        if (!customId) return { ...st, preroll: merge(st.preroll) };
        return { ...st, custom: st.custom.map((x) => (x.id === customId ? { ...x, preroll: merge(x.preroll) } : x)) };
      });
      setMessage({ tone: "ok", text: "Pré-roll prêt. Réglez l'instant d'ouverture du volet, puis enregistrez." });
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Envoi impossible." });
    } finally {
      setBusy(null);
    }
  };

  const uploadAnimation = async (c: CustomHabillage, orientation: VideoOrientation, file: File) => {
    setMessage(null);
    setBusy(`${c.id}:anim:${orientation}`);
    try {
      const body = await convertAnimation(orientation, file);
      setSettings((st) =>
        st
          ? {
              ...st,
              custom: st.custom.map((x) =>
                x.id === c.id ? { ...x, animations: { ...(x.animations ?? {}), [orientation]: body } } : x
              ),
            }
          : st
      );
      setTemplate(`custom:${c.id}`);
      setMessage({ tone: "ok", text: "Animation prête. Pensez à enregistrer." });
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Envoi impossible." });
    } finally {
      setBusy(null);
    }
  };

  /** Emplacements du pré-roll (général ou d'un gabarit) et instant où la vidéo démarre. */
  const prerollSlots = (value: Preroll | null | undefined, onChange: (p: Preroll | null) => void, customId?: string) => (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["vertical", "horizontal"] as const).map((o) => {
          const a = value?.animations?.[o];
          const size = HABILLAGE_VIDEO_SIZES[o];
          const key = `preroll:${customId ?? "general"}:${o}`;
          return (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded-btn border border-dashed border-line bg-card px-2.5 py-2 text-xs hover:bg-hover">
              {busy === key ? (
                <Loader2 size={14} className="shrink-0 animate-spin" />
              ) : a ? (
                // eslint-disable-next-line @next/next/no-img-element -- image clé du pré-roll (bucket public)
                <img src={a.preview} alt="" className="h-9 w-9 shrink-0 rounded bg-subtle object-contain" />
              ) : (
                <Upload size={14} className="shrink-0 text-ink-4" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-ink-2">{o === "vertical" ? "Vertical 9:16" : "Horizontal 16:9"}</span>
                <span className="block text-ink-4">
                  {size.width} × {size.height} px · {busy === key ? "conversion…" : a ? `${a.duration} s — remplacer` : ".mov alpha"}
                </span>
              </span>
              <input
                type="file"
                accept=".mov,video/quicktime,.webm"
                hidden
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadPreroll(o, f, customId);
                }}
              />
            </label>
          );
        })}
      </div>
      {value && Object.keys(value.animations ?? {}).length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span>La vidéo démarre à</span>
          <input
            type="number"
            min={0}
            max={30}
            step={0.1}
            value={value.revealAt}
            onChange={(e) => onChange({ ...value, revealAt: Number(e.target.value) })}
            className={`${input} w-20`}
          />
          <span>s (ouverture du volet)</span>
          <button
            onClick={() => {
              if (confirm("Retirer ce pré-roll ?")) onChange(null);
            }}
            className="ml-auto text-xs font-semibold text-bad hover:underline"
          >
            Retirer
          </button>
        </div>
      )}
    </>
  );

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      await saveHabillageSettings(settings);
      onSaved?.();
      setMessage({ tone: "ok", text: "Habillages enregistrés : proposés à tous dès la prochaine publication." });
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Enregistrement impossible." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 md:p-4" onClick={onClose}>
      {/* Téléphone : plein écran ; ordinateur : fenêtre. */}
      <div
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-card shadow-modal md:h-auto md:max-h-[92vh] md:rounded-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-start justify-between bg-navy px-4 pb-3 text-white md:px-5 md:py-4"
          style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
        >
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Centre de publication · Administration</div>
            <h3 className="mt-1 text-base font-extrabold">
              {focus === "general"
                ? "Réglages généraux des habillages"
                : focusedId
                  ? `Habillage ${settings.custom.find((c) => c.id === focusedId)?.name || "— nouvel environnement"}`
                  : "Habillages des publications"}
            </h3>
            <div className="hidden text-xs text-white/80 md:block">Appliqués aux photos et vidéos publiées depuis le mobile (bouton central « Publication réseaux »).</div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain p-4 md:grid-cols-[1fr_380px] md:grid-rows-[auto_1fr] md:gap-5 md:p-5">
          {/* Aperçu : collé en haut de l'écran sur téléphone pendant qu'on règle en dessous. */}
          <div className="sticky -top-4 z-10 -mx-4 -mt-4 space-y-2 bg-card px-4 pb-2 pt-3 shadow-[0_8px_12px_-10px_rgba(0,0,0,0.35)] md:sticky md:top-0 md:col-start-2 md:row-start-1 md:m-0 md:self-start md:p-0 md:shadow-none">
            <div className={`${label} hidden md:block`}>Aperçu</div>
            <div
              {...moveHandlers}
              className={`relative mx-auto w-fit max-w-full overflow-hidden rounded-panel bg-subtle shadow-card ${moving ? "cursor-move touch-none outline outline-2 outline-red" : ""}`}
            >
              <canvas ref={canvasRef} className="block max-h-[28vh] w-auto max-w-full md:max-h-[55vh]" />
              <canvas ref={textCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
              {playing && (
                <span ref={clockRef} className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white" />
              )}
            </div>
            {(placeKey || (tpl && tpl.textPosition !== "none")) && (
              <div className="flex items-center gap-2 text-xs text-ink-3">
                {placeKey && (
                  <>
                    <span className="shrink-0 font-semibold">{placeKey === "animationPlacement" ? "Animation" : "Calque"}</span>
                    <input
                      type="range"
                      min={0.1}
                      max={2}
                      step={0.01}
                      value={placement.scale}
                      onChange={(e) => setPlacement({ ...placement, scale: Number(e.target.value) })}
                      aria-label="Taille"
                      className="min-w-0 flex-1"
                    />
                    <button onClick={() => setMoving((m) => !m)} className={`flex items-center gap-1 ${chip(moving)}`}>
                      <Move size={12} /> {moving ? "OK" : "Déplacer"}
                    </button>
                    {tpl?.[placeKey] && (
                      <button onClick={() => setPlacement(undefined)} className="rounded-full p-1 text-ink-4" title="Plein cadre" aria-label="Revenir au plein cadre">
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </>
                )}
                {tpl && tpl.textPosition !== "none" && (
                  <button onClick={() => setPlaying((p) => !p)} className={`flex items-center gap-1 ${chip(playing)} ${placeKey ? "" : "ml-auto"}`}>
                    {playing ? <Square size={11} /> : <Play size={11} />} Texte
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3 md:col-start-2 md:row-start-2 md:self-start">
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
              {availableTemplates(settings).map((t) => (
                <button key={t.id} onClick={() => setTemplate(t.id)} className={chip(template === t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
              {PREVIEW_MODES.map((f) => (
                <button key={f.id} onClick={() => setPreview(f.id)} className={chip(preview === f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input value={sampleText} onChange={(e) => setSampleText(e.target.value)} placeholder="Texte d'exemple" className={`${input} min-w-0 flex-1`} />
              <label className="shrink-0 cursor-pointer text-xs font-semibold text-link hover:underline">
                Photo test…
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) setPhoto(await loadBitmap(f));
                  }}
                />
              </label>
            </div>
          </div>

          <div className="space-y-5 md:col-start-1 md:row-span-2 md:row-start-1">
            <details className="rounded-panel border border-line bg-subtle/50 p-3 text-xs text-ink-2">
              <summary className={`${label} mb-0 cursor-pointer`}>Tailles des images</summary>
              <ul className="mt-1.5 space-y-0.5">
                <li>• {HABILLAGE_SIZES.portrait.label}</li>
                <li>• {HABILLAGE_SIZES.carre.label}</li>
                <li>• Original — 1080 px de large, 566 à 1350 px de haut (les calques personnalisés y sont recadrés)</li>
                <li>• Calques personnalisés : PNG à fond transparent, aux dimensions exactes ci-dessus ; la photo apparaît sous le calque.</li>
                <li>• Logo LGEF : 1014 × 1246 px d&rsquo;origine, proportions toujours conservées.</li>
                <li>• Animations vidéo : .mov avec couche alpha (ProRes 4444, Animation ou PNG — pas le « HEVC avec alpha »), 30 s au plus :</li>
                <li className="pl-3">– {HABILLAGE_VIDEO_SIZES.vertical.label}</li>
                <li className="pl-3">– {HABILLAGE_VIDEO_SIZES.horizontal.label}</li>
              </ul>
            </details>

            {showGeneral && (
            <>
            <section className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className={label}>Hauteur du logo — {settings.logoHeight} px</div>
                <input type="range" min={40} max={320} step={10} value={settings.logoHeight} onChange={(e) => update({ logoHeight: Number(e.target.value) })} className="w-full" />
              </div>
              <div>
                <div className={label}>Taille max. du texte — {settings.textMax} px</div>
                <input type="range" min={28} max={120} step={2} value={settings.textMax} onChange={(e) => update({ textMax: Number(e.target.value) })} className="w-full" />
                <div className="text-[11px] text-ink-4">Réduite automatiquement si le texte est long (3 lignes max.).</div>
              </div>
              <div className="sm:col-span-2">
                <div className={label}>Signature (bandeau et cadre)</div>
                <input value={settings.signature} onChange={(e) => update({ signature: e.target.value })} placeholder="Vide : pas de signature" className={`${input} w-full`} />
              </div>
            </section>

            <section>
              <div className={label}>Gabarits intégrés proposés</div>
              <div className="space-y-1.5">
                {BUILTIN_TEMPLATES.map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5 rounded-btn border border-line px-3 py-2">
                    <input
                      type="checkbox"
                      checked={settings.builtins[t.id]}
                      onChange={(e) => update({ builtins: { ...settings.builtins, [t.id]: e.target.checked } })}
                      aria-label={`Proposer ${t.label}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-ink">{t.label}</span>
                      <span className="block text-xs text-ink-4">{t.desc}</span>
                    </span>
                    <button onClick={() => setTemplate(t.id)} className="text-xs font-semibold text-link hover:underline">
                      Aperçu
                    </button>
                  </div>
                ))}
              </div>
            </section>
            </>
            )}

            {showCustom && (
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <div className={label}>{focusedId ? "Environnement" : "Gabarits personnalisés"}</div>
                {!focusedId && (
                  <button onClick={addCustom} className="flex items-center gap-1 text-xs font-semibold text-link hover:underline">
                    <Plus size={13} /> Ajouter
                  </button>
                )}
              </div>
              {visibleCustom.length === 0 && (
                <p className="rounded-btn border border-dashed border-line p-3 text-xs text-ink-4">
                  Aucun gabarit personnalisé. Créez un calque PNG transparent aux tailles indiquées (Canva, Photoshop…) puis ajoutez-le ici.
                </p>
              )}
              <div className="space-y-2">
                {visibleCustom.map((c) => (
                  <div key={c.id} className="space-y-2 rounded-panel border border-line p-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={c.name}
                        autoFocus={!c.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          // Le nom de l'environnement (« R1 ») sert aussi de contexte, sauf si on l'a changé.
                          updateCustom(c.id, { name: v, context: !c.context || c.context === c.name ? v : c.context });
                        }}
                        placeholder="Nom de l'environnement (ex. R1, Coupe de France)"
                        className={`${input} min-w-0 flex-1 font-bold`}
                      />
                      <button onClick={() => setTemplate(`custom:${c.id}`)} className="text-xs font-semibold text-link hover:underline">
                        Aperçu
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm(`Retirer l'habillage « ${c.name} » de la liste ?`)) return;
                          update({ custom: settings.custom.filter((x) => x.id !== c.id) });
                          setTemplate("bandeau");
                        }}
                        title="Retirer de la liste"
                        className="rounded-full p-1 text-ink-4 hover:bg-bad-bg hover:text-bad"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                      <input
                        value={c.context ?? ""}
                        onChange={(e) => updateCustom(c.id, { context: e.target.value })}
                        placeholder="Contexte (ex. R1)"
                        title="Proposé au moment de filmer : « Je suis sur… R1 »"
                        className={input}
                      />
                      <input
                        value={c.keywords ?? ""}
                        onChange={(e) => updateCustom(c.id, { keywords: e.target.value })}
                        placeholder="Mots-clés de l'événement (ex. Régional 1, R1)"
                        title="Reconnus dans le titre de l'événement en cours pour choisir ce contexte automatiquement"
                        className={input}
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(["portrait", "carre"] as const).map((fmt) => (
                        <label key={fmt} className="flex cursor-pointer items-center gap-2 rounded-btn border border-dashed border-line px-2.5 py-2 text-xs hover:bg-hover">
                          {busy === `${c.id}:${fmt}` ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : c.overlays[fmt] ? (
                            <ImageIcon size={14} className="text-good" />
                          ) : (
                            <Upload size={14} className="text-ink-4" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block font-bold text-ink-2">Calque {fmt === "portrait" ? "4:5" : "1:1"}</span>
                            <span className="block text-ink-4">
                              {HABILLAGE_SIZES[fmt].width} × {HABILLAGE_SIZES[fmt].height} px · {c.overlays[fmt] ? "déposé — remplacer" : "PNG transparent"}
                            </span>
                          </span>
                          <input
                            type="file"
                            accept="image/png"
                            hidden
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void uploadOverlay(c, fmt, f);
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="rounded-btn bg-subtle/60 p-2">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-ink-2">Animation vidéo (.mov avec couche alpha)</span>
                        <select
                          value={c.animationMode ?? "once"}
                          onChange={(e) => updateCustom(c.id, { animationMode: e.target.value as "once" | "loop" })}
                          className={input}
                        >
                          <option value="once">une fois au début</option>
                          <option value="loop">en boucle</option>
                        </select>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(["vertical", "horizontal"] as const).map((o) => {
                          const a = c.animations?.[o];
                          const size = HABILLAGE_VIDEO_SIZES[o];
                          return (
                            <label key={o} className="flex cursor-pointer items-center gap-2 rounded-btn border border-dashed border-line bg-card px-2.5 py-2 text-xs hover:bg-hover">
                              {busy === `${c.id}:anim:${o}` ? (
                                <Loader2 size={14} className="shrink-0 animate-spin" />
                              ) : a ? (
                                // eslint-disable-next-line @next/next/no-img-element -- image clé de l'animation (bucket public)
                                <img src={a.preview} alt="" className="h-9 w-9 shrink-0 rounded bg-subtle object-contain" />
                              ) : (
                                <Upload size={14} className="shrink-0 text-ink-4" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block font-bold text-ink-2">{o === "vertical" ? "Verticale 9:16" : "Horizontale 16:9"}</span>
                                <span className="block text-ink-4">
                                  {size.width} × {size.height} px · {busy === `${c.id}:anim:${o}` ? "conversion…" : a ? `${a.duration} s — remplacer` : ".mov alpha"}
                                </span>
                              </span>
                              <input
                                type="file"
                                accept=".mov,video/quicktime,.webm"
                                hidden
                                disabled={!!busy}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  e.target.value = "";
                                  if (f) void uploadAnimation(c, o, f);
                                }}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-btn bg-subtle/60 p-2">
                      <div className="text-xs font-bold text-ink-2">Pré-roll de cet environnement (volet avant la vidéo)</div>
                      <p className="mb-1.5 text-[11px] text-ink-4">
                        1 à 2 s en .mov avec couche alpha : l&rsquo;écran démarre couvert (fond, logo), puis le volet s&rsquo;ouvre et découvre la vidéo.
                      </p>
                      {prerollSlots(c.preroll, (p) => updateCustom(c.id, { preroll: p }), c.id)}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
                      <span>Texte :</span>
                      <select
                        value={c.textPosition}
                        onChange={(e) => updateCustom(c.id, { textPosition: e.target.value as CustomHabillage["textPosition"] })}
                        className={input}
                      >
                        <option value="bottom">en bas</option>
                        <option value="top">en haut</option>
                        <option value="none">aucun</option>
                      </select>
                      <label className="flex items-center gap-1.5">
                        couleur
                        <input type="color" value={c.textColor} onChange={(e) => updateCustom(c.id, { textColor: e.target.value })} className="h-7 w-10 rounded border border-line" />
                      </label>
                    </div>
                    {c.textPosition !== "none" && (
                      <div className="rounded-btn bg-subtle/60 p-2">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-ink-2">Apparition du texte dans les vidéos</span>
                          <button
                            onClick={() => {
                              setTemplate(`custom:${c.id}`);
                              if (!videoMode) setPreview("vertical");
                              setPlaying(true);
                            }}
                            className="flex items-center gap-1 text-xs font-semibold text-link hover:underline"
                          >
                            <Play size={11} /> Voir
                          </button>
                        </div>
                        <TextTimingEditor value={c.textTiming} onChange={(t) => updateCustom(c.id, { textTiming: t })} duration={10} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
            )}
          </div>

        </div>

        <div
          className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 pt-3 md:px-5 md:pb-3"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
        >
          <p className={`text-xs ${message?.tone === "bad" ? "text-bad" : "text-good"}`}>{message?.text}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm font-semibold text-ink-2">
              Fermer
            </button>
            <button onClick={save} disabled={busy === "save"} className="rounded-btn bg-red px-4 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-60">
              {busy === "save" ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
