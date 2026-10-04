"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";

// Caméra intégrée (publication réseaux, mobile) : image en direct, mode Photo (appui = photo
// instantanée, tirée du flux sans aller-retour par l'appareil du téléphone) ou Vidéo (un appui lance,
// un appui arrête), zoom (pincement ou 1× / 2× / 5×). Les prises s'empilent en bas à gauche sans
// quitter la caméra ; la pile s'ouvre dans la visionneuse (recadrer, filtre, supprimer).

/** Durée maximale d'une vidéo filmée ici. */
const MAX_VIDEO_S = 120;

/** Format d'enregistrement : MP4 seulement (Instagram et Facebook refusent le WebM). */
function mp4Type() {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function cameraSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

type ZoomRange = { min: number; max: number; hardware: boolean };
/** Zoom numérique (téléphones sans zoom matériel exposé, ex. Safari) : photos seulement, jusqu'à 4×. */
const DIGITAL_ZOOM: ZoomRange = { min: 1, max: 4, hardware: false };

export function InAppCamera({
  count,
  max,
  lastThumb,
  onCapture,
  onOpenStack,
  onNativeVideo,
  onDone,
  onClose,
  onUnavailable,
}: {
  /** Médias déjà dans la série. */
  count: number;
  max: number;
  /** Vignette de la dernière prise (pile en bas à gauche). */
  lastThumb: string | null;
  onCapture: (file: File) => void;
  /** Appui sur la pile : visionneuse de la série. */
  onOpenStack: () => void;
  /** Vidéo impossible ici (pas de MP4) : ouvre l'enregistreur du téléphone. */
  onNativeVideo: () => void;
  /** « OK » : écran suivant. */
  onDone: () => void;
  onClose: () => void;
  /** Caméra refusée ou absente : on repasse par l'appareil photo du téléphone. */
  onUnavailable: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [mode, setMode] = useState<"photo" | "video">("photo");
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState<number | null>(null); // secondes écoulées
  const [flash, setFlash] = useState(false);
  const [mp4] = useState(mp4Type);
  const [zoomRange, setZoomRange] = useState<ZoomRange>(DIGITAL_ZOOM);
  const [zoom, setZoom] = useState(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const full = count >= max;
  // Zoom numérique : sans effet sur l'enregistrement vidéo, donc limité au mode Photo.
  const digital = !zoomRange.hardware;
  const shownZoom = digital && mode === "video" ? 1 : zoom;

  // Flux caméra (+ micro pour les vidéos ; sans micro si refusé), zoom matériel s'il est exposé.
  useEffect(() => {
    let alive = true;
    const video = { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } };
    navigator.mediaDevices
      .getUserMedia({ video, audio: !!mp4 })
      .catch(() => navigator.mediaDevices.getUserMedia({ video, audio: false }))
      .then((stream) => {
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const caps = (stream.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number } };
        setZoomRange(caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max, hardware: true } : DIGITAL_ZOOM);
        setZoom(caps.zoom ? Math.max(1, caps.zoom.min) : 1);
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          void el.play().catch(() => undefined);
        }
      })
      .catch(() => alive && onUnavailable("Caméra indisponible : autorisez-la dans le navigateur. En attendant, l'appareil photo du téléphone s'ouvre."));
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onUnavailable : rappel du parent, seul le côté de la caméra relance le flux
  }, [facing, mp4]);

  // Zoom matériel appliqué au capteur (photo et vidéo).
  useEffect(() => {
    if (!zoomRange.hardware) return;
    const track = streamRef.current?.getVideoTracks()[0];
    void track?.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] }).catch(() => undefined);
  }, [zoom, zoomRange.hardware]);

  // Chronomètre et arrêt automatique de l'enregistrement.
  useEffect(() => {
    if (recording === null) return;
    if (recording >= MAX_VIDEO_S) {
      recorderRef.current?.stop();
      return;
    }
    const t = window.setTimeout(() => setRecording((s) => (s === null ? s : s + 1)), 1000);
    return () => window.clearTimeout(t);
  }, [recording]);

  useEffect(
    () => () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    },
    []
  );

  const clampZoom = (z: number) => Math.min(zoomRange.max, Math.max(zoomRange.min, z));

  /** Photo : image courante du flux (recadrée au centre en zoom numérique). */
  const takePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || full) return;
    const crop = digital ? zoom : 1;
    const sw = Math.round(v.videoWidth / crop);
    const sh = Math.round(v.videoHeight / crop);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d")!;
    // Caméra avant : on publie l'image dans le bon sens (l'aperçu, lui, est en miroir).
    if (facing === "user") {
      ctx.translate(sw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, sw, sh);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 120);
    canvas.toBlob((b) => b && onCapture(new File([b], `photo-${Date.now()}.jpg`, { type: "image/jpeg" })), "image/jpeg", 0.92);
  };

  const startVideo = () => {
    const stream = streamRef.current;
    if (!stream || full) return;
    if (!mp4) return onNativeVideo();
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mp4, videoBitsPerSecond: 8_000_000 });
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      setRecording(null);
      recorderRef.current = null;
      if (chunks.length) onCapture(new File(chunks, `video-${Date.now()}.mp4`, { type: mp4.split(";")[0] }));
    };
    rec.start(1000);
    recorderRef.current = rec;
    setRecording(0);
  };

  /** Déclencheur : photo instantanée, ou début / fin de la vidéo. */
  const shutter = () => {
    if (!ready) return;
    if (mode === "photo") return takePhoto();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else startVideo();
  };

  // Pincement à deux doigts sur l'image : zoom.
  const zoomHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinch.current || pointers.current.size !== 2) return;
      const [a, b] = [...pointers.current.values()];
      setZoom(clampZoom(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(pinch.current.dist, 1))));
    },
    onPointerUp: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
    },
  };

  const presets = [1, 2, 5].filter((z) => z >= zoomRange.min && z <= zoomRange.max);
  const atPreset = (z: number) => Math.abs(zoom - z) < 0.05;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <div className="absolute inset-0 touch-none overflow-hidden" {...zoomHandlers} onPointerCancel={zoomHandlers.onPointerUp}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          onPlaying={() => setReady(true)}
          className="h-full w-full object-cover"
          style={{ transform: `${facing === "user" ? "scaleX(-1) " : ""}${digital ? `scale(${shownZoom})` : ""}` || undefined }}
        />
      </div>
      {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}
      {!ready && <Loader2 size={32} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/70" />}

      <div className="relative flex items-center justify-between px-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <button onClick={onClose} disabled={recording !== null} className="rounded-full bg-black/40 p-2.5 disabled:opacity-40" aria-label="Fermer la caméra">
          <X size={22} />
        </button>
        {recording !== null && (
          <span className="flex items-center gap-1.5 rounded-full bg-red px-3 py-1 text-sm font-bold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            {`${Math.floor(recording / 60)}:${String(recording % 60).padStart(2, "0")}`}
          </span>
        )}
        <button
          onClick={() => {
            setReady(false);
            setFacing((f) => (f === "environment" ? "user" : "environment"));
          }}
          disabled={recording !== null}
          className="rounded-full bg-black/40 p-2.5 disabled:opacity-40"
          aria-label="Changer de caméra"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      <div className="relative mt-auto flex flex-col items-center gap-3 px-4" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
        {/* Zoom : boutons rapides (le pincement règle finement). */}
        {!(digital && mode === "video") && (
          <div className="flex items-center gap-1 rounded-full bg-black/40 p-1">
            {presets.map((z) => (
              <button
                key={z}
                onClick={() => setZoom(clampZoom(z))}
                className={`h-9 min-w-9 rounded-full px-2 text-xs font-extrabold ${atPreset(z) ? "bg-white text-black" : "text-white"}`}
              >
                {z}×
              </button>
            ))}
            {/* Zoom réglé au pincement, entre deux paliers. */}
            {!presets.some(atPreset) && <span className="rounded-full bg-white px-2 py-1.5 text-xs font-extrabold text-black">{zoom.toFixed(1)}×</span>}
          </div>
        )}

        <div className="flex w-full items-center justify-between">
          {/* Pile des prises : la dernière en vignette, appui = visionneuse (recadrer, filtre, supprimer). */}
          <button
            onClick={onOpenStack}
            disabled={!count || recording !== null}
            className="relative h-14 w-14 overflow-hidden rounded-btn border-2 border-white bg-black/40 disabled:opacity-40"
            aria-label="Voir les prises"
          >
            {lastThumb && (
              // eslint-disable-next-line @next/next/no-img-element -- aperçu local (URL blob)
              <img src={lastThumb} alt="" className="h-full w-full object-cover" />
            )}
            {count > 0 && (
              <span className="absolute -right-0 -top-0 flex h-5 min-w-5 items-center justify-center rounded-bl-btn bg-red px-1 text-[11px] font-extrabold">{count}</span>
            )}
          </button>

          <button
            onClick={shutter}
            disabled={full && recording === null}
            className="flex h-20 w-20 select-none items-center justify-center rounded-full border-4 border-white transition-transform active:scale-95 disabled:opacity-40"
            aria-label={mode === "photo" ? "Prendre une photo" : recording !== null ? "Arrêter la vidéo" : "Lancer la vidéo"}
          >
            <span
              className={`block transition-all ${
                recording !== null ? "h-8 w-8 rounded-md bg-red" : mode === "video" ? "h-16 w-16 rounded-full bg-red" : "h-16 w-16 rounded-full bg-white"
              }`}
            />
          </button>

          <button onClick={onDone} disabled={!count || recording !== null} className="h-14 w-14 rounded-full bg-white text-sm font-extrabold text-navy disabled:opacity-40">
            OK
          </button>
        </div>

        {/* Mode : photo ou vidéo (pas d'appui maintenu). */}
        <div className="flex gap-1 rounded-full bg-black/40 p-1">
          {(["photo", "video"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={recording !== null}
              className={`rounded-full px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide ${mode === m ? "bg-white text-black" : "text-white"}`}
            >
              {m === "photo" ? "Photo" : "Vidéo"}
            </button>
          ))}
        </div>
        {full && <p className="text-xs font-semibold text-white/80">{max} médias : série complète.</p>}
      </div>
    </div>
  );
}
