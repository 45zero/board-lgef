"use client";

import { useEffect, useRef, useState } from "react";
import { X, Upload, Trash2, Plus, ImageIcon, Loader2 } from "lucide-react";
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
const chip = (active: boolean) => `rounded-full px-3 py-1 text-xs font-bold ${active ? "bg-navy text-white" : "bg-subtle text-ink-3"}`;

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
export function HabillageAdminModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<HabillageSettings | null>(null);
  const [template, setTemplate] = useState<HabillageTemplate>("bandeau");
  const [format, setFormat] = useState<HabillageFormat>("portrait");
  const [sampleText, setSampleText] = useState("Rentrée de l'arbitrage 2026");
  const [photo, setPhoto] = useState<(CanvasImageSource & { width: number; height: number }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    getHabillageSettings()
      .then((s) => setSettings(withDefaults(s)))
      .catch(() => setSettings(withDefaults(null)));
  }, []);

  useEffect(() => {
    if (!settings || !canvasRef.current) return;
    void renderHabillage(canvasRef.current, photo ?? samplePhoto(), { template, format, text: sampleText, settings });
  }, [settings, template, format, sampleText, photo]);

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

  /** Animation .mov (couche alpha) : dépôt, puis conversion en WebM transparent par le serveur. */
  const uploadAnimation = async (c: CustomHabillage, orientation: VideoOrientation, file: File) => {
    setMessage(null);
    setBusy(`${c.id}:anim:${orientation}`);
    try {
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
      setSettings((st) =>
        st
          ? {
              ...st,
              custom: st.custom.map((x) =>
                x.id === c.id ? { ...x, animations: { ...(x.animations ?? {}), [orientation]: { url: body.url!, preview: body.preview!, duration: body.duration ?? 0 } } } : x
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

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      await saveHabillageSettings(settings);
      setMessage({ tone: "ok", text: "Habillages enregistrés : proposés à tous dès la prochaine publication." });
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "Enregistrement impossible." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Centre de publication · Administration</div>
            <h3 className="mt-1 text-base font-extrabold">Habillages des publications</h3>
            <div className="text-xs text-white/80">Appliqués aux photos publiées depuis le mobile (bouton central « Publication réseaux »).</div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="grid flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <section className="rounded-panel border border-line bg-subtle/50 p-3 text-xs text-ink-2">
              <div className={label}>Tailles des images</div>
              <ul className="space-y-0.5">
                <li>• {HABILLAGE_SIZES.portrait.label}</li>
                <li>• {HABILLAGE_SIZES.carre.label}</li>
                <li>• Original — 1080 px de large, 566 à 1350 px de haut (les calques personnalisés y sont recadrés)</li>
                <li>• Calques personnalisés : PNG à fond transparent, aux dimensions exactes ci-dessus ; la photo apparaît sous le calque.</li>
                <li>• Logo LGEF : 1014 × 1246 px d&rsquo;origine, proportions toujours conservées.</li>
                <li>• Animations vidéo : .mov avec couche alpha (ProRes 4444, Animation ou PNG — pas le « HEVC avec alpha »), 30 s au plus :</li>
                <li className="pl-3">– {HABILLAGE_VIDEO_SIZES.vertical.label}</li>
                <li className="pl-3">– {HABILLAGE_VIDEO_SIZES.horizontal.label}</li>
              </ul>
            </section>

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

            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <div className={label}>Gabarits personnalisés</div>
                <button onClick={addCustom} className="flex items-center gap-1 text-xs font-semibold text-link hover:underline">
                  <Plus size={13} /> Ajouter
                </button>
              </div>
              {settings.custom.length === 0 && (
                <p className="rounded-btn border border-dashed border-line p-3 text-xs text-ink-4">
                  Aucun gabarit personnalisé. Créez un calque PNG transparent aux tailles indiquées (Canva, Photoshop…) puis ajoutez-le ici.
                </p>
              )}
              <div className="space-y-2">
                {settings.custom.map((c) => (
                  <div key={c.id} className="space-y-2 rounded-panel border border-line p-3">
                    <div className="flex items-center gap-2">
                      <input value={c.name} onChange={(e) => updateCustom(c.id, { name: e.target.value })} className={`${input} min-w-0 flex-1 font-bold`} />
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
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-3 md:sticky md:top-0 md:self-start">
            <div className={label}>Aperçu</div>
            <canvas ref={canvasRef} className="w-full rounded-panel bg-subtle shadow-card" />
            <div className="flex flex-wrap gap-1.5">
              {availableTemplates(settings).map((t) => (
                <button key={t.id} onClick={() => setTemplate(t.id)} className={chip(template === t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {HABILLAGE_FORMATS.map((f) => (
                <button key={f.id} onClick={() => setFormat(f.id)} className={chip(format === f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <input value={sampleText} onChange={(e) => setSampleText(e.target.value)} placeholder="Texte d'exemple" className={`${input} w-full`} />
            <label className="block cursor-pointer text-xs font-semibold text-link hover:underline">
              Tester avec une photo…
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

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3">
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
