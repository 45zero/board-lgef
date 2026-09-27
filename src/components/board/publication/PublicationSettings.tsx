"use client";

import { useEffect, useState } from "react";
import { Palette, Search, ShieldCheck, X } from "lucide-react";
import { getPublisherSettings, setPublishers } from "@/app/actions/board-settings";
import { HabillageAdminModal } from "@/components/board/publication/HabillageAdminModal";

type Member = { id: string; name: string; email: string | null; role: string | null };

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const isAdminRole = (role: string | null) => role === "admin" || role === "super_user";

/**
 * Paramètres du centre de publication (administrateurs) : qui peut publier — seules ces personnes
 * voient le centre et sont notifiées des médias à publier — et habillages des photos.
 */
export function PublicationSettings() {
  const [data, setData] = useState<{ ids: string[]; members: Member[] } | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [habillageOpen, setHabillageOpen] = useState(false);

  useEffect(() => {
    getPublisherSettings()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const save = async (ids: string[]) => {
    setData((d) => (d ? { ...d, ids } : d));
    setError(null);
    setSaved(false);
    try {
      await setPublishers(ids);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  };

  if (error && !data) return <p className="p-6 text-sm text-bad">{error}</p>;
  if (!data) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;

  const admins = data.members.filter((m) => isAdminRole(m.role));
  const chosen = data.members.filter((m) => data.ids.includes(m.id));
  const q = normalize(query.trim());
  const matches = q
    ? data.members.filter((m) => !isAdminRole(m.role) && !data.ids.includes(m.id) && normalize(`${m.name} ${m.email ?? ""}`).includes(q)).slice(0, 8)
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="rounded-panel border border-line bg-card p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={17} className="text-navy" />
          <h3 className="text-sm font-extrabold text-ink">Qui peut publier</h3>
        </div>
        <p className="mt-1 text-xs text-ink-3">
          Seules ces personnes voient le centre de publication, peuvent publier sur les réseaux et reçoivent une notification quand des médias sont à
          publier. Les administrateurs y ont toujours accès.
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {chosen.length === 0 && <span className="text-xs italic text-ink-4">Personne en dehors des administrateurs.</span>}
          {chosen.map((m) => (
            <span key={m.id} className="flex items-center gap-1 rounded-full bg-sel-bg px-2.5 py-1 text-xs font-semibold text-link">
              {m.name}
              <button onClick={() => void save(data.ids.filter((id) => id !== m.id))} className="hover:text-bad" aria-label={`Retirer ${m.name}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>

        <div className="relative mt-3 max-w-sm">
          <div className="flex items-center gap-2 rounded-btn border border-line px-2.5 py-1.5">
            <Search size={13} className="text-ink-4" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ajouter une personne…" className="w-full bg-transparent text-sm outline-none" />
          </div>
          {matches.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-btn border border-line bg-card p-1 shadow-modal">
              {matches.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setQuery("");
                    void save([...data.ids, m.id]);
                  }}
                  className="block w-full truncate rounded-btn px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-hover"
                >
                  {m.name} <span className="text-[11px] text-ink-4">{m.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 text-[11px] text-ink-4">Administrateurs (toujours habilités) : {admins.map((a) => a.name).join(", ") || "—"}</div>
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
        {saved && !error && <p className="mt-2 text-xs text-good">Enregistré.</p>}
      </section>

      <section className="rounded-panel border border-line bg-card p-5">
        <div className="flex items-center gap-2">
          <Palette size={17} className="text-navy" />
          <h3 className="text-sm font-extrabold text-ink">Habillages des publications</h3>
        </div>
        <p className="mt-1 text-xs text-ink-3">
          Gabarits appliqués aux photos publiées depuis le mobile : taille du logo et du texte, signature, gabarits intégrés, calques PNG personnalisés
          (1080 × 1350 px et 1080 × 1080 px).
        </p>
        <button onClick={() => setHabillageOpen(true)} className="mt-3 rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white">
          Modifier les habillages
        </button>
      </section>

      {habillageOpen && <HabillageAdminModal onClose={() => setHabillageOpen(false)} />}
    </div>
  );
}
