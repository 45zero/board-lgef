// Import de la liste des clubs (fichier de la ligue, ex. liste_club_form_hydromatchok.xlsx) dans
// public.tournament_clubs — recherche de club du formulaire de déclaration de tournoi.
// Usage : node --env-file=.env.local scripts/import-tournament-clubs.mjs <fichier.xlsx>
// Relançable : mise à jour par n° d'affiliation ; les clubs absents du fichier passent « inactifs ».

import ExcelJS from "exceljs";
import pg from "pg";

const file = process.argv[2];
if (!file) throw new Error("Usage : node --env-file=.env.local scripts/import-tournament-clubs.mjs <fichier.xlsx>");

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.worksheets[0];

const cols = {};
ws.getRow(1).eachCell((c, i) => (cols[String(c.value).trim()] = i));
for (const h of ["Club", "Numéro", "Gestionnaire", "Code postal (club)", "Bureau distributeur (club)"]) {
  if (!cols[h]) throw new Error(`Colonne manquante : ${h}`);
}

const cell = (row, header) => {
  if (!cols[header]) return null;
  const v = row.getCell(cols[header]).value;
  if (v == null) return null;
  const s = typeof v === "object" ? (v.text ?? v.result ?? v.hyperlink ?? "") : v;
  return String(s).replace(/^mailto:/i, "").trim() || null;
};
const phone = (s) => {
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  return /^\d{9}$/.test(digits) ? `0${digits}` : digits || null; // Excel a mangé le 0 initial
};
const title = (s) => (s ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : null);

const clubs = new Map();
ws.eachRow((row, i) => {
  if (i === 1) return;
  const number = cell(row, "Numéro");
  const name = cell(row, "Club");
  if (!number || !name) return;
  clubs.set(number, {
    club_number: number,
    name,
    district_code: cell(row, "Gestionnaire"),
    address_line: cell(row, "Voie-rue (club)"),
    address_extra: [cell(row, "Complément (club)"), cell(row, "Lieu-dit (club)")].filter(Boolean).join(" — ") || null,
    postal_code: cell(row, "Code postal (club)"),
    city: title(cell(row, "Bureau distributeur (club)")),
    contact_civility: cell(row, "Civilité"),
    contact_first_name: title(cell(row, "Prénom")),
    contact_last_name: cell(row, "Nom"),
    contact_mobile: phone(cell(row, "Mobile personnel correspondant")),
    contact_email: cell(row, "Email principal correspondant")?.toLowerCase() ?? null,
    official_email: cell(row, "Email officiel club")?.toLowerCase() ?? null,
  });
});

const db = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await db.connect();
const { rows: districts } = await db.query("select code from public.tournament_districts");
const known = new Set(districts.map((d) => d.code));

const list = [...clubs.values()].map((c) => ({ ...c, district_code: known.has(c.district_code) ? c.district_code : null }));
const keys = Object.keys(list[0]);
await db.query("begin");
for (let i = 0; i < list.length; i += 200) {
  const chunk = list.slice(i, i + 200);
  const values = [];
  const tuples = chunk.map((c, j) => `(${keys.map((k, n) => (values.push(c[k]), `$${j * keys.length + n + 1}`)).join(", ")}, true, now())`);
  await db.query(
    `insert into public.tournament_clubs (${keys.join(", ")}, active, imported_at) values ${tuples.join(", ")}
     on conflict (club_number) do update set ${keys.filter((k) => k !== "club_number").map((k) => `${k} = excluded.${k}`).join(", ")},
       active = true, imported_at = now()`,
    values
  );
}
const { rowCount: retired } = await db.query("update public.tournament_clubs set active = false where active and not (club_number = any($1))", [[...clubs.keys()]]);
await db.query("commit");

const { rows: stats } = await db.query(
  `select coalesce(d.short_name, '(sans district)') district, count(*)::int n
   from public.tournament_clubs c left join public.tournament_districts d on d.code = c.district_code
   where c.active group by 1 order by 1`
);
console.log(`${list.length} clubs importés, ${retired} passés inactifs.`);
console.table(stats);
await db.end();
