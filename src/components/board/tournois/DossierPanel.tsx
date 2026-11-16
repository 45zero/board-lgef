"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Download,
  Eye,
  FileText,
  Folder,
  Forward,
  Loader2,
  Mail,
  MailCheck,
  MailX,
  MessageSquare,
  Pencil,
  Phone,
  Printer,
  Reply,
  StickyNote,
  X,
} from "lucide-react";
import { unwrap } from "@/lib/board/actionResult";
import {
  getTournamentDeclaration,
  getTournamentFolderUrl,
  sendTournamentMail,
  updateTournamentDeclaration,
  type DeclarationDetail,
  type ThreadMessage,
  type TournoisOverview,
} from "@/app/actions/tournois-admin";
import {
  CATERING_LABELS,
  FILE_KIND_LABELS,
  fmtHours,
  fmtPeriod,
  fmtSize,
  STATUS_LABELS,
  STATUS_TONES,
  yesNo,
  type DeclarationStatus,
} from "@/lib/tournois/shared";

// Fiche d'un dossier de tournoi (onglet Tournois) : déclaration complète, pièces, statut et avis,
// fil des échanges (envois avec suivi par destinataire, réponses venues du bouton « Répondre »),
// rédaction d'un mail / transfert / note.

type Role = "contact" | "club" | "district" | "ligue" | "other";
type Draft = {
  kind: "mail" | "forward" | "note";
  subject: string;
  body: string;
  recipients: { email: string; name: string | null; role: Role }[];
  fileIds: string[];
  includePdf: boolean;
  copyToSender: boolean;
};

const ROLE_LABELS: Record<string, string> = { contact: "Responsable", club: "Club", district: "District", ligue: "Ligue", sender: "Copie", other: "Autre" };
const fmtAt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Action lancée depuis la liste, sans ouvrir la fiche : seul le message à envoyer s'affiche. */
export type PanelAction = { type: "forward"; to: "district" | "ligue" } | { type: "mail" } | { type: "note" } | { type: "status"; status: DeclarationStatus };

