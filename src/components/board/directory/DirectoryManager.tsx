"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Download, FileSpreadsheet, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  listContactLists,
  listContactListMembers,
  renameContactList,
  deleteContactList,
  createContactListMember,
  updateContactListMember,
  removeContactListMembers,
  importClubContactsIntoList,
  searchClubContacts,
  type ContactMemberInput,
} from "@/app/actions/registration";
import { parseClubExportRows, personName, formatFrPhone } from "@/lib/board/clubContacts";

export type ContactList = Awaited<ReturnType<typeof listContactLists>>[number];
type Member = Awaited<ReturnType<typeof listContactListMembers>>[number];

/** Lignes affichées d'un coup (un annuaire fédéral dépasse le millier de fiches). */
const PAGE = 200;

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function haystack(m: Member) {
  return normalize(
    [m.club, m.club_number, m.first_name, m.last_name, m.name, m.email, m.email_secondary, m.phone, m.city, m.postal_code].filter(Boolean).join(" ")
  );
}

const FIELDS: { key: keyof ContactMemberInput; label: string; type?: string; wide?: boolean }[] = [
  { key: "club", label: "Club / structure", wide: true },
  { key: "club_number", label: "N° club" },
  { key: "civility", label: "Civilité" },
  { key: "first_name", label: "Prénom" },
  { key: "last_name", label: "Nom" },
  { key: "email", label: "Email principal", type: "email" },
  { key: "email_secondary", label: "Email secondaire", type: "email" },
  { key: "phone", label: "Mobile (WhatsApp)", type: "tel" },
  { key: "address", label: "Adresse", wide: true },
  { key: "postal_code", label: "Code postal" },
  { key: "city", label: "Ville" },
];

/** Création / modification d'une fiche (tous les champs de l'annuaire). */
function MemberForm({
  member,
  onSave,
  onDelete,
  onClose,
}: {
  member: Member | null;
  onSave: (input: ContactMemberInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ContactMemberInput>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, (member?.[f.key as keyof Member] as string | null) ?? ""]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!form.email?.trim() && !form.phone?.trim()) return setError("Un email ou un mobile est nécessaire pour joindre ce contact.");
    if (!form.club?.trim() && !form.first_name?.trim() && !form.last_name?.trim()) return setError("Indiquez au moins un nom ou un club.");
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg space-y-3 rounded-modal border border-line bg-card p-5 shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">{member ? "Modifier la fiche" : "Nouvelle fiche"}</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map((f) => (
            <label key={f.key} className={`space-y-0.5 ${f.wide ? "col-span-2" : ""}`}>
              <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-ink-4">{f.label}</span>
              <input
                type={f.type ?? "text"}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && save()}
                className="w-full rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none"
              />
            </label>
          ))}
        </div>
        {error && <p className="text-[11px] text-bad">{error}</p>}
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              onClick={async () => {
                if (!confirm("Supprimer cette fiche de l'annuaire ?")) return;
                await onDelete();
                onClose();
              }}
              className="flex items-center gap-1 text-xs font-semibold text-red hover:underline"
            >
              <Trash2 size={12} /> Supprimer
            </button>
          )}
          <button onClick={onClose} className="ml-auto rounded-btn border border-line px-3 py-1.5 text-xs text-ink-2">
            Annuler
          </button>
          <button onClick={save} disabled={saving} className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Gestion complète d'un annuaire (onglet Inscriptions) : renommer, supprimer, importer / exporter
 * Excel, filtrer, créer / modifier / supprimer des fiches (seules ou en sélection), reprendre des
 * contacts d'autres annuaires. Ce sont les mêmes fiches que la Cartographie et les suggestions des mails.
 */
