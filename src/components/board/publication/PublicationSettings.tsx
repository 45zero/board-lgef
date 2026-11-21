"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, Loader2, Plus, Settings2, ShieldCheck } from "lucide-react";
import { getHabillageSettings } from "@/app/actions/board-settings";
import { getDeliverySettings, saveDeliverySettings } from "@/app/actions/media-deliveries";
import { ModuleAccessEditor } from "@/components/board/modules/ModuleAccessEditor";
import { useModuleAccessAdmin } from "@/components/board/modules/ModuleAccessModal";
import { HabillageAdminModal } from "@/components/board/publication/HabillageAdminModal";
import { withDefaults, type CustomHabillage, type HabillageSettings } from "@/lib/board/habillage";

/**
 * Qui peut publier = qui voit le centre de publication : la règle d'accès du module « audiovisuel »
 * (même éditeur que Paramètres → Accès aux modules). Ces personnes reçoivent « Média à publier ».
 */
function Publishers() {
  const { data, error, applySaved } = useModuleAccessAdmin();
  if (error && !data) return <p className="p-6 text-sm text-bad">{error}</p>;
  if (!data) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;
  return (
    <section className="rounded-panel border border-line bg-card p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={17} className="text-navy" />
        <h3 className="text-sm font-extrabold text-ink">Qui peut publier</h3>
      </div>
      <p className="mb-4 mt-1 text-xs text-ink-3">
        Ces personnes voient le centre de publication, peuvent publier sur les réseaux et reçoivent une notification quand des médias sont à
        publier. Les administrateurs et super users y ont toujours accès.
      </p>
      <ModuleAccessEditor moduleId="audiovisuel" moduleLabel="Centre de publication" data={data} onSaved={applySaved} />
    </section>
  );
}

/**
 * Remise des photos et vidéos : délais (jours après la fin de l'événement) proposés au TeamMedia quand
 * il accepte une captation, et délai maximum qu'il ne peut pas dépasser. Passé sa date, l'encart
 * d'alerte apparaît sur son accueil et sur celui de son N+1.
 */
function DeliveryDelays() {
  const [form, setForm] = useState<{ photoDays: number; videoDays: number; maxDays: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getDeliverySettings()
      .then((res) => (res.ok ? setForm(res.data) : setError(res.error)))
      .catch(() => setError("Réglages indisponibles pour le moment."));
  }, []);
  if (!form) return error ? <p className="p-6 text-sm text-bad">{error}</p> : <div className="p-6 text-sm text-ink-4">Chargement…</div>;
  const field = (key: keyof typeof form, label: string, hint: string) => (
    <label className="block space-y-1">
      <span className="text-xs font-bold text-ink-2">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={90}
          value={form[key]}
          onChange={(e) => {
            setSaved(false);
            setForm({ ...form, [key]: Math.max(0, Math.min(90, Math.round(Number(e.target.value) || 0))) });
          }}
          className="w-20 rounded-btn border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-link"
        />
        <span className="text-xs text-ink-3">jour{form[key] > 1 ? "s" : ""} après l&rsquo;événement</span>
      </div>
      <span className="block text-[11px] text-ink-4">{hint}</span>
    </label>
  );
  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await saveDeliverySettings(form).catch(() => ({ ok: false as const, error: "Enregistrement impossible pour le moment." }));
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setSaved(true);
  };
  return (
    <section className="rounded-panel border border-line bg-card p-5">
      <div className="flex items-center gap-2">
        <CalendarClock size={17} className="text-navy" />
        <h3 className="text-sm font-extrabold text-ink">Remise des photos et vidéos</h3>
      </div>
      <p className="mb-4 mt-1 text-xs text-ink-3">
        Quand un TeamMedia accepte un événement, il indique sa date de remise : la date proposée suit ces délais, sans dépasser le délai maximum. Dès que
        la date est passée sans remise, une alerte apparaît sur son accueil et sur celui de son N+1, qui peut le relancer (cloche, e-mail, puis message plein
        écran). Les fichiers sont considérés remis dès qu&rsquo;il dépose une photo ou une vidéo sur l&rsquo;événement.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {field("photoDays", "Photos", "Date proposée pour les photos.")}
        {field("videoDays", "Vidéo", "Date proposée pour la vidéo (et photo + vidéo).")}
        {field("maxDays", "Délai maximum", "Le TeamMedia ne peut pas choisir plus tard.")}
      </div>
      {error && <div className="mt-3 rounded-btn bg-bad-bg px-3 py-2 text-xs font-semibold text-bad">{error}</div>}
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved && (
          <span className="flex items-center gap-1 text-xs font-semibold text-good">
            <Check size={13} /> Enregistré
          </span>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="flex items-center gap-1.5 rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
        >
          {saving && <Loader2 size={12} className="animate-spin" />} Enregistrer
        </button>
      </div>
    </section>
  );
}

