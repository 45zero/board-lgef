"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Video, Images, X, ChevronLeft, Loader2, CalendarDays, Search, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { uploadEventFiles, uploadStandaloneMedia } from "@/lib/board/eventFiles";
import { createPublication, listMediaPublications, type MediaPublication } from "@/lib/board/mediaPublications";
import {
  HABILLAGE_FORMATS,
  DEFAULT_CROP,
  animationFor,
  availableTemplates,
  contextFromEventTitle,
  contextsOf,
  orientationOf,
  prerollFor,
  type FreeTitle,
  type PhotoCrop,
  canvasToFile,
  loadBitmap,
  renderHabillage,
  withDefaults,
  type HabillageFormat,
  type HabillageSettings,
  type HabillageTemplate,
} from "@/lib/board/habillage";
import { getHabillageSettings } from "@/app/actions/board-settings";
import { searchEventsForExpense, type EventCandidate } from "@/app/actions/expense-scan";
import { Composer } from "@/components/board/screens/PublicationScreen";
import { createClient } from "@/lib/supabase/client";
import { createVideoWorkUploads, removeVideoWork } from "@/app/actions/video-habillage";

type Step = "capture" | "environnement" | "habillage" | "publier";

const chip = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${active ? "bg-navy text-white" : "bg-subtle text-ink-3"}`;
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const label = "mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-4";

// Depuis la galerie, certains téléphones transmettent une vidéo sans type (.mov iPhone, HEVC…) :
// on se fie aussi à l'extension.
const VIDEO_EXT = /\.(mov|mp4|m4v|3gp|3g2|webm|mkv|avi|hevc)$/i;
const isVideoFile = (f: File) => f.type.startsWith("video") || VIDEO_EXT.test(f.name);
/** Type annoncé au lecteur : un .mov (QuickTime) contient en général du H.264 lisible comme du MP4. */
const playableType = (f: File) => (!f.type || f.type === "video/quicktime" ? "video/mp4" : f.type);

/** Durée maximale d'une vidéo habillée (encodage sur le serveur, limité à 300 s). */
const VIDEO_HABILLAGE_MAX_SECONDS = 90;
/** Calque vidéo : 1080 px de large, à la proportion de la vidéo. */
const overlaySizeFor = (v: { width: number; height: number }) => ({ width: 1080, height: Math.round((1080 * v.height) / v.width / 2) * 2 });

/**
 * Bouton central « Publication réseaux » (mobile) : photo ou vidéo prise sur le moment, habillage
 * LGEF + texte (photos), légende et événement éventuel, puis le compositeur du centre de
 * publication pour choisir les réseaux et publier tout de suite.
 */
export function SocialCapture({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("capture");
  const [file, setFile] = useState<File | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [template, setTemplate] = useState<HabillageTemplate>("bandeau");
  // « Je suis sur… » (R1, Coupe de France…) : filtre les gabarits ; proposé d'après l'événement en cours.
  const [context, setContext] = useState<string | null>(null);
  const [title, setTitle] = useState<FreeTitle>({ text: "", x: 0.5, y: 0.2, size: 84, color: "#FFFFFF" });
  const [crop, setCrop] = useState<PhotoCrop>(DEFAULT_CROP);
  const [dragMode, setDragMode] = useState<"title" | "crop" | null>(null);
  const dragStart = useRef<{ x: number; y: number; crop: PhotoCrop } | null>(null);
  // Pincement à deux doigts sur l'aperçu : taille du titre.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; size: number } | null>(null);
  const [settings, setSettings] = useState<HabillageSettings>(() => withDefaults(null));
  const [format, setFormat] = useState<HabillageFormat>("portrait");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [event, setEvent] = useState<EventCandidate | null>(null);
  const [eventQuery, setEventQuery] = useState("");
  const [eventResults, setEventResults] = useState<EventCandidate[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composerFor, setComposerFor] = useState<MediaPublication | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const isVideo = !!file && isVideoFile(file);
  const [videoError, setVideoError] = useState(false);
  const [videoMeta, setVideoMeta] = useState<{ width: number; height: number; duration: number } | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // Vidéo : pas de « Cadre » (il redimensionne la photo), et pas d'habillage au-delà de 90 s ou
  // si le navigateur ne peut pas lire la vidéo (dimensions inconnues).
  const videoHabillage = isVideo && !videoError && !!videoMeta && videoMeta.duration <= VIDEO_HABILLAGE_MAX_SECONDS;
  const templates = availableTemplates(settings, context).filter((t) => !isVideo || t.id !== "cadre");
  const contexts = contextsOf(settings);
  const pre = videoMeta ? prerollFor(settings, orientationOf(videoMeta), template) : null;
  // Animation du gabarit (.mov alpha converti) pour l'orientation de la vidéo.
  const anim = videoMeta ? animationFor(settings, template, orientationOf(videoMeta)) : null;

  // Réglages des habillages (administrateur) : tailles, signature, gabarits actifs et personnalisés.
  useEffect(() => {
    getHabillageSettings()
      .then((s) => {
        const full = withDefaults(s);
        setSettings(full);
        const list = availableTemplates(full);
        setTemplate((cur) => (list.some((t) => t.id === cur) ? cur : (list[1]?.id ?? "aucun")));
        if (!contextsOf(full).length) return;
        searchEventsForExpense("", new Date().toISOString().slice(0, 10))
          .then((events) => {
            const now = Date.now();
            const current = events
              .filter((e) => Math.abs(new Date(e.start).getTime() - now) < 8 * 3_600_000)
              .sort((a, b) => Number(b.solicited) - Number(a.solicited));
            for (const e of current) {
              const found = contextFromEventTitle(full, e.title);
              if (!found) continue;
              setContext(found);
              const first = full.custom.find((x) => x.context === found);
              if (first) setTemplate(`custom:${first.id}`);
              return;
            }
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  /** Choisit un contexte et son premier gabarit dédié. */
  const chooseContext = (c: string | null) => {
    setContext(c);
    const first = settings.custom.find((x) => c && x.context === c);
    if (first) setTemplate(`custom:${first.id}`);
  };

  /** Doigt / souris sur l'aperçu : place le titre, ou fait glisser la photo (recadrage). */
  const drag = {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragMode) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2 && dragMode === "title") {
        const [a, b] = [...pointers.current.values()];
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), size: title.size };
        dragStart.current = null;
        return;
      }
      dragStart.current = { x: e.clientX, y: e.clientY, crop };
      drag.onPointerMove(e);
    },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const ratio = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(pinch.current.dist, 1);
        setTitle((t) => ({ ...t, size: Math.round(Math.min(220, Math.max(32, pinch.current!.size * ratio))) }));
        return;
      }
      if (!dragMode || !dragStart.current) return;
      const r = e.currentTarget.getBoundingClientRect();
      const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
      if (dragMode === "title") {
        setTitle((t) => ({ ...t, x: clamp((e.clientX - r.left) / r.width, 0.05, 0.95), y: clamp((e.clientY - r.top) / r.height, 0.04, 0.96) }));
      } else {
        const st = dragStart.current;
        setCrop({ ...st.crop, dx: clamp(st.crop.dx + ((e.clientX - st.x) / r.width) * 2, -1, 1), dy: clamp(st.crop.dy + ((e.clientY - st.y) / r.height) * 2, -1, 1) });
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      dragStart.current = null;
    },
    onPointerCancel: (e: React.PointerEvent<HTMLCanvasElement>) => drag.onPointerUp(e),
  };

  // Aperçu de l'habillage, redessiné à chaque changement.
  useEffect(() => {
    if (step !== "habillage" || !bitmap || !canvasRef.current) return;
    void renderHabillage(canvasRef.current, bitmap, { template, format, text, settings, crop, title });
  }, [step, bitmap, template, format, text, settings, crop, title]);

  // Aperçu du calque par-dessus la vidéo.
  useEffect(() => {
    if (step !== "habillage" || !videoHabillage || !videoMeta || !overlayRef.current) return;
    void renderHabillage(overlayRef.current, null, { template, format, text, settings, overlaySize: overlaySizeFor(videoMeta), skipOverlayImage: !!anim, title });
  }, [step, videoHabillage, videoMeta, template, format, text, settings, anim, title]);

  useEffect(
    () => () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
    [videoUrl]
  );

  // Événements autour d'aujourd'hui (et recherche) pour rattacher la publication.
  useEffect(() => {
    if (step !== "publier") return;
    const timer = window.setTimeout(() => {
      searchEventsForExpense(eventQuery, new Date().toISOString().slice(0, 10))
        .then(setEventResults)
        .catch(() => setEventResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [step, eventQuery]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setFile(f);
    if (isVideoFile(f)) {
      setBitmap(null);
      setVideoError(false);
      setVideoMeta(null);
      setTemplate((cur) => (cur === "cadre" ? "bandeau" : cur));
      setVideoUrl(URL.createObjectURL(f));
    } else {
      try {
        setBitmap(await loadBitmap(f));
      } catch {
        return setError("Photo illisible : réessayez.");
      }
    }
    // Environnements définis (R1, Coupe de France…) : on demande d'abord dans lequel on évolue.
    setStep(contexts.length ? "environnement" : "habillage");
  };

  /**
   * Habillage d'une vidéo : calque PNG transparent dessiné ici, vidéo + calque déposés dans le bucket
   * privé video-work, assemblage par FFmpeg sur le serveur, puis récupération de la vidéo habillée.
   */
  const habillerVideo = async (video: File, meta: { width: number; height: number }): Promise<File> => {
    const canvas = document.createElement("canvas");
    await renderHabillage(canvas, null, { template, format, text, settings, overlaySize: overlaySizeFor(meta), skipOverlayImage: !!anim, title });
    const overlay = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Calque impossible."))), "image/png"));

    setProgress("Envoi de la vidéo pour l'habillage…");
    const targets = await createVideoWorkUploads(video.name || "video.mp4");
    const storage = createClient().storage.from("video-work");
    const [up1, up2] = await Promise.all([
      storage.uploadToSignedUrl(targets.video.path, targets.video.token, video, { contentType: video.type || "video/mp4" }),
      storage.uploadToSignedUrl(targets.overlay.path, targets.overlay.token, overlay, { contentType: "image/png" }),
    ]);
    if (up1.error || up2.error) throw new Error("Envoi de la vidéo impossible.");

    setProgress("Habillage de la vidéo… (jusqu'à 2 à 3 minutes)");
    const res = await fetch("/api/media/video-habillage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoPath: targets.video.path,
        overlayPath: targets.overlay.path,
        animation: anim ? { url: anim.url, mode: anim.mode } : null,
        preroll: pre ? { url: pre.url, revealAt: pre.revealAt } : null,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; path?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? "Habillage de la vidéo impossible.");

    setProgress("Récupération de la vidéo habillée…");
    const blob = await (await fetch(body.url)).blob();
    if (body.path) void removeVideoWork(body.path).catch(() => undefined);
    return new File([blob], `publication-${Date.now()}.mp4`, { type: "video/mp4" });
  };

  const publish = async () => {
    if (!file || !user) return;
    setError(null);
    try {
      // Photo : on publie la version habillée ; vidéo : le fichier d'origine (typé d'après son
      // extension si le téléphone ne l'a pas fait, sinon les réseaux la refusent).
      let media = isVideo && !file.type ? new File([file], file.name, { type: /\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4" }) : file;
      if (!isVideo && bitmap) {
        const canvas = document.createElement("canvas");
        await renderHabillage(canvas, bitmap, { template, format, text, settings, crop, title });
        media = await canvasToFile(canvas, `publication-${Date.now()}.jpg`);
      }
      if (videoHabillage && videoMeta && (template !== "aucun" || !!title.text.trim() || !!pre)) media = await habillerVideo(media, videoMeta);
      setProgress("Envoi du média…");
      const onProgress = (sent: number, total: number) => setProgress(`Envoi du média… ${Math.round((sent / Math.max(total, 1)) * 100)} %`);
      let fileIds: string[] = [];
      let standalone: Awaited<ReturnType<typeof uploadStandaloneMedia>> = [];
      if (event) {
        const results = await uploadEventFiles(event.id, [media], onProgress);
        const failed = results.find((r) => !r.ok);
        if (failed) throw new Error(failed.error ?? "Échec de l'envoi du média.");
        fileIds = results.map((r) => r.id).filter((id): id is string => !!id);
      } else {
        standalone = await uploadStandaloneMedia([media], onProgress);
      }
      setProgress("Préparation de la publication…");
      const id = await createPublication(
        {
          eventId: event?.id ?? null,
          fileIds,
          media: standalone,
          title: event ? null : text.trim() || caption.trim().slice(0, 80) || `Publication du ${new Date().toLocaleDateString("fr-FR")}`,
          category: event ? null : "communication",
          caption: caption.trim() || text.trim(),
        },
        user.id
      );
      const pub = (await listMediaPublications("to_publish")).find((p) => p.id === id);
      if (!pub) throw new Error("Publication créée : retrouvez-la dans le centre de publication.");
      setProgress(null);
      setComposerFor(pub);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "Publication impossible.");
    }
  };

  // Dernière étape : le compositeur du centre de publication (réseaux, identifications, publier).
  if (composerFor) return <Composer pub={composerFor} onClose={onClose} onDone={onClose} />;

  const back = () => {
    if (step === "publier") setStep("habillage");
    else if (step === "habillage") setStep(contexts.length ? "environnement" : "capture");
    else if (step === "environnement") setStep("capture");
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-card">
      <div className="flex shrink-0 items-center gap-2 bg-navy px-3 pb-3 text-white" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <button onClick={back} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Retour">
          <ChevronLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">Publication réseaux</div>
          <div className="text-sm font-extrabold">
            {step === "capture"
              ? "Photo ou vidéo à publier"
              : step === "environnement"
                ? "Choix de l'environnement"
                : step === "habillage"
                  ? isVideo
                    ? "Aperçu de la vidéo"
                    : "Habillage et texte"
                  : "Légende et événement"}
          </div>
        </div>
        <button onClick={onClose} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Fermer">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {step === "capture" && (
          <div className="flex h-full flex-col justify-center gap-3">
            <button onClick={() => photoRef.current?.click()} className="flex items-center gap-3 rounded-panel bg-red p-4 text-left text-white shadow-btn-red">
              <Camera size={26} />
              <span>
                <span className="block text-base font-extrabold">Prendre une photo</span>
                <span className="block text-xs text-white/80">Habillage LGEF et texte ensuite</span>
              </span>
            </button>
            <button onClick={() => videoRef.current?.click()} className="flex items-center gap-3 rounded-panel bg-navy p-4 text-left text-white">
              <Video size={26} />
              <span>
                <span className="block text-base font-extrabold">Filmer une vidéo</span>
                <span className="block text-xs text-white/80">Reel Instagram, Facebook, YouTube</span>
              </span>
            </button>
            <button onClick={() => galleryRef.current?.click()} className="flex items-center gap-3 rounded-panel border border-line p-4 text-left">
              <Images size={24} className="text-ink-3" />
              <span>
                <span className="block text-sm font-bold text-ink">Choisir dans la galerie</span>
                <span className="block text-xs text-ink-4">Photo ou vidéo déjà prise</span>
              </span>
            </button>
            <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
            <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={pick} />
            <input ref={galleryRef} type="file" accept="image/*,video/*" hidden onChange={pick} />
          </div>
        )}

        {step === "environnement" && (
          <div className="space-y-3">
            <h2 className="text-base font-extrabold text-ink">Dans quel environnement voulez-vous évoluer&nbsp;?</h2>
            <p className="text-xs text-ink-3">L&rsquo;habillage de l&rsquo;environnement (pré-roll, bandeau, logo) s&rsquo;applique à votre {isVideo ? "vidéo" : "photo"}.</p>
            <div className="grid grid-cols-2 gap-2">
              {contexts.map((c) => {
                const t = settings.custom.find((x) => x.context === c);
                const thumb =
                  t?.overlays.portrait ??
                  t?.overlays.carre ??
                  t?.animations?.vertical?.preview ??
                  t?.preroll?.animations?.vertical?.preview ??
                  t?.animations?.horizontal?.preview ??
                  t?.preroll?.animations?.horizontal?.preview;
                return (
                  <button
                    key={c}
                    onClick={() => {
                      chooseContext(c);
                      setStep("habillage");
                    }}
                    className={`relative overflow-hidden rounded-panel border-2 text-left ${context === c ? "border-red" : "border-line"}`}
                  >
                    <div className="aspect-[4/5] w-full bg-navy">
                      {/* eslint-disable-next-line @next/next/no-img-element -- visuel de l'habillage (bucket public) */}
                      {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="px-2.5 py-2 text-sm font-extrabold text-ink">{c}</div>
                    {context === c && <span className="absolute left-2 top-2 rounded-full bg-red px-2 py-0.5 text-[10px] font-bold text-white">Suggéré</span>}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => {
                chooseContext(null);
                setStep("habillage");
              }}
              className="w-full rounded-panel border border-line px-4 py-3 text-left text-sm font-bold text-ink-2"
            >
              Général <span className="font-normal text-ink-4">— sans environnement particulier</span>
            </button>
          </div>
        )}

        {step === "habillage" && (
          <div className="space-y-3">
            {isVideo ? (
              <>
                {videoUrl && file && !videoError && (
                  <div
                    className="relative mx-auto max-h-[50vh] overflow-hidden rounded-panel bg-black"
                    style={videoMeta ? { aspectRatio: `${videoMeta.width} / ${videoMeta.height}` } : undefined}
                  >
                    {/* « #t=0.1 » : affiche la première image sur iPhone au lieu d'un cadre noir. */}
                    <video
                      key={videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      onError={() => setVideoError(true)}
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        if (v.videoWidth && v.videoHeight) setVideoMeta({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
                      }}
                      className="h-full max-h-[50vh] w-full object-contain"
                    >
                      <source src={`${videoUrl}#t=0.1`} type={playableType(file)} />
                    </video>
                    {/* Aperçu de l'animation : son image clé (Safari ne lit pas le VP9 transparent). */}
                    {videoHabillage && anim && (
                      // eslint-disable-next-line @next/next/no-img-element -- image distante du bucket, superposée à la vidéo
                      <img src={anim.preview} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
                    )}
                    {videoHabillage && (
                      <canvas
                        ref={overlayRef}
                        {...drag}
                        className={`absolute inset-0 h-full w-full ${dragMode === "title" ? "cursor-move touch-none" : "pointer-events-none"}`}
                      />
                    )}
                  </div>
                )}
                {videoError && (
                  <div className="rounded-panel bg-subtle p-4 text-sm text-ink-2">
                    <div className="font-bold">Aperçu indisponible sur ce navigateur</div>
                    <div className="mt-1 text-xs text-ink-3">
                      {file?.name} · {file ? `${(file.size / 1_048_576).toFixed(1)} Mo` : ""} — la vidéo sera tout de même envoyée et publiée telle quelle.
                    </div>
                  </div>
                )}
                {videoHabillage ? (
                  <div>
                {contexts.length > 0 && (
                  <div className="mb-3 flex items-center gap-2 text-xs text-ink-3">
                    Environnement : <strong className="text-ink">{context ?? "Général"}</strong>
                    <button onClick={() => setStep("environnement")} className="font-semibold text-link hover:underline">
                      Changer
                    </button>
                  </div>
                )}
                    <div className={label}>Habillage</div>
                    <div className="flex flex-wrap gap-1.5">
                      {templates.map((t) => (
                        <button key={t.id} onClick={() => setTemplate(t.id)} className={chip(template === t.id)}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-ink-4">
                      {anim
                        ? `Habillage animé (${anim.mode === "loop" ? "en boucle" : `${anim.duration} s au début`}) : l'aperçu montre une image clé.`
                        : "L'habillage est incrusté dans la vidéo au moment de publier."}{" "}
                      {pre ? `Pré-roll ajouté au début (${pre.duration} s). ` : ""}Traitement : 1 à 3 minutes.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-ink-4">
                    {videoMeta && videoMeta.duration > VIDEO_HABILLAGE_MAX_SECONDS
                      ? `Vidéo de plus de ${VIDEO_HABILLAGE_MAX_SECONDS} s : elle sera publiée sans habillage, votre texte devient la légende.`
                      : "Habillage indisponible pour cette vidéo : votre texte devient la légende de la publication."}
                  </p>
                )}
              </>
            ) : (
              <>
                <canvas ref={canvasRef} {...drag} className={`w-full rounded-panel bg-subtle shadow-card ${dragMode ? "cursor-move touch-none" : ""}`} />
                <div>
                {contexts.length > 0 && (
                  <div className="mb-3 flex items-center gap-2 text-xs text-ink-3">
                    Environnement : <strong className="text-ink">{context ?? "Général"}</strong>
                    <button onClick={() => setStep("environnement")} className="font-semibold text-link hover:underline">
                      Changer
                    </button>
                  </div>
                )}
                  <div className={label}>Habillage</div>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((t) => (
                      <button key={t.id} onClick={() => setTemplate(t.id)} className={chip(template === t.id)}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className={label}>Format</div>
                  <div className="flex flex-wrap gap-1.5">
                    {HABILLAGE_FORMATS.map((f) => (
                      <button key={f.id} onClick={() => setFormat(f.id)} className={chip(format === f.id)}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder={isVideo && !videoHabillage ? "Texte de la publication" : "Texte de l'habillage (ex. « Rentrée de l'arbitrage 2026 »)"}
              className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-link"
            />
            {(isVideo ? videoHabillage : true) && (
              <div className="space-y-3 rounded-panel border border-line p-3">
                <div>
                  <div className={label}>Titre (déplaçable)</div>
                  <input
                    value={title.text}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Premier caractère : on passe en mode « placer » — touchez l'aperçu pour poser le titre.
                      if (!title.text.trim() && v.trim()) setDragMode("title");
                      setTitle((t) => ({ ...t, text: v }));
                    }}
                    placeholder="Ex. « Victoire 2-1 ! »"
                    className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-link"
                  />
                </div>
                {title.text.trim() && (
                  <>
                    <div className="flex items-center gap-2 text-xs text-ink-3">
                      <span className="w-12 shrink-0">Taille</span>
                      <input type="range" min={32} max={220} step={2} value={title.size} onChange={(e) => setTitle((t) => ({ ...t, size: Number(e.target.value) }))} className="flex-1" />
                    </div>
                    <div className="flex items-center gap-2">
                      {["#FFFFFF", "#E1141B", "#0B1D3C", "#FFD400", "#000000"].map((c) => (
                        <button
                          key={c}
                          onClick={() => setTitle((t) => ({ ...t, color: c }))}
                          aria-label={`Couleur ${c}`}
                          className={`h-7 w-7 rounded-full border-2 ${title.color === c ? "border-link" : "border-line"}`}
                          style={{ background: c }}
                        />
                      ))}
                      <button onClick={() => setDragMode((m) => (m === "title" ? null : "title"))} className={`ml-auto ${chip(dragMode === "title")}`}>
                        {dragMode === "title" ? "Terminer" : "Placer le titre"}
                      </button>
                    </div>
                  </>
                )}
                {!isVideo && (
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    <span className="w-12 shrink-0">Zoom</span>
                    <input type="range" min={1} max={3} step={0.05} value={crop.zoom} onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))} className="flex-1" />
                    <button onClick={() => setDragMode((m) => (m === "crop" ? null : "crop"))} className={chip(dragMode === "crop")}>
                      {dragMode === "crop" ? "Terminer" : "Recadrer"}
                    </button>
                  </div>
                )}
                {dragMode && (
                  <p className="text-[11px] text-link">
                    {dragMode === "title"
                      ? "Touchez ou faites glisser l'aperçu pour placer le titre ; pincez à deux doigts pour changer sa taille."
                      : "Faites glisser l'aperçu pour déplacer la photo."}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {step === "publier" && (
          <div className="space-y-4">
            <div>
              <div className={label}>Légende</div>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={4}
                placeholder="Texte publié avec le média (hashtags, mentions…)"
                className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-link"
              />
            </div>
            <div>
              <div className={label}>Événement (facultatif)</div>
              {event ? (
                <div className="flex items-center gap-2 rounded-btn bg-sel-bg px-3 py-2 text-sm font-semibold text-link">
                  <CalendarDays size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {event.title} · {fmtDay(event.start)}
                  </span>
                  <button onClick={() => setEvent(null)} className="text-ink-4" aria-label="Retirer l'événement">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-1.5 flex items-center gap-2 rounded-btn border border-line px-2.5 py-1.5">
                    <Search size={13} className="text-ink-4" />
                    <input
                      value={eventQuery}
                      onChange={(e) => setEventQuery(e.target.value)}
                      placeholder="Rechercher un événement…"
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-btn border border-line">
                    {eventResults === null && <p className="p-3 text-xs text-ink-4">Recherche…</p>}
                    {eventResults?.length === 0 && <p className="p-3 text-xs text-ink-4">Aucun événement : la publication sera « directe ».</p>}
                    {eventResults?.map((e) => (
                      <button key={e.id} onClick={() => setEvent(e)} className="block w-full border-b border-line px-3 py-2 text-left last:border-b-0">
                        <span className="block truncate text-sm font-semibold text-ink">{e.title}</span>
                        <span className="block truncate text-[11px] text-ink-4">
                          {fmtDay(e.start)}
                          {e.location ? ` · ${e.location}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {error && <p className="mt-3 rounded-btn bg-bad-bg px-3 py-2 text-xs text-bad">{error}</p>}
      </div>

      {step !== "capture" && (
        <div className="flex shrink-0 gap-2 border-t border-line p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button onClick={back} disabled={!!progress} className="rounded-btn border border-line px-4 py-3 text-sm font-bold text-ink-2 disabled:opacity-50">
            Retour
          </button>
          {step === "habillage" ? (
            <button
              onClick={() => {
                if (!caption) setCaption(text);
                setStep("publier");
              }}
              className="flex-1 rounded-btn bg-navy py-3 text-sm font-extrabold text-white"
            >
              Continuer
            </button>
          ) : (
            <button
              onClick={publish}
              disabled={!!progress}
              className="flex flex-1 items-center justify-center gap-2 rounded-btn bg-red py-3 text-sm font-extrabold text-white shadow-btn-red disabled:opacity-60"
            >
              {progress ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
              {progress ?? "Choisir les réseaux et publier"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