export function DirectoryManager({
  list,
  onChanged,
  onDeleted,
}: {
  list: ContactList;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [otherQuery, setOtherQuery] = useState("");
  const [otherResults, setOtherResults] = useState<Awaited<ReturnType<typeof searchClubContacts>> | null>(null);

  const reload = async () => {
    setMembers(await listContactListMembers(list.id));
    onChanged();
  };

  useEffect(() => {
    let alive = true;
    listContactListMembers(list.id).then((rows) => alive && setMembers(rows));
    return () => {
      alive = false;
    };
  }, [list.id]);

  const filtered = useMemo(() => {
    const q = normalize(filter.trim());
    if (!members) return [];
    return q ? members.filter((m) => haystack(m).includes(q)) : members;
  }, [members, filter]);
  const visible = filtered.slice(0, limit);
  const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeSelected = async () => {
    if (!confirm(`Supprimer ${selected.size} fiche${selected.size > 1 ? "s" : ""} de « ${list.name} » ?`)) return;
    await removeContactListMembers([...selected]);
    setSelected(new Set());
    await reload();
  };

  const saveName = async () => {
    if (renaming === null) return;
    if (renaming.trim() && renaming.trim() !== list.name) {
      await renameContactList(list.id, renaming);
      onChanged();
    }
    setRenaming(null);
  };

  /** Export clubs (.xlsx) lu dans le navigateur, envoyé par lots de 500 (limite de taille des actions serveur). */
  const importExcel = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const { readSheet } = await import("read-excel-file/browser");
      const { contacts, skipped } = parseClubExportRows((await readSheet(file)) as unknown[][]);
      let added = 0;
      let updated = 0;
      for (let i = 0; i < contacts.length; i += 500) {
        setImportMsg(`Import… ${i}/${contacts.length}`);
        const r = await importClubContactsIntoList(list.id, contacts.slice(i, i + 500));
        added += r.added;
        updated += r.updated;
      }
      setImportMsg(`${added} fiche(s) ajoutée(s), ${updated} complétée(s)${skipped ? ` — ${skipped} ligne(s) sans aucun contact ignorée(s)` : ""}.`);
      await reload();
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : "Échec de l'import.");
    } finally {
      setImporting(false);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const rowsToExport = selected.size > 0 ? filtered.filter((m) => selected.has(m.id)) : filtered;
      const extraKeys = [...new Set(rowsToExport.flatMap((m) => Object.keys((m.extra as Record<string, string> | null) ?? {})))];
      const header = ["N° club", "Club", "Civilité", "Prénom", "Nom", "Email principal", "Email secondaire", "Mobile", "Adresse", "Code postal", "Ville", ...extraKeys];
      const rows = rowsToExport.map((m) => {
        const extra = (m.extra as Record<string, string> | null) ?? {};
        return [
          m.club_number,
          m.club,
          m.civility,
          m.first_name,
          m.last_name,
          m.email,
          m.email_secondary,
          formatFrPhone(m.phone),
          m.address,
          m.postal_code,
          m.city,
          ...extraKeys.map((k) => extra[k] ?? null),
        ].map((v) => (v ? { value: String(v) } : null));
      });
      await writeXlsxFile([header.map((h) => ({ value: h, fontWeight: "bold" as const })), ...rows], {
        sheet: list.name.slice(0, 31),
        columns: header.map((_, i) => ({ width: [9, 32, 10, 16, 18, 30, 30, 15, 32, 10, 20][i] ?? 22 })),
        stickyRowsCount: 1,
      }).toFile(`annuaire-${normalize(list.name).replace(/[^a-z0-9]+/g, "-")}${filter || selected.size ? "-selection" : ""}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const searchOthers = async () => {
    if (!otherQuery.trim()) return setOtherResults(null);
    setOtherResults(await searchClubContacts(otherQuery.trim()));
  };

  const btn = "flex items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover disabled:opacity-50";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {renaming !== null ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={saveName}
              className="rounded-btn border border-line px-2 py-1 text-lg font-extrabold text-ink outline-none"
            />
            <Check size={16} className="text-ink-4" />
          </span>
        ) : (
          <button onClick={() => setRenaming(list.name)} title="Renommer" className="group flex items-center gap-1.5 text-left">
            <h2 className="text-lg font-extrabold text-ink">{list.name}</h2>
            <Pencil size={13} className="text-ink-4 opacity-0 group-hover:opacity-100" />
          </button>
        )}
        <span className="text-xs text-ink-4">
          {members ? `${members.length} fiche${members.length > 1 ? "s" : ""}` : "Chargement…"}
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          <label
            title="Export clubs : Civilité, Nom, Prénom, Club(numéro), Club(nom), Mobile personnel, Email principal, Email officiel club, adresse… — fusion, rien n'est écrasé"
            className={`${btn} cursor-pointer ${importing ? "pointer-events-none opacity-50" : ""}`}
          >
            <FileSpreadsheet size={13} /> {importing ? "Import…" : "Importer (.xlsx)"}
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) importExcel(file);
              }}
            />
          </label>
          <button onClick={exportExcel} disabled={exporting || !filtered.length} className={btn}>
            <Download size={13} /> {exporting ? "Export…" : selected.size ? `Exporter la sélection (${selected.size})` : "Exporter (.xlsx)"}
          </button>
          <button
            onClick={async () => {
              if (!confirm(`Supprimer l'annuaire « ${list.name} » et ses ${members?.length ?? 0} fiche(s) ? Irréversible.`)) return;
              await deleteContactList(list.id);
              onDeleted();
            }}
            className="flex items-center gap-1 px-1 text-xs font-semibold text-red hover:underline"
          >
            <Trash2 size={12} /> Supprimer l&rsquo;annuaire
          </button>
        </span>
      </div>
      {importMsg && <p className="text-xs font-semibold text-ink-2">{importMsg}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-btn border border-line bg-card px-2.5">
          <Search size={13} className="text-ink-4" />
          <input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Filtrer : club, n°, nom, email, mobile, ville…"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none"
          />
          {filter && (
            <button onClick={() => setFilter("")} className="text-ink-4 hover:text-ink">
              <X size={12} />
            </button>
          )}
        </div>
        {selected.size > 0 && (
          <>
            <button onClick={removeSelected} className={`${btn} text-red`}>
              <Trash2 size={13} /> Supprimer ({selected.size})
            </button>
            <button onClick={() => setSelected(new Set())} className={btn}>
              Désélectionner
            </button>
          </>
        )}
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white">
          <Plus size={13} /> Nouvelle fiche
        </button>
      </div>

      <details className="rounded-btn border border-line bg-card px-3 py-2 text-xs">
        <summary className="cursor-pointer font-semibold text-ink-2">Reprendre des contacts d&rsquo;un autre annuaire</summary>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={otherQuery}
            onChange={(e) => setOtherQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchOthers()}
            placeholder="Club, n°, nom, ville, email…"
            className="min-w-0 flex-1 rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none"
          />
          <button onClick={searchOthers} className={btn}>
            Chercher
          </button>
        </div>
        {otherResults && (
          <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
            {otherResults.length === 0 && <p className="text-ink-4">Aucun résultat.</p>}
            {otherResults.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-btn px-2 py-1 hover:bg-hover">
                <span className="min-w-0 truncate text-ink-2">
                  <span className="font-semibold text-ink">{r.club || personName(r)}</span>
                  {r.club && personName(r) && r.club !== personName(r) ? ` · ${personName(r)}` : ""}
                  <span className="text-ink-4"> · {[r.email, formatFrPhone(r.phone)].filter(Boolean).join(" · ")}</span>
                </span>
                <button
                  onClick={async () => {
                    await createContactListMember(list.id, {
                      first_name: r.first_name,
                      last_name: r.last_name ?? (r.first_name ? null : r.name),
                      club: r.club,
                      club_number: r.club_number,
                      email: r.email,
                      phone: r.phone,
                      city: r.city,
                    });
                    setOtherResults((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
                    await reload();
                  }}
                  className="shrink-0 font-semibold text-link hover:underline"
                >
                  Ajouter
                </button>
              </div>
            ))}
          </div>
        )}
      </details>

      <div className="min-h-0 flex-1 overflow-auto rounded-panel border border-line bg-card">
        {!members ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-4">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-4">
            {members.length === 0 ? "Annuaire vide — importez un fichier Excel ou créez une fiche." : "Aucune fiche ne correspond au filtre."}
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-subtle text-[10px] font-mono uppercase tracking-[0.08em] text-ink-4">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((m) => m.id)))}
                    title={allSelected ? "Tout désélectionner" : `Tout sélectionner (${filtered.length})`}
                  />
                </th>
                <th className="px-2 py-2">Club</th>
                <th className="px-2 py-2">Contact</th>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Mobile</th>
                <th className="px-2 py-2">Ville</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((m) => (
                <tr key={m.id} onClick={() => setEditing(m)} className={`cursor-pointer hover:bg-hover ${selected.has(m.id) ? "bg-sel-bg" : ""}`}>
                  <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                  </td>
                  <td className="max-w-[220px] truncate px-2 py-1.5 text-ink">
                    <span className="font-semibold">{m.club ?? "—"}</span>
                    {m.club_number && <span className="text-ink-4"> ({m.club_number})</span>}
                  </td>
                  <td className="max-w-[180px] truncate px-2 py-1.5 text-ink-2">{personName(m) || "—"}</td>
                  <td className="max-w-[240px] truncate px-2 py-1.5 text-ink-2" title={[m.email, m.email_secondary].filter(Boolean).join("\n")}>
                    {m.email ?? "—"}
                    {m.email_secondary && <span className="text-ink-4"> +1</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{formatFrPhone(m.phone) || "—"}</td>
                  <td className="max-w-[140px] truncate px-2 py-1.5 text-ink-3">{[m.postal_code, m.city].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-2 py-1.5 text-ink-4">
                    <Pencil size={11} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {filtered.length > limit && (
          <button onClick={() => setLimit((l) => l + PAGE)} className="w-full border-t border-line py-2 text-xs font-semibold text-link hover:bg-hover">
            Afficher plus ({filtered.length - limit} restante{filtered.length - limit > 1 ? "s" : ""})
          </button>
        )}
      </div>

      {editing && (
        <MemberForm
          member={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await createContactListMember(list.id, input);
            else await updateContactListMember(editing.id, input);
            await reload();
          }}
          onDelete={
            editing === "new"
              ? undefined
              : async () => {
                  await removeContactListMembers([editing.id]);
                  await reload();
                }
          }
        />
      )}
    </div>
  );
}