/** Vignette d'un environnement : calque, animation ou pré-roll, sur damier (transparence). */
function Thumb({ c }: { c: CustomHabillage }) {
  const src =
    c.overlays.portrait ??
    c.overlays.carre ??
    c.animations?.vertical?.preview ??
    c.animations?.horizontal?.preview ??
    c.preroll?.animations?.vertical?.preview ??
    c.preroll?.animations?.horizontal?.preview;
  return (
    <div className="aspect-[4/5] w-full overflow-hidden rounded-btn" style={{ background: "repeating-conic-gradient(#e5e9f2 0 25%, #f7f9fd 0 50%) 0 0 / 16px 16px" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- visuels du bucket public */}
      {src && <img src={src} alt="" className="h-full w-full object-contain" />}
    </div>
  );
}

/** Habillages : un environnement par compétition (R1, R2, Coupe de France…), plus les réglages généraux. */
function Habillages() {
  const [settings, setSettings] = useState<HabillageSettings | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    getHabillageSettings()
      .then((s) => setSettings(withDefaults(s)))
      .catch(() => setSettings(withDefaults(null)));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!settings) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;

  const badge = "rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-bold text-ink-3";
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-extrabold text-ink">Habillages</h3>
        <p className="text-xs text-ink-3">
          Un habillage par environnement (R1, R2, Coupe de France…) : pré-roll, bandeau ou calque, animation, logo. Au moment de publier depuis le mobile,
          on choisit l&rsquo;environnement et son habillage s&rsquo;applique.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {settings.custom.map((c) => (
          <button key={c.id} onClick={() => setOpen(c.id)} className="space-y-2 rounded-panel border border-line bg-card p-3 text-left hover:border-link">
            <Thumb c={c} />
            <div className="truncate text-sm font-extrabold text-ink">{c.name || "Sans nom"}</div>
            <div className="flex flex-wrap gap-1">
              {c.preroll && Object.keys(c.preroll.animations ?? {}).length > 0 && <span className={badge}>Pré-roll</span>}
              {c.animations && Object.keys(c.animations).length > 0 && <span className={badge}>Animation</span>}
              {(c.overlays.portrait || c.overlays.carre) && <span className={badge}>Calque</span>}
              {c.keywords && <span className={badge}>Détection auto</span>}
            </div>
          </button>
        ))}
        <button
          onClick={() => setOpen("new")}
          className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-panel border-2 border-dashed border-line text-sm font-bold text-link hover:border-link hover:bg-sel-bg"
        >
          <Plus size={22} /> Créer un nouvel habillage
        </button>
        <button
          onClick={() => setOpen("general")}
          className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-panel border border-line bg-card p-3 text-center hover:border-link"
        >
          <Settings2 size={22} className="text-navy" />
          <span className="text-sm font-bold text-ink">Réglages généraux</span>
          <span className="text-[11px] text-ink-4">Logo, texte, signature, gabarits intégrés</span>
        </button>
      </div>
      {open && <HabillageAdminModal focus={open} onClose={() => setOpen(null)} onSaved={load} />}
    </section>
  );
}

/** Paramètres du centre de publication (administrateurs) : publication (qui peut publier) ou habillages. */
export function PublicationSettings({ section }: { section: "publication" | "habillages" }) {
  return <div className="mx-auto max-w-5xl space-y-5">{section === "publication" ? (
        <>
          <Publishers />
          <DeliveryDelays />
        </>
      ) : (
        <Habillages />
      )}</div>;
}
