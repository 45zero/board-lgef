"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Video, Images, X, ChevronLeft, Loader2, CalendarDays, Search, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { uploadEventFiles, uploadStandaloneMedia } from "@/lib/board/eventFiles";
import { createPublication, listMediaPublications, type MediaPublication } from "@/lib/board/mediaPublications";
import {
  HABILLAGE_FORMATS,
  availableTemplates,
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

type Step = "capture" | "habillage" | "publier";

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
  const templates = availableTemplates(settings);

  // Réglages des habillages (administrateur) : tailles, signature, gabarits actifs et personnalisés.
  useEffect(() => {
    getHabillageSettings()
      .then((s) => {
        const full = withDefaults(s);
        setSettings(full);
        const list = availableTemplates(full);
        setTemplate((cur) => (list.some((t) => t.id === cur) ? cur : (list[1]?.id ?? "aucun")));
      })
      .catch(() => undefined);
  }, []);

  // Aperçu de l'habillage, redessiné à chaque changement.
  useEffect(() => {
    if (step !== "habillage" || !bitmap || !canvasRef.current) return;
    void renderHabillage(canvasRef.current, bitmap, { template, format, text, settings });
  }, [step, bitmap, template, format, text, settings]);

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
      setVideoUrl(URL.createObjectURL(f));
    } else {
      try {
        setBitmap(await loadBitmap(f));
      } catch {
        return setError("Photo illisible : réessayez.");
      }
    }
    setStep("habillage");
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
        await renderHabillage(canvas, bitmap, { template, format, text, settings });
        media = await canvasToFile(canvas, `publication-${Date.now()}.jpg`);
      }
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
    else if (step === "habillage") setStep("capture");
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
            {step === "capture" ? "Photo ou vidéo à publier" : step === "habillage" ? (isVideo ? "Aperçu de la vidéo" : "Habillage et texte") : "Légende et événement"}
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

        {step === "habillage" && (
          <div className="space-y-3">
            {isVideo ? (
              <>
                {videoUrl && file && !videoError && (
                  // « #t=0.1 » : affiche la première image sur iPhone au lieu d'un cadre noir.
                  <video key={videoUrl} controls playsInline preload="metadata" onError={() => setVideoError(true)} className="max-h-[50vh] w-full rounded-panel bg-black">
                    <source src={`${videoUrl}#t=0.1`} type={playableType(file)} />
                  </video>
                )}
                {videoError && (
                  <div className="rounded-panel bg-subtle p-4 text-sm text-ink-2">
                    <div className="font-bold">Aperçu indisponible sur ce navigateur</div>
                    <div className="mt-1 text-xs text-ink-3">
                      {file?.name} · {file ? `${(file.size / 1_048_576).toFixed(1)} Mo` : ""} — la vidéo sera tout de même envoyée et publiée telle quelle.
                    </div>
                  </div>
                )}
                <p className="text-xs text-ink-4">L&rsquo;habillage s&rsquo;applique aux photos. Pour une vidéo, votre texte devient la légende de la publication.</p>
              </>
            ) : (
              <>
                <canvas ref={canvasRef} className="w-full rounded-panel bg-subtle shadow-card" />
                <div>
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
              placeholder={isVideo ? "Texte de la publication" : "Texte sur la photo (ex. « Rentrée de l'arbitrage 2026 »)"}
              className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-link"
            />
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
