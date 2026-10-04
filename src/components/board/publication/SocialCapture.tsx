"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Video, Images, X, ChevronLeft, ChevronRight, Loader2, CalendarDays, Search, Send, Plus, Trash2, Crop, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { uploadEventFiles, uploadStandaloneMedia } from "@/lib/board/eventFiles";
import { uploadResumableSigned } from "@/lib/board/resumableUpload";
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
  preparePhoto,
  renderPlain,
  renderHabillage,
  PHOTO_FILTERS,
  type PhotoFilter,
  withDefaults,
  type HabillageFormat,
  type HabillageSettings,
  type HabillageTemplate,
} from "@/lib/board/habillage";
import { getHabillageSettings } from "@/app/actions/board-settings";
import { searchEventsForExpense, type EventCandidate } from "@/app/actions/expense-scan";
import { Composer } from "@/components/board/screens/PublicationScreen";
import { InAppCamera, cameraSupported } from "@/components/board/publication/InAppCamera";
import { createClient } from "@/lib/supabase/client";
import { createVideoWorkUploads, removeVideoWork } from "@/app/actions/video-habillage";

type Step = "capture" | "environnement" | "habillage" | "publier";

/**
 * Un média de la série. `dress` : habillé LGEF (photos prises sur le moment) ou publié tel quel
 * (visuel partenaire déjà au format, image importée de la galerie).
 */
type Item = { id: string; file: File; url: string; video: boolean; dress: boolean; crop: PhotoCrop; filter: PhotoFilter };

/** Aperçu CSS du filtre sur les vignettes (le rendu publié est calculé par preparePhoto). */
const filterCss = (f: PhotoFilter) => PHOTO_FILTERS.find((x) => x.id === f)?.css ?? "none";

