"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Settings2, ShieldCheck } from "lucide-react";
import { getHabillageSettings } from "@/app/actions/board-settings";
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
  return <div className="mx-auto max-w-5xl space-y-5">{section === "publication" ? <Publishers /> : <Habillages />}</div>;
}
