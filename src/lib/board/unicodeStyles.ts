// Gras / italique pour Facebook et Instagram, qui n'ont pas de mise en forme : les lettres sont
// remplacées par leurs équivalents Unicode « mathématiques » sans empattement (𝗴𝗿𝗮𝘀, 𝘪𝘵𝘢𝘭𝘪𝘲𝘶𝘦),
// comme le font les outils en ligne. Les accents restent (lettre stylée + accent combinant).

export type UnicodeStyle = "bold" | "italic" | "boldItalic";

/** Premier point de code des majuscules, minuscules et chiffres de chaque style (Unicode, bloc 1D400). */
const BASES: Record<UnicodeStyle, { upper: number; lower: number; digit: number | null }> = {
  bold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  italic: { upper: 0x1d608, lower: 0x1d622, digit: null },
  boldItalic: { upper: 0x1d63c, lower: 0x1d656, digit: 0x1d7ec },
};

/** Caractère stylé → lettre ou chiffre d'origine, et son style. */
const REVERSE = new Map<string, { plain: string; style: UnicodeStyle }>();
for (const [style, b] of Object.entries(BASES) as [UnicodeStyle, (typeof BASES)[UnicodeStyle]][]) {
  for (let i = 0; i < 26; i++) {
    REVERSE.set(String.fromCodePoint(b.upper + i), { plain: String.fromCharCode(65 + i), style });
    REVERSE.set(String.fromCodePoint(b.lower + i), { plain: String.fromCharCode(97 + i), style });
  }
  // Chiffres gras communs à « bold » et « boldItalic » : rendus comme gras.
  if (b.digit !== null && style === "bold") for (let i = 0; i < 10; i++) REVERSE.set(String.fromCodePoint(b.digit + i), { plain: String(i), style });
}

const styleChar = (c: string, style: UnicodeStyle) => {
  const b = BASES[style];
  const code = c.charCodeAt(0);
  if (c.length === 1 && code >= 65 && code <= 90) return String.fromCodePoint(b.upper + code - 65);
  if (c.length === 1 && code >= 97 && code <= 122) return String.fromCodePoint(b.lower + code - 97);
  if (c.length === 1 && code >= 48 && code <= 57 && b.digit !== null) return String.fromCodePoint(b.digit + code - 48);
  return c;
};

/** Texte remis en caractères ordinaires (accents recomposés). */
export function toPlain(text: string) {
  return [...text].map((c) => REVERSE.get(c)?.plain ?? c).join("").normalize("NFC");
}

/** Texte entièrement dans ce style (au moins une lettre stylée, aucune lettre ordinaire). */
function isStyled(text: string, style: UnicodeStyle) {
  let any = false;
  for (const c of text) {
    const r = REVERSE.get(c);
    if (r) {
      if (r.style !== style && !(style === "boldItalic" && /\d/.test(r.plain))) return false;
      any = true;
    } else if (/[A-Za-z]/.test(c.normalize("NFD"))) return false;
  }
  return any;
}

/** Applique le style au texte, ou le retire s'il l'a déjà (bouton bascule). */
export function toggleStyle(text: string, style: UnicodeStyle) {
  const plain = toPlain(text);
  if (isStyled(text, style)) return plain;
  return [...plain.normalize("NFD")].map((c) => styleChar(c, style)).join("");
}
