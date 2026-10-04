"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";

// Caméra intégrée façon Snapchat (publication réseaux, mobile) : image en direct, appui = photo
// instantanée (image tirée du flux, sans aller-retour par l'appareil photo du téléphone), appui long =
// vidéo tant que le doigt reste posé. Les prises s'ajoutent à la série sans quitter la caméra.

/** Durée d'appui au-delà de laquelle on filme au lieu de photographier. */
const HOLD_MS = 300;
/** Durée maximale d'une vidéo filmée ici. */
const MAX_VIDEO_S = 60;

/** Format d'enregistrement : MP4 seulement (Instagram et Facebook refusent le WebM). */
function mp4Type() {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function cameraSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export function InAppCamera({
  count,
  max,
  onCapture,
  onNativeVideo,
  onClose,
  onUnavailable,
}: {
  /** Médias déjà dans la série. */
  count: number;
  max: number;
  onCapture: (file: File) => void;
  /** Vidéo impossible ici (pas de MP4) : ouvre l'enregistreur du téléphone. */
  onNativeVideo: () => void;
  onClose: () => void;
  /** Caméra refusée ou absente : on repasse par l'appareil photo du téléphone. */
  onUnavailable: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const holdTimer = useRef<number | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState<number | null>(null); // secondes écoulées
  const [flash, setFlash] = useState(false);
  const [mp4] = useState(mp4Type);
  const full = count >= max;

  // Flux caméra (+ micro pour les vidéos ; sans micro si refusé).
  useEffect(() => {
    let alive = true;
    const video = { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } };
    navigator.mediaDevices
      .getUserMedia({ video, audio: !!mp4 })
      .catch(() => navigator.mediaDevices.getUserMedia({ video, audio: false }))
      .then((stream) => {
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
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
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    },
    []
  );

  /** Photo : image courante du flux, à la résolution de la caméra. */
  const takePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || full) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d")!;
    // Caméra avant : on publie l'image dans le bon sens (l'aperçu, lui, est en miroir).
    if (facing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
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

  // Déclencheur : appui court = photo, appui long = vidéo jusqu'au relâchement.
  const press = () => {
    if (full || !ready) return;
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      startVideo();
    }, HOLD_MS);
  };
  const release = () => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
      takePhoto();
    } else if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onPlaying={() => setReady(true)}
        className="absolute inset-0 h-full w-full object-cover"
        style={facing === "user" ? { transform: "scaleX(-1)" } : undefined}
      />
      {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}
      {!ready && <Loader2 size={32} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/70" />}

      <div className="relative flex items-center justify-between px-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <button onClick={onClose} className="rounded-full bg-black/40 p-2.5" aria-label="Fermer la caméra">
          <X size={22} />
        </button>
        {recording !== null && (
          <span className="flex items-center gap-1.5 rounded-full bg-red px-3 py-1 text-sm font-bold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            {`0:${String(recording).padStart(2, "0")}`}
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
        <p className="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold">
          {full ? `${max} médias : série complète` : recording !== null ? "Relâchez pour arrêter" : "Appui : photo · appui long : vidéo"}
        </p>
        <div className="flex w-full items-center justify-between">
          <span className="w-20" />
          <button
            onPointerDown={press}
            onPointerUp={release}
            onPointerCancel={release}
            onContextMenu={(e) => e.preventDefault()}
            disabled={full}
            className={`flex h-20 w-20 touch-none select-none items-center justify-center rounded-full border-4 border-white transition-transform active:scale-95 disabled:opacity-40 ${
              recording !== null ? "scale-110" : ""
            }`}
            aria-label="Déclencheur : appui pour une photo, appui long pour une vidéo"
          >
            <span className={`block transition-all ${recording !== null ? "h-8 w-8 rounded-md bg-red" : "h-16 w-16 rounded-full bg-white"}`} />
          </button>
          <button onClick={onClose} disabled={recording !== null} className="w-20 rounded-full bg-white px-3 py-2 text-sm font-extrabold text-navy disabled:opacity-40">
            {count ? `OK · ${count}` : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
