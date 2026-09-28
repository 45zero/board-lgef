/** Contacts club (export fédéral des présidents) — partagé client/serveur, sans dépendance. */

export interface ClubContact {
  civility: string | null;
  firstName: string | null;
  lastName: string | null;
  clubNumber: string | null;
  club: string | null;
  /** Mobile au format E.164 (+33…) quand il est reconnu, sinon tel quel. */
  phone: string | null;
  /** Email principal d'envoi : email officiel du club, à défaut l'email perso (null : contact joignable par mobile seulement). */
  email: string | null;
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
  clubNumber: ["clubnumero", "numeroclub", "numero"],
  // Annuaire des commissions : la commission tient lieu de « club ».
  club: ["clubnom", "club", "nomclub", "nomcommission", "commission"],
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

/**
 * Nom à mettre après « Bonjour » : prénom + nom s'ils sont connus, sinon le nom saisi — sauf quand ce nom n'est que
 * celui du club (club importé sans président) : on renvoie "" pour un simple « Bonjour, ».
 */
export function greetingName(p: {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  club?: string | null;
}) {
  const full = personName({ first_name: p.first_name, last_name: p.last_name });
  if (full) return full;
  const name = p.name?.trim() ?? "";
  return name && name !== p.club?.trim() ? name : "";
}

/** Lien wa.me (ouvre WhatsApp avec le message prérempli) — null si pas de mobile exploitable. */
export function whatsappUrl(phone: string | null, text: string) {
  if (!phone || !phone.startsWith("+")) return null;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`;
}

/**
 * Lit les lignes d'un export (1re ligne = en-têtes) : export clubs fédéral, ou annuaire des commissions
 * (« Nom commission » au lieu de « Club(nom) »). Ignore les lignes sans email ni mobile.
 * Une même personne présente sur plusieurs lignes (plusieurs commissions) est fusionnée : ses commissions
 * sont regroupées (« Arbitrage · Discipline »).
 */
export function parseClubExportRows(rows: unknown[][]): { contacts: ClubContact[]; skipped: number } {
  if (rows.length === 0) throw new Error("Fichier vide.");
  const headers = rows[0].map(normalizeHeader);
  const idx = (keys: readonly string[]) => headers.findIndex((h) => keys.includes(h));
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, keys]) => [k, idx(keys)])) as Record<
    keyof typeof COLUMNS,
    number
  >;
  // Nom/Prénom facultatifs : un fichier « clubs seuls » (numéro, club, email officiel) complète l'annuaire existant.
  if (col.club < 0 || (col.emailClub < 0 && col.emailPerso < 0 && col.phone < 0)) {
    throw new Error(
      "Colonnes attendues introuvables (Club(nom) ou Nom commission, Email principal / Email officiel club / Mobile)."
    );
  }

  const at = (r: unknown[], i: number) => (i >= 0 ? cell(r[i]) : null);
  const byKey = new Map<string, ClubContact>();
  let skipped = 0;
  for (const r of rows.slice(1)) {
    if (!r.some((v) => cell(v))) continue;
    const emailClub = at(r, col.emailClub)?.toLowerCase() ?? null;
    const emailPerso = at(r, col.emailPerso)?.toLowerCase() ?? null;
    const email = emailClub || emailPerso;
    const phone = normalizeFrPhone(col.phone >= 0 ? r[col.phone] : null);
    if (!email && !phone) {
      skipped += 1;
      continue;
    }
    const contact: ClubContact = {
      civility: at(r, col.civility),
      firstName: at(r, col.firstName),
      lastName: at(r, col.lastName),
      clubNumber: at(r, col.clubNumber),
      club: at(r, col.club),
      phone,
      email,
      emailSecondary: emailPerso && emailPerso !== email ? emailPerso : null,
    };

    // Un club = une ligne (numéro de club) ; sans numéro, une personne = son email, à défaut son mobile.
    const key = contact.clubNumber ? `club:${contact.clubNumber}` : `pers:${email ?? phone}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, contact);
      continue;
    }
    if (!contact.clubNumber && contact.club && !existing.club?.split(" · ").includes(contact.club)) {
      existing.club = existing.club ? `${existing.club} · ${contact.club}` : contact.club;
    }
    existing.phone ??= contact.phone;
    existing.emailSecondary ??= contact.emailSecondary;
  }
  return { contacts: [...byKey.values()], skipped };
}