/** Médias par publication : limite des carrousels Instagram. */
const MAX_ITEMS = 10;

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
/** Taille maximale d'une vidéo à habiller (limite du bucket video-work). */
const VIDEO_HABILLAGE_MAX_BYTES = 500 * 1024 * 1024;
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
  // Série de médias (ordre de publication) et média affiché dans l'éditeur d'habillage.
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const item = items[active] ?? null;
  const file = item?.file ?? null;
  const videoUrl = item?.video ? item.url : null;
  const single = items.length === 1;
  // Le titre libre ne va que sur la première photo habillée (la couverture du carrousel).
  const coverIndex = items.findIndex((i) => !i.video && i.dress);
  const needsHabillage = coverIndex >= 0 || (single && items[0].video);
  const [template, setTemplate] = useState<HabillageTemplate>("bandeau");
  // « Je suis sur… » (R1, Coupe de France…) : filtre les gabarits ; proposé d'après l'événement en cours.
  const [context, setContext] = useState<string | null>(null);
  const [title, setTitle] = useState<FreeTitle>({ text: "", x: 0.5, y: 0.2, size: 84, color: "#FFFFFF" });
  const crop = item?.crop ?? DEFAULT_CROP;
  const setCrop = (u: PhotoCrop | ((c: PhotoCrop) => PhotoCrop)) =>
    setItems((list) => list.map((it, i) => (i === active ? { ...it, crop: typeof u === "function" ? u(it.crop) : u } : it)));
  const setFilter = (f: PhotoFilter) => setItems((list) => list.map((it, i) => (i === active ? { ...it, filter: f } : it)));
  // Visionneuse plein écran de la série (agrandir, faire défiler, filtre, recadrage, suppression).
  const [viewer, setViewer] = useState(false);
  // Caméra intégrée (photo instantanée, appui long = vidéo) ; repli sur l'appareil du téléphone si refusée.
  const [camera, setCamera] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const viewerRef = useRef<HTMLCanvasElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
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

  // Une seule photo décodée à la fois (celle affichée), réduite à 2160 px et filtrée : dix photos de
  // 12 Mpx en mémoire saturent un téléphone.
  const photoFile = item && !item.video ? item.file : null;
  const photoFilter = item?.filter ?? "aucun";
  const [loaded, setLoaded] = useState<{ file: File; filter: PhotoFilter; src: HTMLCanvasElement } | null>(null);
  const bitmap = loaded && loaded.file === photoFile && loaded.filter === photoFilter ? loaded.src : null;
  useEffect(() => {
    if (!photoFile) return;
    let alive = true;
    loadBitmap(photoFile)
      .then((b) => {
        const src = alive ? preparePhoto(b, photoFilter) : null;
        b.close();
        if (src) setLoaded({ file: photoFile, filter: photoFilter, src });
      })
      .catch(() => alive && setError("Photo illisible : retirez-la de la série."));
    return () => {
      alive = false;
    };
  }, [photoFile, photoFilter]);

  // Libère les aperçus (URL locales) à la fermeture.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const isVideo = !!item?.video;
  const [videoError, setVideoError] = useState(false);
  const [videoMeta, setVideoMeta] = useState<{ width: number; height: number; duration: number } | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // Vidéo : pas de « Cadre » (il redimensionne la photo), et pas d'habillage au-delà de 90 s ou
  // si le navigateur ne peut pas lire la vidéo (dimensions inconnues).
  const videoHabillage = single && isVideo && !videoError && !!videoMeta && videoMeta.duration <= VIDEO_HABILLAGE_MAX_SECONDS;
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
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        // Pincement : taille du titre, ou zoom de la photo en recadrage.
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), size: dragMode === "title" ? title.size : crop.zoom };
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
        const base = pinch.current.size;
        if (dragMode === "title") setTitle((t) => ({ ...t, size: Math.round(Math.min(220, Math.max(32, base * ratio))) }));
        else setCrop((c) => ({ ...c, zoom: Math.min(3, Math.max(1, base * ratio)) }));
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
    void renderHabillage(canvasRef.current, bitmap, { template, format, text, settings, crop, title: active === coverIndex ? title : { ...title, text: "" } });
  }, [step, bitmap, template, format, text, settings, crop, title, active, coverIndex]);

  // Visionneuse : rendu final de la photo (habillée avec les réglages actuels, ou telle quelle).
  useEffect(() => {
    if (!viewer || !item || item.video || !bitmap || !viewerRef.current) return;
    if (item.dress) void renderHabillage(viewerRef.current, bitmap, { template, format, text, settings, crop, title: active === coverIndex ? title : { ...title, text: "" } });
    else renderPlain(viewerRef.current, bitmap, crop);
  }, [viewer, item, bitmap, template, format, text, settings, crop, title, active, coverIndex]);

  // Aperçu du calque par-dessus la vidéo.
  useEffect(() => {
    if (step !== "habillage" || !videoHabillage || !videoMeta || !overlayRef.current) return;
    void renderHabillage(overlayRef.current, null, { template, format, text, settings, overlaySize: overlaySizeFor(videoMeta), skipOverlayImage: !!anim, title });
  }, [step, videoHabillage, videoMeta, template, format, text, settings, anim, title]);

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

  /** Ajoute des médias à la série : photos prises sur le moment habillées, imports de la galerie tels quels. */
  const pick = (e: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    addFiles(files, fromCamera);
  };

  const openCamera = () => {
    setError(null);
    if (cameraSupported() && !cameraBlocked) setCamera(true);
    else photoRef.current?.click();
  };

  const addFiles = (files: File[], fromCamera: boolean) => {
    if (!files.length) return;
    const room = MAX_ITEMS - itemsRef.current.length;
    setError(files.length > room ? `${MAX_ITEMS} médias au maximum par publication (limite des carrousels Instagram).` : null);
    const added = files.slice(0, Math.max(room, 0)).map((f) => {
      const video = isVideoFile(f);
      return { id: crypto.randomUUID(), file: f, url: URL.createObjectURL(f), video, dress: fromCamera && !video, crop: DEFAULT_CROP, filter: "aucun" as PhotoFilter };
    });
    if (!added.length) return;
    if (added.some((a) => a.video)) {
      setVideoError(false);
      setVideoMeta(null);
      setTemplate((cur) => (cur === "cadre" ? "bandeau" : cur));
    }
    setItems((list) => [...list, ...added]);
    itemsRef.current = [...itemsRef.current, ...added];
  };

  const move = (i: number, dir: -1 | 1) =>
    setItems((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const remove = (i: number) => {
    URL.revokeObjectURL(items[i].url);
    setItems((list) => list.filter((_, k) => k !== i));
    setActive(Math.max(0, Math.min(i, items.length - 2)));
    setDragMode(null);
    if (items.length <= 1) setViewer(false);
  };

  /** Visionneuse : photo précédente / suivante. */
  const go = (dir: -1 | 1) => {
    setDragMode(null);
    setActive((a) => Math.min(items.length - 1, Math.max(0, a + dir)));
  };
  const openViewer = (i: number) => {
    setDragMode(null);
    setActive(i);
    setViewer(true);
  };

  const toggleDress = (i: number) => setItems((list) => list.map((it, k) => (k === i ? { ...it, dress: !it.dress } : it)));

  /** Fin de la série : habillage (s'il y a des photos à habiller ou une vidéo seule), sinon légende. */
  const continueSeries = () => {
    setError(null);
    setDragMode(null);
    setActive(Math.max(coverIndex, 0));
    if (!needsHabillage) return setStep("publier");
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

    if (video.size > VIDEO_HABILLAGE_MAX_BYTES)
      throw new Error(
        `Vidéo trop lourde pour l'habillage (${Math.round(video.size / 1_048_576)} Mo, 500 Mo maximum) : filmez plus court ou en 1080p, ou choisissez le gabarit « Aucun » pour la publier telle quelle.`
      );
    setProgress("Envoi de la vidéo pour l'habillage…");
    const targets = await createVideoWorkUploads(video.name || "video.mp4");
    // Calque (quelques Ko) d'un seul tenant ; vidéo (souvent des centaines de Mo au téléphone) en
    // envoi reprenable par morceaux, sinon la moindre coupure réseau fait tout échouer.
    const overlayUp = await createClient().storage.from("video-work").uploadToSignedUrl(targets.overlay.path, targets.overlay.token, overlay, { contentType: "image/png" });
    if (overlayUp.error) throw new Error(`Envoi du calque impossible : ${overlayUp.error.message}`);
    try {
      await uploadResumableSigned({
        bucket: "video-work",
        path: targets.video.path,
        token: targets.video.token,
        file: video,
        contentType: video.type || "video/mp4",
        onProgress: (sent, total) => setProgress(`Envoi de la vidéo pour l'habillage… ${Math.round((sent / Math.max(total, 1)) * 100)} %`),
      });
    } catch (e) {
      throw new Error(`Envoi de la vidéo impossible (${Math.round(video.size / 1_048_576)} Mo) : ${e instanceof Error ? e.message : "réseau coupé"}. Réessayez, idéalement en Wi-Fi.`);
    }

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
    if (!items.length || !user) return;
    setError(null);
    try {
      // Dans l'ordre de la série : photos habillées (rendues ici), images telles quelles (JPEG),
      // vidéos d'origine (typées d'après leur extension si le téléphone ne l'a pas fait, sinon les
      // réseaux les refusent) — habillées seulement quand elles sont seules.
      const medias: File[] = [];
      for (const [i, it] of items.entries()) {
        const name = `publication-${Date.now()}-${i + 1}`;
        if (it.video) {
          let v = it.file.type ? it.file : new File([it.file], it.file.name, { type: /\.mov$/i.test(it.file.name) ? "video/quicktime" : "video/mp4" });
          if (videoHabillage && videoMeta && (template !== "aucun" || !!title.text.trim() || !!pre)) v = await habillerVideo(v, videoMeta);
          medias.push(v);
          continue;
        }
        setProgress(items.length > 1 ? `Préparation des photos… ${i + 1}/${items.length}` : "Préparation de la photo…");
        const bmp = await loadBitmap(it.file).catch(() => {
          throw new Error(`Photo n° ${i + 1} illisible : retirez-la de la série.`);
        });
        let src: HTMLCanvasElement;
        try {
          src = preparePhoto(bmp, it.filter);
        } finally {
          bmp.close();
        }
        // Habillée : gabarit LGEF ; telle quelle : proportions d'origine, recadrage appliqué
        // (réenregistrée en JPEG : le HEIC de l'iPhone est refusé par les réseaux).
        const canvas = document.createElement("canvas");
        if (it.dress) await renderHabillage(canvas, src, { template, format, text, settings, crop: it.crop, title: i === coverIndex ? title : { ...title, text: "" } });
        else renderPlain(canvas, src, it.crop);
        medias.push(await canvasToFile(canvas, `${name}.jpg`));
      }
      setProgress(medias.length > 1 ? `Envoi des ${medias.length} médias…` : "Envoi du média…");
      const onProgress = (sent: number, total: number) =>
        setProgress(`${medias.length > 1 ? `Envoi des ${medias.length} médias` : "Envoi du média"}… ${Math.round((sent / Math.max(total, 1)) * 100)} %`);
      let fileIds: string[] = [];
      let standalone: Awaited<ReturnType<typeof uploadStandaloneMedia>> = [];
      if (event) {
        const results = await uploadEventFiles(event.id, medias, onProgress);
        const failed = results.find((r) => !r.ok);
        if (failed) throw new Error(failed.error ?? "Échec de l'envoi du média.");
        fileIds = results.map((r) => r.id).filter((id): id is string => !!id);
      } else {
        standalone = await uploadStandaloneMedia(medias, onProgress);
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
    if (step === "publier") setStep(needsHabillage ? "habillage" : "capture");
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
              ? items.length
                ? `Série · ${items.length} média${items.length > 1 ? "s" : ""}`
                : "Photo ou vidéo à publier"
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
        <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e, true)} />
        <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => pick(e, true)} />
        <input ref={galleryRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pick(e, false)} />

        {step === "capture" && items.length === 0 && (
          <div className="flex h-full flex-col justify-center gap-3">
            <button onClick={openCamera} className="flex items-center gap-3 rounded-panel bg-red p-4 text-left text-white shadow-btn-red">
              <Camera size={26} />
              <span>
                <span className="block text-base font-extrabold">Caméra</span>
                <span className="block text-xs text-white/80">Appui : photo instantanée · appui long : vidéo</span>
              </span>
            </button>
            <button onClick={() => videoRef.current?.click()} className="flex items-center gap-3 rounded-panel bg-navy p-4 text-left text-white">
              <Video size={26} />
              <span>
                <span className="block text-base font-extrabold">Filmer avec le téléphone</span>
                <span className="block text-xs text-white/80">Appareil du téléphone : vidéos longues, pleine qualité</span>
              </span>
            </button>
            <button onClick={() => galleryRef.current?.click()} className="flex items-center gap-3 rounded-panel border border-line p-4 text-left">
              <Images size={24} className="text-ink-3" />
              <span>
                <span className="block text-sm font-bold text-ink">Choisir dans la galerie</span>
                <span className="block text-xs text-ink-4">Photos, vidéos ou visuels déjà prêts (partenaire…)</span>
              </span>
            </button>
          </div>
        )}

        {step === "capture" && items.length > 0 && (
          <div className="space-y-3">
            {/* Série : ordre de publication (carrousel / album), à réorganiser avec les flèches. */}
            <div className="grid grid-cols-2 gap-2">
              {items.map((it, i) => (
                <div key={it.id} className="overflow-hidden rounded-panel border border-line bg-card">
                  <div className="relative aspect-square bg-subtle">
                    <button onClick={() => openViewer(i)} className="block h-full w-full" aria-label={`Agrandir le média ${i + 1}`}>
                      {it.video ? (
                        <video src={`${it.url}#t=0.1`} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- aperçu local (URL blob)
                        <img src={it.url} alt="" className="h-full w-full object-cover" style={{ filter: filterCss(it.filter) }} />
                      )}
                    </button>
                    <span className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-navy px-1.5 text-xs font-extrabold text-white">
                      {i + 1}
                    </span>
                    {it.video && <Video size={16} className="absolute bottom-1.5 left-1.5 text-white drop-shadow" />}
                    <button
                      onClick={() => remove(i)}
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white"
                      aria-label={`Retirer le média ${i + 1}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1 p-1.5">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-2 disabled:opacity-30" aria-label="Avancer">
                      <ChevronLeft size={16} />
                    </button>
                    {it.video ? (
                      <span className="flex-1 text-center text-[11px] font-semibold text-ink-4">{single ? "Vidéo" : "Telle quelle"}</span>
                    ) : (
                      <button
                        onClick={() => toggleDress(i)}
                        className={`flex-1 rounded-btn px-1 py-1.5 text-[11px] font-bold ${it.dress ? "bg-navy text-white" : "bg-subtle text-ink-3"}`}
                      >
                        {it.dress ? "Habillée" : "Telle quelle"}
                      </button>
                    )}
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === items.length - 1}
                      className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-2 disabled:opacity-30"
                      aria-label="Reculer"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {items.length < MAX_ITEMS ? (
              <>
                <button onClick={openCamera} className="flex w-full items-center justify-center gap-2 rounded-panel bg-red p-3.5 text-base font-extrabold text-white shadow-btn-red">
                  <Camera size={22} /> Photo suivante
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => videoRef.current?.click()} className="flex items-center justify-center gap-1.5 rounded-panel border border-line p-3 text-sm font-bold text-ink-2">
                    <Video size={16} /> Vidéo téléphone
                  </button>
                  <button onClick={() => galleryRef.current?.click()} className="flex items-center justify-center gap-1.5 rounded-panel border border-line p-3 text-sm font-bold text-ink-2">
                    <Plus size={16} /> Galerie
                  </button>
                </div>
              </>
            ) : (
              <p className="text-center text-xs text-ink-4">{MAX_ITEMS} médias : c&apos;est le maximum d&apos;un carrousel Instagram.</p>
            )}
            <p className="text-[11px] text-ink-4">
              Touchez une photo pour l&apos;agrandir, la recadrer ou lui appliquer un filtre. « Habillée » : habillage LGEF et texte appliqués à l&apos;étape suivante. « Telle quelle » : publiée sans retouche (visuel partenaire déjà au format…).
              {items.some((i) => i.video) && items.length > 1 ? " Dans une série, les vidéos partent sans habillage ; Facebook les publie à part de l'album photo." : ""}
            </p>
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
            {!single && (
              <div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {items.map((it, i) =>
                    it.video || !it.dress ? null : (
                      <button
                        key={it.id}
                        onClick={() => {
                          setDragMode(null);
                          setActive(i);
                        }}
                        className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-btn border-2 ${i === active ? "border-red" : "border-transparent"}`}
                        aria-label={`Photo ${i + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (URL blob) */}
                        <img src={it.url} alt="" className="h-full w-full object-cover" style={{ filter: filterCss(it.filter) }} />
                        <span className="absolute left-0.5 top-0.5 rounded-full bg-navy px-1 text-[9px] font-bold text-white">{i + 1}</span>
                      </button>
                    )
                  )}
                </div>
                <p className="mt-1 text-[11px] text-ink-4">
                  Habillage, format et texte valent pour les {items.filter((i) => !i.video && i.dress).length} photos habillées ; recadrage photo par photo ; le titre ne va que sur la photo n° {coverIndex + 1}.
                </p>
              </div>
            )}
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
                  <div className={label}>Filtre</div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {PHOTO_FILTERS.map((f) => (
                      <button key={f.id} onClick={() => setFilter(f.id)} className={`shrink-0 ${chip(photoFilter === f.id)}`}>
                        {f.label}
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
                      // Série : le titre se place sur la photo de couverture.
                      if (!single && active !== coverIndex) setActive(coverIndex);
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

      {camera && (
        <InAppCamera
          count={items.length}
          max={MAX_ITEMS}
          onCapture={(f) => addFiles([f], true)}
          onNativeVideo={() => {
            setCamera(false);
            videoRef.current?.click();
          }}
          onClose={() => setCamera(false)}
          onUnavailable={(msg) => {
            setCamera(false);
            setCameraBlocked(true);
            setError(msg);
          }}
        />
      )}

      {viewer && item && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
          <div className="flex shrink-0 items-center gap-2 px-3 pb-2" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
            <button onClick={() => setViewer(false)} className="rounded-full p-2 hover:bg-white/10" aria-label="Fermer">
              <X size={20} />
            </button>
            <div className="flex-1 text-center text-sm font-bold">
              {active + 1} / {items.length}
            </div>
            <button onClick={() => remove(active)} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold text-red hover:bg-white/10" aria-label="Supprimer ce média">
              <Trash2 size={17} /> Supprimer
            </button>
          </div>

          {/* Glisser à gauche / à droite pour faire défiler (hors recadrage). */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2"
            onPointerDown={(e) => {
              if (!dragMode) swipe.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const st = swipe.current;
              swipe.current = null;
              if (!st || dragMode) return;
              const dx = e.clientX - st.x;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - st.y)) go(dx < 0 ? 1 : -1);
            }}
          >
            {item.video ? (
              <video key={item.url} src={item.url} controls playsInline className="max-h-full max-w-full" />
            ) : (
              <>
                <canvas ref={viewerRef} {...drag} className={`max-h-full max-w-full ${dragMode === "crop" ? "touch-none outline outline-2 outline-red" : ""}`} />
                {!bitmap && <Loader2 size={28} className="absolute animate-spin text-white/70" />}
              </>
            )}
            {active > 0 && (
              <button onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2" aria-label="Précédent">
                <ChevronLeft size={22} />
              </button>
            )}
            {active < items.length - 1 && (
              <button onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2" aria-label="Suivant">
                <ChevronRight size={22} />
              </button>
            )}
          </div>

          {!item.video && (
            <div className="shrink-0 space-y-2.5 rounded-t-sheet bg-card p-3 text-ink" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {PHOTO_FILTERS.map((f) => (
                  <button key={f.id} onClick={() => setFilter(f.id)} className="flex shrink-0 flex-col items-center gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (URL blob) */}
                    <img
                      src={item.url}
                      alt=""
                      className={`h-14 w-14 rounded-btn object-cover ${item.filter === f.id ? "ring-2 ring-red" : ""}`}
                      style={{ filter: f.css }}
                    />
                    <span className={`text-[10px] font-bold ${item.filter === f.id ? "text-red" : "text-ink-3"}`}>{f.label}</span>
                  </button>
                ))}
              </div>
              {dragMode === "crop" ? (
                <div className="flex items-center gap-2 text-xs text-ink-3">
                  <span className="shrink-0">Zoom</span>
                  <input type="range" min={1} max={3} step={0.05} value={crop.zoom} onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))} className="flex-1" />
                  <button onClick={() => setCrop(DEFAULT_CROP)} className="rounded-full p-1.5 text-ink-3 hover:bg-hover" aria-label="Réinitialiser le cadrage">
                    <RotateCcw size={15} />
                  </button>
                  <button onClick={() => setDragMode(null)} className={chip(true)}>
                    OK
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => setDragMode("crop")} className="flex items-center gap-1.5 rounded-btn border border-line px-3 py-2 text-sm font-bold text-ink-2">
                    <Crop size={15} /> Recadrer / zoomer
                  </button>
                  <button
                    onClick={() => toggleDress(active)}
                    className={`ml-auto rounded-btn px-3 py-2 text-sm font-bold ${item.dress ? "bg-navy text-white" : "bg-subtle text-ink-3"}`}
                  >
                    {item.dress ? "Habillée" : "Telle quelle"}
                  </button>
                </div>
              )}
              <p className="text-[11px] text-ink-4">
                {dragMode === "crop"
                  ? "Faites glisser la photo pour la cadrer, pincez à deux doigts ou utilisez le curseur pour zoomer."
                  : item.dress
                    ? "Aperçu avec l'habillage actuel (modifiable à l'étape suivante). Glissez à gauche ou à droite pour passer d'une photo à l'autre."
                    : "Publiée telle quelle, avec ce filtre et ce cadrage. Glissez à gauche ou à droite pour passer d'une photo à l'autre."}
              </p>
            </div>
          )}
        </div>
      )}

      {(step !== "capture" || items.length > 0) && (
        <div className="flex shrink-0 gap-2 border-t border-line p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button onClick={back} disabled={!!progress} className="rounded-btn border border-line px-4 py-3 text-sm font-bold text-ink-2 disabled:opacity-50">
            Retour
          </button>
          {step === "capture" ? (
            <button onClick={continueSeries} className="flex-1 rounded-btn bg-navy py-3 text-sm font-extrabold text-white">
              Continuer · {items.length} média{items.length > 1 ? "s" : ""}
            </button>
          ) : step === "habillage" ? (
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
