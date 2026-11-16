// Public d'une publication ou d'un document FIEF — miroir de fief_audience_match()
// (sql/2026-11-16_fief_evolutions.sql) : « all » (toutes les membres) ou « custom » (des personnes,
// des fonctions — éducatrices, dirigeantes, joueuses… — ou des clubs). Partagé navigateur / serveur.

export interface FiefAudienceSel {
  ids: string[];
  functions: string[];
  clubs: string[];
}

export const EMPTY_SEL: FiefAudienceSel = { ids: [], functions: [], clubs: [] };

export const selCount = (s: FiefAudienceSel) => s.ids.length + s.functions.length + s.clubs.length;

/** Libellé court d'une sélection : « 3 personnes · 2 fonctions · 1 club ». */
export function selLabel(s: FiefAudienceSel) {
  const part = (n: number, one: string, many: string) => (n ? `${n} ${n > 1 ? many : one}` : null);
  return [part(s.ids.length, "personne", "personnes"), part(s.functions.length, "fonction", "fonctions"), part(s.clubs.length, "club", "clubs")].filter(Boolean).join(" · ") || "Personne";
}

export interface AudienceMember {
  userId: string;
  functions: string[];
  clubNumber: string | null;
}

/** La membre fait-elle partie d'un public « custom » ? */
export function inSelection(sel: FiefAudienceSel, m: AudienceMember) {
  return sel.ids.includes(m.userId) || m.functions.some((f) => sel.functions.includes(f)) || (!!m.clubNumber && sel.clubs.includes(m.clubNumber));
}
