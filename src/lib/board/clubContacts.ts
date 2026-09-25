/** Contacts club (export fédéral des présidents) — partagé client/serveur, sans dépendance. */

export interface ClubContact {
  civility: string | null;
  firstName: string | null;
  lastName: string | null;
  clubNumber: string | null;
  club: string | null;
  /** Mobile au format E.164 (+33…) quand il est reconnu, sinon tel quel. */
  phone: string | null;
  /** Email principal d'envoi : email officiel du club, à défaut l'email perso. */
  email: string;
  /** Second destinataire (email perso), s'il diffère de l'email principal. */
  emailSecondary: string | null;
}

function normalizeHeader(h: unknown) {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function cell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Colonnes de l'export « Civilité, Titre, Nom, Prénom, Club(numéro), Club(nom), Mobile personnel, Email principal, Email officiel club ». */
const COLUMNS = {
  civility: ["civilite"],
  lastName: ["nom"],
  firstName: ["prenom"],
  clubNumber: ["clubnumero", "numeroclub"],
  club: ["clubnom", "club", "nomclub"],
  phone: ["mobilepersonnel", "mobile", "telephone", "portable"],
  emailPerso: ["emailprincipal", "emailpersonnel", "mailperso"],
  emailClub: ["emailofficielclub", "emailclub", "mailclub"],
} as const;

/** Mobile français → E.164. Excel perd le 0 initial (612345678) : on le rétablit. */
export function normalizeFrPhone(raw: unknown): string | null {
  const s = cell(raw);
  if (!s) return null;
  let digits = s.replace(/\D/g, "");
  if (digits.startsWith("0033")) digits = digits.slice(4);
  else if (digits.startsWith("33") && digits.length === 11) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 10) digits = digits.slice(1);
  if (digits.length === 9 && /^[1-9]/.test(digits)) return `+33${digits}`;
  return s;
}

/** +33612345678 → 06 12 34 56 78 (affichage). */
export function formatFrPhone(phone: string | null): string {
  if (!phone) return "";
  const m = phone.match(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : phone;
}

/** « JEAN-PIERRE » / « DE LA FONTAINE » → « Jean-Pierre » / « De La Fontaine ». */
function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** « Prénom Nom » lisible à partir des champs séparés, sinon le nom libre. */
export function personName(p: { first_name?: string | null; last_name?: string | null; name?: string | null }) {
  const full = [p.first_name, p.last_name]
    .filter(Boolean)
    .map((s) => titleCase(s!))
    .join(" ");
  return full || p.name || "";
}

/** Lien wa.me (ouvre WhatsApp avec le message prérempli) — null si pas de mobile exploitable. */
export function whatsappUrl(phone: string | null, text: string) {
  if (!phone || !phone.startsWith("+")) return null;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`;
}

/** Lit les lignes d'un export clubs (1re ligne = en-têtes). Ignore les lignes sans aucun email. */
export function parseClubExportRows(rows: unknown[][]): { contacts: ClubContact[]; skipped: number } {
  if (rows.length === 0) throw new Error("Fichier vide.");
  const headers = rows[0].map(normalizeHeader);
  const idx = (keys: readonly string[]) => headers.findIndex((h) => keys.includes(h));
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, keys]) => [k, idx(keys)])) as Record<
    keyof typeof COLUMNS,
    number
  >;
  if (col.lastName < 0 || col.club < 0 || (col.emailClub < 0 && col.emailPerso < 0)) {
    throw new Error("Colonnes attendues introuvables (Nom, Club(nom), Email principal / Email officiel club).");
  }

  const at = (r: unknown[], i: number) => (i >= 0 ? cell(r[i]) : null);
  const contacts: ClubContact[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    if (!r.some((v) => cell(v))) continue;
    const emailClub = at(r, col.emailClub)?.toLowerCase() ?? null;
    const emailPerso = at(r, col.emailPerso)?.toLowerCase() ?? null;
    const email = emailClub || emailPerso;
    if (!email) {
      skipped += 1;
      continue;
    }
    contacts.push({
      civility: at(r, col.civility),
      firstName: at(r, col.firstName),
      lastName: at(r, col.lastName),
      clubNumber: at(r, col.clubNumber),
      club: at(r, col.club),
      phone: normalizeFrPhone(col.phone >= 0 ? r[col.phone] : null),
      email,
      emailSecondary: emailPerso && emailPerso !== email ? emailPerso : null,
    });
  }
  return { contacts, skipped };
}
