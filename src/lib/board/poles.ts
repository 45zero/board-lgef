// Pôles fusionnés. La base garde deux spécialités par pôle (org-formation pour un Organisateur,
// tech-formation pour un Technicien — héritage de calendrier-lgef) qui donnent exactement les mêmes
// droits : ouvrir les événements de ce type. À l'écran, un pôle = une case, qui pose ou retire les deux.

export type SpecialtyLite = { slug: string; label: string; domain: string };
export type Pole = { key: string; label: string; slugs: string[] };

export function buildPoles(specialties: SpecialtyLite[]): Pole[] {
  const key = (slug: string) => slug.replace(/^(org|tech)-/, "").replace(/_/g, "-");
  const poles = new Map<string, Pole>();
  for (const s of specialties) {
    if (!s.slug.startsWith("org-")) continue;
    poles.set(key(s.slug), { key: key(s.slug), label: s.label, slugs: [s.slug] });
  }
  for (const s of specialties) {
    if (s.domain !== "technician" || !s.slug.startsWith("tech-")) continue;
    const pole = poles.get(key(s.slug));
    if (pole) pole.slugs.push(s.slug);
  }
  return [...poles.values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
}