export function DossierPanel({
  id,
  overview,
  onClose,
  onChanged,
  action,
}: {
  id: string;
  overview: TournoisOverview;
  onClose: () => void;
  onChanged: () => void;
  action?: PanelAction;
}) {
  const quick = !!action;
  const actionDone = useRef(false);
  const [detail, setDetail] = useState<DeclarationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getTournamentDeclaration(id)
      .then((r) => setDetail(unwrap(r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Dossier indisponible."));
  }, [id]);
  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !draft && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, onClose]);

  const d = detail?.declaration;
  const signature = `\n\nCordialement,\n${overview.me.name}\nLigue du Grand Est de Football`;

  /** Destinataires proposés : responsable, club (adresse officielle), district, ligue. */
  const suggestions = useMemo(() => {
    if (!detail || !d) return [];
    const list: { email: string; name: string | null; role: Role }[] = [{ email: d.contact_email, name: `${d.contact_first_name} ${d.contact_last_name}`, role: "contact" }];
    if (d.club_official_email) list.push({ email: d.club_official_email, name: d.club_name, role: "club" });
    for (const e of detail.district?.emails ?? []) list.push({ email: e, name: detail.district?.name ?? null, role: "district" });
    for (const e of detail.ligue?.emails ?? []) list.push({ email: e, name: detail.ligue?.name ?? null, role: "ligue" });
    return list;
  }, [detail, d]);

  const compose = (kind: Draft["kind"], preset?: Partial<Draft>) => {
    if (!d || !detail) return;
    const club = suggestions.filter((s) => s.role === "contact" || s.role === "club");
    const district = suggestions.filter((s) => s.role === "district");
    const base: Draft =
      kind === "forward"
        ? {
            kind,
            subject: `Déclaration de tournoi ${d.ref} — ${d.club_name}`,
            body: `Bonjour,\n\nVeuillez trouver ci-dessous la déclaration de tournoi « ${d.title} » du club ${d.club_name} (${fmtPeriod(d.start_date, d.end_date)}). Le récapitulatif et les pièces sont accessibles avec le bouton du message.${signature}`,
            recipients: preset?.recipients ?? district,
            fileIds: detail.files.filter((f) => f.kind !== "reply").map((f) => f.id),
            includePdf: true,
            copyToSender: false,
          }
        : kind === "note"
          ? { kind, subject: "", body: "", recipients: [], fileIds: [], includePdf: false, copyToSender: false }
          : { kind, subject: `Votre déclaration de tournoi ${d.ref} — ${d.title}`, body: `Bonjour,\n\n${signature}`, recipients: club, fileIds: [], includePdf: false, copyToSender: false };
    setDraft({ ...base, ...preset });
  };

  const patch = async (p: Parameters<typeof updateTournamentDeclaration>[1], then?: () => void) => {
    setBusy(true);
    try {
      unwrap(await updateTournamentDeclaration(id, p));
      load();
      onChanged();
      then?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible.");
    } finally {
      setBusy(false);
    }
  };

  /** Décision : statut changé puis mail au club proposé (pré-rempli, modifiable). */
  const decide = (status: DeclarationStatus) =>
    patch({ status }, () => {
      if (!d) return;
      const texts: Partial<Record<DeclarationStatus, string>> = {
        validated: `Bonjour,\n\nNous avons le plaisir de vous informer que votre déclaration de tournoi « ${d.title} » (${fmtPeriod(d.start_date, d.end_date)}) est validée.\n\nNous vous souhaitons une excellente manifestation.${signature}`,
        refused: `Bonjour,\n\nAprès étude, votre déclaration de tournoi « ${d.title} » (${fmtPeriod(d.start_date, d.end_date)}) ne peut pas être validée en l'état, pour la raison suivante :\n\n\n\nVous pouvez nous répondre avec le bouton « Répondre » de ce message.${signature}`,
        info_requested: `Bonjour,\n\nPour finaliser l'étude de votre déclaration de tournoi « ${d.title} », merci de nous transmettre :\n\n- \n\nVous pouvez répondre et joindre vos documents avec le bouton « Répondre » de ce message.${signature}`,
      };
      const subjects: Partial<Record<DeclarationStatus, string>> = {
        validated: `Tournoi validé — ${d.title} (${d.ref})`,
        refused: `Déclaration de tournoi ${d.ref} — décision`,
        info_requested: `Déclaration de tournoi ${d.ref} — complément demandé`,
      };
      if (texts[status]) compose("mail", { subject: subjects[status], body: texts[status] });
    });

  // Action rapide depuis la liste : lancée une fois, dès que le dossier est chargé.
  useEffect(() => {
    if (!action || !detail || actionDone.current) return;
    actionDone.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- action rapide lancée une seule fois après le chargement
    if (action.type === "forward") compose("forward", action.to === "ligue" ? { recipients: suggestions.filter((s) => s.role === "ligue") } : undefined);
    else if (action.type === "mail") compose("mail");
    else if (action.type === "note") compose("note");
    else if (action.status === "validated" || action.status === "refused" || action.status === "info_requested") void decide(action.status);
    else void patch({ status: action.status }, onClose);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois, au chargement du dossier
  }, [action, detail]);

  const openFolder = async () => {
    const r = await getTournamentFolderUrl(id);
    if (r.ok) window.open(r.data, "_blank", "noopener");
    else setError(r.error);
  };

  if (quick)
    return (
      <>
        {!draft && (
          <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-btn bg-ink px-4 py-2.5 text-sm text-white shadow-modal">
            {error ? (
              <>
                {error}
                <button onClick={onClose} className="font-semibold underline">
                  Fermer
                </button>
              </>
            ) : (
              <>
                <Loader2 size={15} className="animate-spin" /> Préparation…
              </>
            )}
          </div>
        )}
        {draft && detail && (
          <Composer
            draft={draft}
            setDraft={setDraft}
            suggestions={suggestions}
            files={detail.files}
            onClose={onClose}
            onSent={() => {
              onChanged();
              onClose();
            }}
            declarationId={id}
          />
        )}
      </>
    );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-3xl flex-col bg-shell shadow-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Dossier de tournoi">
        <div className="flex items-start gap-3 border-b border-line bg-card px-5 py-4">
          <div className="min-w-0 flex-1">
            {d ? (
              <>
                <p className="text-xs font-bold text-ink-3">
                  Dossier {d.ref} · déposé le {new Date(d.submitted_at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}
                </p>
                <h2 className="truncate text-lg font-extrabold text-ink">{d.title}</h2>
                <p className="text-sm text-ink-2">
                  {d.club_name}
                  {d.club_number ? ` (${d.club_number})` : ""} · {detail?.district?.name ?? "District inconnu"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONES[d.status]}`}>{STATUS_LABELS[d.status]}</span>
                  {d.late && (
                    <span className="flex items-center gap-1 rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn">
                      <AlertTriangle size={12} /> Hors délai
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-3">{error ?? "Chargement…"}</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-btn p-2 text-ink-3 hover:bg-hover" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        {d && detail && (
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <ActionButton icon={Mail} label="Écrire" onClick={() => compose("mail")} primary />
              <ActionButton icon={Forward} label="Transférer au district" onClick={() => compose("forward")} />
              <ActionButton icon={Forward} label="Transférer à la ligue" onClick={() => compose("forward", { recipients: suggestions.filter((s) => s.role === "ligue") })} />
              <ActionButton icon={StickyNote} label="Note interne" onClick={() => compose("note")} />
              <a href={`/api/tournoi/pdf?d=${d.id}`} target="_blank" rel="noopener" className="flex items-center gap-1.5 rounded-btn bg-card px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover">
                <Printer size={15} /> Imprimer / PDF
              </a>
              <ActionButton icon={Folder} label="Dossier Drive" onClick={openFolder} />
            </div>

            {/* Instruction */}
            <Section title="Instruction">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-ink-3">Statut</span>
                  <select
                    value={d.status}
                    disabled={busy}
                    onChange={(e) => {
                      const s = e.target.value as DeclarationStatus;
                      if (s === "validated" || s === "refused" || s === "info_requested") void decide(s);
                      else void patch({ status: s });
                    }}
                    className="w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm text-ink"
                  >
                    {(Object.keys(STATUS_LABELS) as DeclarationStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-ink-3">Suivi par (reçoit les réponses)</span>
                  <select
                    value={d.assigned_to ?? ""}
                    disabled={busy}
                    onChange={(e) => void patch({ assignedTo: e.target.value || null })}
                    className="w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm text-ink"
                  >
                    <option value="">Personne</option>
                    {overview.managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <OpinionEditor opinion={d.district_opinion} note={d.district_opinion_note ?? ""} busy={busy} onSave={(opinion, note) => patch({ districtOpinion: opinion, districtOpinionNote: note })} />
              {d.status === "received" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => decide("validated")} disabled={busy} className="flex items-center gap-1.5 rounded-btn bg-good px-3 py-2 text-sm font-bold text-white disabled:opacity-60">
                    <Check size={15} /> Valider
                  </button>
                  <button onClick={() => decide("info_requested")} disabled={busy} className="rounded-btn bg-warn-bg px-3 py-2 text-sm font-bold text-warn disabled:opacity-60">
                    Demander un complément
                  </button>
                  <button onClick={() => decide("refused")} disabled={busy} className="rounded-btn bg-bad-bg px-3 py-2 text-sm font-bold text-bad disabled:opacity-60">
                    Refuser
                  </button>
                </div>
              )}
            </Section>

            {/* Échanges */}
            <Section title={`Échanges (${detail.thread.length})`}>
              {detail.thread.length === 0 ? (
                <p className="text-sm text-ink-3">Aucun échange.</p>
              ) : (
                <div className="space-y-3">
                  {detail.thread.map((m) => (
                    <ThreadItem
                      key={m.id}
                      m={m}
                      onReply={() =>
                        compose("mail", {
                          subject: m.subject?.startsWith("Re:") ? m.subject : `Re: ${m.subject ?? ""}`,
                          recipients: m.fromEmail ? [{ email: m.fromEmail, name: m.author, role: suggestions.find((s) => s.email === m.fromEmail)?.role ?? "other" }] : [],
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </Section>

            {/* Déclaration */}
            <Section title="Manifestation">
              <Grid
                rows={[
                  ["Date", fmtPeriod(d.start_date, d.end_date)],
                  ["Horaires", fmtHours(d.start_time, d.end_time) || "—"],
                  ["Adresse", d.address],
                  ["Clubs attendus", d.clubs_expected?.toString() ?? "—"],
                  ["Équipes d'autres districts", yesNo(d.other_districts)],
                  ["Équipes d'autres pays", yesNo(d.other_countries)],
                ]}
              />
            </Section>

            <Section title="Responsable">
              <p className="font-semibold text-ink">
                {d.contact_first_name} {d.contact_last_name}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a href={`tel:${d.contact_phone}`} className="flex items-center gap-1 text-link hover:underline">
                  <Phone size={13} /> {d.contact_phone}
                </a>
                {d.contact_landline && (
                  <a href={`tel:${d.contact_landline}`} className="flex items-center gap-1 text-link hover:underline">
                    <Phone size={13} /> {d.contact_landline}
                  </a>
                )}
                <a href={`mailto:${d.contact_email}`} className="flex items-center gap-1 text-link hover:underline">
                  <Mail size={13} /> {d.contact_email}
                </a>
              </div>
              {(detail.clubContact || d.club_official_email) && (
                <div className="mt-3 rounded-btn bg-subtle px-3 py-2 text-xs text-ink-3">
                  <p className="font-semibold text-ink-2">Fiche du club (fichier de la ligue)</p>
                  {d.club_official_email && <p>Messagerie officielle : {d.club_official_email}</p>}
                  {detail.clubContact?.name && (
                    <p>
                      Correspondant : {detail.clubContact.name}
                      {detail.clubContact.mobile ? ` · ${detail.clubContact.mobile}` : ""}
                      {detail.clubContact.email ? ` · ${detail.clubContact.email}` : ""}
                    </p>
                  )}
                </div>
              )}
            </Section>

            <Section title="Organisation sportive">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-4">
                      <th className="py-1 pr-3">Catégorie</th>
                      <th className="py-1 pr-3">Nb équipes</th>
                      <th className="py-1 pr-3">Date</th>
                      <th className="py-1 pr-3">Joueurs / équipe</th>
                      <th className="py-1 pr-3">Nb remplaçants</th>
                      <th className="py-1">Pratique</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {detail.categories.map((c) => (
                      <tr key={c.category_slug} className="text-ink-2">
                        <td className="py-1.5 pr-3 font-semibold text-ink">{c.label}</td>
                        <td className="py-1.5 pr-3">{c.teams ?? "—"}</td>
                        <td className="py-1.5 pr-3">{c.play_date ? new Date(c.play_date + "T12:00:00").toLocaleDateString("fr-FR") : "—"}</td>
                        <td className="py-1.5 pr-3">{c.players_per_team ?? "—"}</td>
                        <td className="py-1.5 pr-3">{c.substitutes ?? "—"}</td>
                        <td className="py-1.5">{c.surface ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Grid
                rows={[
                  ["Charte des participants", yesNo(d.participant_charter)],
                  ["Messages éducatifs", d.educational_messages ?? "—"],
                  ["Feuilles de match au début", yesNo(d.match_sheets_at_start)],
                  ["Commission de discipline", yesNo(d.discipline_commission)],
                ]}
              />
            </Section>

            <Section title="Logistique">
              <Grid
                rows={[
                  ["Buvette", yesNo(d.refreshments)],
                  ["Pôle restauration", d.catering ? CATERING_LABELS[d.catering] : "—"],
                  ["Points chauds", yesNo(d.hot_points)],
                  ["Parkings", d.parking ?? "—"],
                  ["Secours", d.first_aid ?? "—"],
                  ["Spectateurs prévus", d.spectators_expected?.toString() ?? "—"],
                ]}
              />
              {d.animations && <TextBlock title="Animations" text={d.animations} />}
              {d.other_info && <TextBlock title="Informations diverses" text={d.other_info} />}
            </Section>

            <Section title={`Pièces (${detail.files.length})`}>
              {detail.files.length === 0 ? (
                <p className="text-sm text-ink-3">Aucune pièce.</p>
              ) : (
                <div className="space-y-2">
                  {detail.files.map((f) => (
                    <FileRow key={f.id} id={f.id} name={f.name} meta={`${FILE_KIND_LABELS[f.kind as keyof typeof FILE_KIND_LABELS] ?? "Pièce"} · ${fmtSize(f.size)} · ${fmtAt(f.createdAt)}`} />
                  ))}
                </div>
              )}
            </Section>

            <Section title="Historique">
              <ul className="space-y-1 text-xs text-ink-3">
                {detail.activity.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <Clock size={12} className="mt-0.5 shrink-0" />
                    <span>
                      {fmtAt(a.at)} — {a.actor} : {activityLabel(a.action, a.details)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}
      </div>

      {draft && detail && (
        <Composer
          draft={draft}
          setDraft={setDraft}
          suggestions={suggestions}
          files={detail.files}
          onClose={() => setDraft(null)}
          onSent={() => {
            setDraft(null);
            load();
            onChanged();
          }}
          declarationId={id}
        />
      )}
    </div>
  );
}

function activityLabel(action: string, details: Record<string, unknown>) {
  switch (action) {
    case "submitted":
      return `déclaration déposée${details.late ? " (hors délai)" : ""}`;
    case "status":
      return `statut « ${details.from} » → « ${details.to} »`;
    case "assigned":
      return details.to ? `dossier confié à ${details.to}` : "dossier sans suivi";
    case "opinion":
      return details.opinion ? `avis du district ${details.opinion === "yes" ? "favorable" : "défavorable"}` : "avis retiré";
    case "mail":
      return `message envoyé (${details.sent ?? 0} destinataire${Number(details.sent) > 1 ? "s" : ""}${details.failed ? `, ${details.failed} en échec` : ""})`;
    case "note":
      return "note interne";
    case "reply":
      return `réponse reçue de ${details.from}`;
    default:
      return action;
  }
}

function ActionButton({ icon: Icon, label, onClick, primary }: { icon: typeof Mail; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm font-semibold ${primary ? "bg-navy text-white hover:bg-navy-600" : "bg-card text-ink-2 hover:bg-hover"}`}
    >
      <Icon size={15} /> {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card p-4">
      <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function Grid({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-44 shrink-0 text-ink-4">{k}</dt>
          <dd className="min-w-0 text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-ink-4">{title}</p>
      <p className="whitespace-pre-line text-sm text-ink-2">{text}</p>
    </div>
  );
}

function FileRow({ id, name, meta }: { id: string; name: string; meta: string }) {
  return (
    <div className="flex items-center gap-3 rounded-btn border border-line px-3 py-2">
      <FileText size={17} className="shrink-0 text-navy" />
      <a href={`/api/tournoi/file?f=${id}`} target="_blank" rel="noopener" className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink hover:underline">{name}</span>
        <span className="block text-xs text-ink-4">{meta}</span>
      </a>
      <a href={`/api/tournoi/file?f=${id}&dl=1`} className="rounded-btn p-1.5 text-ink-3 hover:bg-hover" aria-label={`Télécharger ${name}`}>
        <Download size={15} />
      </a>
    </div>
  );
}

function OpinionEditor({ opinion, note, busy, onSave }: { opinion: "yes" | "no" | null; note: string; busy: boolean; onSave: (o: "yes" | "no" | null, note: string) => void }) {
  const [o, setO] = useState(opinion);
  const [n, setN] = useState(note);
  const dirty = o !== opinion || n !== note;
  return (
    <div className="mt-3">
      <span className="mb-1 block text-xs font-semibold text-ink-3">Avis du district</span>
      <div className="flex flex-wrap items-center gap-2">
        {(["yes", "no"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setO(o === v ? null : v)}
            className={`rounded-btn border px-3 py-1.5 text-sm font-semibold ${
              o === v ? (v === "yes" ? "border-good bg-good-bg text-good" : "border-bad bg-bad-bg text-bad") : "border-line bg-card text-ink-2"
            }`}
          >
            {v === "yes" ? "Favorable" : "Défavorable"}
          </button>
        ))}
        <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Commentaire (facultatif)" className="min-w-[180px] flex-1 rounded-btn border border-line bg-card px-2.5 py-1.5 text-sm text-ink" />
        {dirty && (
          <button onClick={() => onSave(o, n)} disabled={busy} className="rounded-btn bg-navy px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">
            Enregistrer
          </button>
        )}
      </div>
    </div>
  );
}

function DeliveryIcon({ r }: { r: ThreadMessage["recipients"][number] }) {
  if (r.repliedAt) return <Reply size={13} className="text-good" aria-label="A répondu" />;
  if (r.openedAt) return <Eye size={13} className="text-link" aria-label="A ouvert le dossier" />;
  if (r.delivery === "failed") return <MailX size={13} className="text-bad" aria-label="Échec" />;
  if (r.delivery === "sent") return <MailCheck size={13} className="text-ink-3" aria-label="Envoyé" />;
  return <Clock size={13} className="text-ink-4" aria-label="En attente" />;
}

function ThreadItem({ m, onReply }: { m: ThreadMessage; onReply: () => void }) {
  const [open, setOpen] = useState(m.kind === "reply" || m.kind === "note");
  const isReply = m.kind === "reply";
  const kindLabel = { mail: "Message", forward: "Transfert", auto: "Envoi automatique", note: "Note interne", reply: "Réponse" }[m.kind];
  return (
    <div className={`rounded-card border p-3 ${isReply ? "ml-6 border-navy/40 bg-sel-bg" : m.kind === "note" ? "border-warn/40 bg-warn-bg/40" : "border-line"}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left">
        {isReply ? <MessageSquare size={15} className="mt-0.5 shrink-0 text-navy" /> : m.kind === "note" ? <Pencil size={15} className="mt-0.5 shrink-0 text-warn" /> : <Mail size={15} className="mt-0.5 shrink-0 text-ink-3" />}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-4">
            {kindLabel} · {m.author}
            {isReply && m.fromEmail ? ` <${m.fromEmail}>` : ""} · {fmtAt(m.at)}
          </p>
          <p className="truncate text-sm font-semibold text-ink">{m.subject || "(sans objet)"}</p>
        </div>
      </button>
      {m.recipients.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.recipients.map((r) => (
            <span
              key={r.email}
              title={r.error ?? `${r.delivery === "sent" ? "Envoyé" : r.delivery === "failed" ? "Échec" : "En attente"}${r.openedAt ? ` · ouvert le ${fmtAt(r.openedAt)}` : ""}${r.repliedAt ? ` · a répondu le ${fmtAt(r.repliedAt)}` : ""}`}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${r.delivery === "failed" ? "border-bad/40 text-bad" : "border-line text-ink-2"}`}
            >
              <DeliveryIcon r={r} />
              <span className="font-semibold">{ROLE_LABELS[r.role] ?? r.role}</span> {r.name && r.name !== r.email ? `${r.name} · ` : ""}
              {r.email}
            </span>
          ))}
        </div>
      )}
      {open && (
        <>
          {m.body && <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{m.body}</p>}
          {(m.files.length > 0 || m.includePdf) && (
            <div className="mt-2 space-y-1.5">
              {m.includePdf && <p className="text-xs text-ink-3">+ récapitulatif PDF</p>}
              {m.files.map((f) => (
                <FileRow key={f.id} id={f.id} name={f.name} meta={`${FILE_KIND_LABELS[f.kind as keyof typeof FILE_KIND_LABELS] ?? "Pièce"} · ${fmtSize(f.size)}`} />
              ))}
            </div>
          )}
          {isReply && (
            <button onClick={onReply} className="mt-2 flex items-center gap-1 text-xs font-semibold text-link hover:underline">
              <Reply size={13} /> Répondre
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Composer({
  draft,
  setDraft,
  suggestions,
  files,
  onClose,
  onSent,
  declarationId,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  suggestions: { email: string; name: string | null; role: Role }[];
  files: DeclarationDetail["files"];
  onClose: () => void;
  onSent: () => void;
  declarationId: string;
}) {
  const [extra, setExtra] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; failed: { email: string; error: string }[] } | null>(null);
  const isNote = draft.kind === "note";
  const has = (email: string) => draft.recipients.some((r) => r.email === email);
  const toggle = (s: { email: string; name: string | null; role: Role }) =>
    setDraft({ ...draft, recipients: has(s.email) ? draft.recipients.filter((r) => r.email !== s.email) : [...draft.recipients, s] });
  const addExtra = () => {
    const emails = extra
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !has(e));
    if (!emails.length) return;
    setDraft({ ...draft, recipients: [...draft.recipients, ...emails.map((email) => ({ email, name: null, role: "other" as Role }))] });
    setExtra("");
  };

  const send = async () => {
    setError(null);
    setSending(true);
    try {
      const res = unwrap(
        await sendTournamentMail(declarationId, {
          kind: draft.kind,
          subject: draft.subject,
          body: draft.body,
          recipients: draft.recipients,
          copyToSender: draft.copyToSender,
          fileIds: draft.fileIds,
          includePdf: draft.includePdf,
        })
      );
      if (res.failed.length) setResult(res);
      else onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setSending(false);
    }
  };

  const title = { mail: "Nouveau message", forward: "Transférer le dossier", note: "Note interne" }[draft.kind];
  const all = [...suggestions, ...draft.recipients.filter((r) => !suggestions.some((s) => s.email === r.email))];

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col rounded-t-modal bg-card shadow-modal sm:rounded-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="font-extrabold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-btn p-1.5 text-ink-3 hover:bg-hover" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {!isNote && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-ink-3">Destinataires</p>
              <div className="flex flex-wrap gap-1.5">
                {all.map((s) => (
                  <button
                    key={s.email}
                    onClick={() => toggle(s)}
                    className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${has(s.email) ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-2 hover:bg-hover"}`}
                  >
                    {has(s.email) && <Check size={12} />}
                    <span className="font-semibold">{ROLE_LABELS[s.role]}</span> {s.email}
                  </button>
                ))}
              </div>
              {draft.kind === "forward" && draft.recipients.length === 0 && (
                <p className="mt-1.5 text-xs text-warn">Aucune adresse enregistrée pour ce destinataire : renseignez-la dans Tournois → Réglages, ou ajoutez-la ci-dessous.</p>
              )}
              <div className="mt-2 flex gap-2">
                <input
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExtra())}
                  placeholder="Autre adresse e-mail"
                  className="flex-1 rounded-btn border border-line bg-card px-2.5 py-1.5 text-sm text-ink"
                />
                <button onClick={addExtra} className="rounded-btn bg-subtle px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-hover">
                  Ajouter
                </button>
              </div>
            </div>
          )}
          <input
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            placeholder={isNote ? "Titre (facultatif)" : "Objet"}
            className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm font-semibold text-ink"
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            rows={isNote ? 5 : 11}
            placeholder={isNote ? "Visible seulement dans le board" : ""}
            className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink"
          />
          {!isNote && (
            <>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-ink-3">Pièces jointes (ouvertes avec le bouton du mail)</p>
                <label className="flex items-center gap-2 py-0.5 text-sm text-ink-2">
                  <input type="checkbox" checked={draft.includePdf} onChange={(e) => setDraft({ ...draft, includePdf: e.target.checked })} /> Récapitulatif de la déclaration (PDF)
                </label>
                {files.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 py-0.5 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      checked={draft.fileIds.includes(f.id)}
                      onChange={(e) => setDraft({ ...draft, fileIds: e.target.checked ? [...draft.fileIds, f.id] : draft.fileIds.filter((x) => x !== f.id) })}
                    />
                    {FILE_KIND_LABELS[f.kind as keyof typeof FILE_KIND_LABELS] ?? "Pièce"} — {f.name}
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={draft.copyToSender} onChange={(e) => setDraft({ ...draft, copyToSender: e.target.checked })} /> Me mettre en copie
              </label>
              <p className="text-xs text-ink-4">
                Envoyé depuis l&apos;adresse du board, un e-mail par destinataire avec un bouton « Répondre » : les réponses reviennent dans ce dossier et vous êtes prévenu(e).
              </p>
            </>
          )}
          {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
          {result && (
            <div className="rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn">
              {result.sent} envoyé{result.sent > 1 ? "s" : ""}, {result.failed.length} en échec : {result.failed.map((f) => f.email).join(", ")} ({result.failed[0]?.error}).
              <button onClick={onSent} className="ml-2 font-semibold underline">
                Fermer
              </button>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onClose} className="rounded-btn px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover">
            Annuler
          </button>
          <button onClick={send} disabled={sending || !!result} className="flex items-center gap-2 rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            {sending ? <Loader2 size={15} className="animate-spin" /> : isNote ? <StickyNote size={15} /> : <Mail size={15} />}
            {isNote ? "Enregistrer la note" : `Envoyer${draft.recipients.length ? ` (${draft.recipients.length})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
