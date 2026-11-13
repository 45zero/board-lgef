"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Megaphone, MousePointerClick, Pencil, Plus, Trash2 } from "lucide-react";
import { Toggle } from "@/components/board/Toggle";
import { listFiefAds, type FiefAdRow } from "@/app/actions/fief-admin";

// Onglet FIEF → Publicités : annonces « Sponsorisé » de la colonne de droite de fief.lgef.fr (comme sur
// Facebook). Image, titre, texte, annonceur, lien, période de diffusion, ordre ; clics comptés.
// Enregistrement par /api/fief/ads (image dans le Drive du board, FIEF / Publicités).

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : null);

function status(ad: FiefAdRow) {
  if (!ad.active) return { label: "Coupée", cls: "bg-subtle text-ink-3" };
  if (ad.startsOn && ad.startsOn > today()) return { label: "Programmée", cls: "bg-warn-bg text-warn" };
  if (ad.endsOn && ad.endsOn < today()) return { label: "Terminée", cls: "bg-subtle text-ink-3" };
  return { label: "En ligne", cls: "bg-good-bg text-good" };
}

export function FiefAdsAdmin() {
  const [ads, setAds] = useState<FiefAdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FiefAdRow | "new" | null>(null);

  const load = useCallback(() => {
    listFiefAds().then((r) => (r.ok ? setAds(r.data) : setError(r.error)));
  }, []);
  useEffect(load, [load]);

  const remove = async (ad: FiefAdRow) => {
    if (!window.confirm(`Supprimer la publicité « ${ad.title} » ?`)) return;
    const res = await fetch(`/api/fief/ads?id=${ad.id}`, { method: "DELETE" });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Suppression impossible.");
    load();
  };

  return (
    <section className="space-y-3 rounded-card border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-extrabold text-ink">
          <Megaphone size={16} /> Publicités « Sponsorisé »
        </h2>
        <p className="text-xs text-ink-3">Colonne de droite de fief.lgef.fr, sur ordinateur (6 au maximum à la fois).</p>
        <button onClick={() => setEditing("new")} className="ml-auto flex items-center gap-1.5 rounded-btn bg-navy px-3 py-2 text-sm font-bold text-white">
          <Plus size={14} /> Nouvelle publicité
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      {editing && (
        <AdForm
          ad={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {ads === null && !error && <p className="py-6 text-center text-sm text-ink-3">Chargement…</p>}
      {ads?.length === 0 && !editing && <p className="py-6 text-center text-sm text-ink-3">Aucune publicité pour l&apos;instant.</p>}
      <div className="divide-y divide-line">
        {ads?.map((ad) => {
          const st = status(ad);
          return (
            <div key={ad.id} className="flex flex-wrap items-center gap-3 py-3">
              {ad.hasImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/fief/ads/${ad.id}`} alt="" className="h-16 w-16 rounded-btn bg-subtle object-cover" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-btn bg-subtle text-ink-4">
                  <Megaphone size={20} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{ad.title}</p>
                <p className="truncate text-xs text-ink-3">
                  {[ad.advertiser, ad.linkUrl, fmt(ad.startsOn) && `du ${fmt(ad.startsOn)}`, fmt(ad.endsOn) && `au ${fmt(ad.endsOn)}`].filter(Boolean).join(" · ") || "Sans lien"}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
              <span className="flex items-center gap-1 text-xs text-ink-3" title="Clics des membres">
                <MousePointerClick size={13} /> {ad.clicks}
              </span>
              <button onClick={() => setEditing(ad)} aria-label="Modifier" className="rounded-btn p-1.5 text-ink-3 hover:bg-hover">
                <Pencil size={15} />
              </button>
              <button onClick={() => void remove(ad)} aria-label="Supprimer" className="rounded-btn p-1.5 text-ink-3 hover:bg-bad-bg hover:text-bad">
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const field = "w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-line-strong";

function AdForm({ ad, onClose, onSaved }: { ad: FiefAdRow | null; onClose: () => void; onSaved: () => void }) {
  const [active, setActive] = useState(ad?.active ?? true);
  const [preview, setPreview] = useState<string | null>(ad?.hasImage ? `/api/fief/ads/${ad.id}` : null);
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("active", String(active));
    form.set("remove_image", String(removeImage));
    if (ad) form.set("id", ad.id);
    const file = fileInput.current?.files?.[0];
    if (file) form.set("image", file);
    else form.delete("image");
    const res = await fetch("/api/fief/ads", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.ok) return setError(json.error ?? "Enregistrement impossible.");
    onSaved();
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-card border border-line bg-panel p-4 md:grid-cols-[160px_1fr]">
      <div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-btn border border-dashed border-line-strong bg-card text-ink-3 hover:bg-hover"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs">
              <ImagePlus size={22} /> Image (carrée)
            </span>
          )}
        </button>
        <input
          ref={fileInput}
          type="file"
          name="image"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setPreview(URL.createObjectURL(f));
              setRemoveImage(false);
            }
          }}
        />
        {preview && (
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setRemoveImage(true);
              if (fileInput.current) fileInput.current.value = "";
            }}
            className="mt-1 text-xs font-semibold text-bad hover:underline"
          >
            Retirer l&apos;image
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-xs font-semibold text-ink-3">Titre *</span>
          <input name="title" required maxLength={120} defaultValue={ad?.title ?? ""} className={field} />
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-semibold text-ink-3">Texte</span>
          <textarea name="body" rows={2} maxLength={500} defaultValue={ad?.body ?? ""} className={field} />
        </label>
        <label>
          <span className="text-xs font-semibold text-ink-3">Annonceur (affiché sous le titre)</span>
          <input name="advertiser" maxLength={80} defaultValue={ad?.advertiser ?? ""} placeholder="ex. partenaire.fr" className={field} />
        </label>
        <label>
          <span className="text-xs font-semibold text-ink-3">Lien (https://…)</span>
          <input name="link_url" type="url" maxLength={500} defaultValue={ad?.linkUrl ?? ""} className={field} />
        </label>
        <label>
          <span className="text-xs font-semibold text-ink-3">Début de diffusion</span>
          <input name="starts_on" type="date" defaultValue={ad?.startsOn ?? ""} className={field} />
        </label>
        <label>
          <span className="text-xs font-semibold text-ink-3">Fin de diffusion</span>
          <input name="ends_on" type="date" defaultValue={ad?.endsOn ?? ""} className={field} />
        </label>
        <label>
          <span className="text-xs font-semibold text-ink-3">Ordre (0 = en premier)</span>
          <input name="position" type="number" min={0} max={999} defaultValue={ad?.position ?? 0} className={field} />
        </label>
        <input type="hidden" name="link_label" value="" />
        <div className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2">
          <Toggle on={active} onClick={() => setActive((v) => !v)} /> Diffusée
        </div>
        {error && <p className="text-sm text-bad sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" disabled={busy} className="rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" onClick={onClose} className="rounded-btn px-3 py-2 text-sm font-semibold text-ink-3 hover:bg-hover">
            Annuler
          </button>
        </div>
      </div>
    </form>
  );
}
