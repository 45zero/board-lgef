"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Copy, ExternalLink, Forward, Inbox, List, Mail, MessageSquare, Printer, Search, Settings, StickyNote, Trophy, UserRound } from "lucide-react";
import { unwrap } from "@/lib/board/actionResult";
import { Toggle } from "@/components/board/Toggle";
import { clearOpenTournoiParam, readOpenTournoiParam } from "@/lib/board/deepLink";
import {
  getTournoisOverview,
  listTournamentDeclarations,
  saveTournamentDistrict,
  saveTournamentSettings,
  setTournamentCategoryActive,
  updateTournamentDeclaration,
  type DeclarationListRow,
  type DistrictSettings,
  type TournoisOverview,
} from "@/app/actions/tournois-admin";
import { daysUntil, fmtPeriod, STATUS_LABELS, STATUS_TONES, type DeclarationStatus } from "@/lib/tournois/shared";
import { DossierPanel, type PanelAction } from "@/components/board/tournois/DossierPanel";

// Onglet Tournois du board : déclarations de tournois / rassemblements faites par les clubs sur /tournoi.
// « Déclarations » (à instruire), « Tournois à venir » (validés : la suite), « Tous », « Réglages »
// (districts : coordonnées + envoi automatique, catégories, délai).

type Tab = "inbox" | "upcoming" | "all" | "settings";

export function TournoisScreen() {
  const [tab, setTab] = useState<Tab>("inbox");
  const [overview, setOverview] = useState<TournoisOverview | null>(null);
  const [rows, setRows] = useState<DeclarationListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ id: string; action: PanelAction } | null>(null);
  const [district, setDistrict] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);

  const reloadOverview = useCallback(() => {
    getTournoisOverview()
      .then((r) => setOverview(unwrap(r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Onglet indisponible."));
  }, []);
  const reloadList = useCallback(() => {
    if (tab === "settings") return;
    listTournamentDeclarations(tab)
      .then((r) => setRows(unwrap(r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Liste indisponible."));
  }, [tab]);
  useEffect(reloadOverview, [reloadOverview]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- liste vidée au changement d'onglet, rechargée aussitôt
    setRows(null);
    reloadList();
  }, [reloadList]);

  // Lien d'une notification (/?app=tournois&openTournoi=<id>) : dossier ouvert d'emblée.
  useEffect(() => {
    const id = readOpenTournoiParam();
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique du lien direct
      setOpenId(id);
      clearOpenTournoiParam();
    }
  }, []);

  const districtName = useMemo(() => new Map((overview?.districts ?? []).map((d) => [d.code, d.short_name])), [overview]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Tri par date du tournoi : à venir / en cours du plus proche au plus lointain, puis les passés (le plus récent d'abord).
    const now = new Date().toISOString().slice(0, 10);
    return (rows ?? [])
      .filter(
        (r) =>
          (!district || r.districtCode === district) &&
          (!from || (r.endDate || r.startDate) >= from) &&
          (!to || r.startDate <= to) &&
          (!needle || `${r.ref} ${r.clubName} ${r.title} ${r.address}`.toLowerCase().includes(needle))
      )
      .sort((a, b) => {
        const pa = (a.endDate || a.startDate) < now;
        const pb = (b.endDate || b.startDate) < now;
        if (pa !== pb) return pa ? 1 : -1;
        return pa ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate);
      });
  }, [rows, district, q, from, to]);

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/tournoi` : "/tournoi";
  const tabs: { id: Tab; label: string; icon: typeof Inbox; badge?: number }[] = [
    { id: "inbox", label: "Déclarations", icon: Inbox, badge: overview?.counts.open },
    { id: "upcoming", label: "Tournois à venir", icon: CalendarDays, badge: overview?.counts.upcoming },
    { id: "all", label: "Tous", icon: List },
    { id: "settings", label: "Réglages", icon: Settings },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-white">
          <Trophy size={20} />
        </span>
        <div>
          <h1 className="text-lg font-extrabold text-ink">Tournois</h1>
          <p className="text-xs text-ink-3">Déclarations des tournois et rassemblements de jeunes</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(publicUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
            className="flex items-center gap-1.5 rounded-btn bg-card px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-hover"
          >
            <Copy size={13} /> {copied ? "Lien copié" : "Copier le lien du formulaire"}
          </button>
          <a href="/tournoi" target="_blank" rel="noopener" className="flex items-center gap-1.5 rounded-btn bg-card px-3 py-2 text-xs font-semibold text-link hover:bg-hover">
            Ouvrir le formulaire <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {overview && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Tile label="À traiter" value={overview.counts.open} accent onClick={() => setTab("inbox")} />
          <Tile label="Hors délai" value={overview.counts.late} accent onClick={() => setTab("inbox")} />
          <Tile label="Réponses non lues" value={overview.counts.unread} accent onClick={() => setTab("inbox")} />
          <Tile label="Tournois à venir" value={overview.counts.upcoming} onClick={() => setTab("upcoming")} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-btn px-3.5 py-2 text-sm font-semibold ${tab === t.id ? "bg-navy text-white" : "bg-card text-ink-2 hover:bg-hover"}`}
          >
            <t.icon size={15} /> {t.label}
            {!!t.badge && <span className={`rounded-full px-1.5 text-[11px] ${tab === t.id ? "bg-white/20" : "bg-red text-white"}`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}

      {tab === "settings" ? (
        overview && <SettingsTab overview={overview} onSaved={reloadOverview} />
      ) : (
        <section className="rounded-card border border-line bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <div className="relative min-w-[200px] flex-1">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher (club, tournoi, n° de dossier…)"
                className="w-full rounded-btn border border-line bg-card py-2 pl-8 pr-3 text-sm text-ink outline-none focus:border-navy"
              />
            </div>
            <select value={district} onChange={(e) => setDistrict(e.target.value)} className="rounded-btn border border-line bg-card px-2.5 py-2 text-sm text-ink">
              <option value="">Tous les districts</option>
              {(overview?.districts ?? [])
                .filter((d) => !d.is_ligue)
                .map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.short_name}
                  </option>
                ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-ink-3">
              Du
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-3">
              au
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm text-ink" />
            </label>
            {(from || to) && (
              <button onClick={() => { setFrom(""); setTo(""); }} className="rounded-btn px-2 py-1.5 text-xs font-semibold text-link hover:bg-hover">
                Effacer les dates
              </button>
            )}
          </div>
          {!rows ? (
            <p className="p-6 text-center text-sm text-ink-3">Chargement…</p>
          ) : filtered.length === 0 ? (
            <p className="p-10 text-center text-sm text-ink-3">
              {tab === "inbox" ? "Aucune déclaration à traiter." : tab === "upcoming" ? "Aucun tournoi validé à venir." : "Aucune déclaration."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {filtered.map((r) => (
                <li key={r.id}>
                  <DeclarationRow
                    row={r}
                    district={r.districtCode ? districtName.get(r.districtCode) ?? null : null}
                    upcoming={tab === "upcoming"}
                    managers={overview?.managers ?? []}
                    onOpen={() => setOpenId(r.id)}
                    onAction={(action) => setQuick({ id: r.id, action })}
                    onAssign={async (userId) => {
                      const res = await updateTournamentDeclaration(r.id, { assignedTo: userId });
                      if (!res.ok) setError(res.error);
                      reloadList();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {quick && overview && (
        <DossierPanel
          key={`${quick.id}-${JSON.stringify(quick.action)}`}
          id={quick.id}
          overview={overview}
          action={quick.action}
          onClose={() => {
            setQuick(null);
            reloadList();
          }}
          onChanged={() => {
            reloadList();
            reloadOverview();
          }}
        />
      )}

      {openId && overview && (
        <DossierPanel
          id={openId}
          overview={overview}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            reloadList();
            reloadOverview();
          }}
        />
      )}
    </div>
  );
}

function Tile({ label, value, accent, onClick }: { label: string; value: number; accent?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="rounded-card border border-line bg-card px-4 py-3 text-left hover:bg-hover">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">{label}</p>
      <p className={`mt-0.5 text-2xl font-extrabold ${accent && value > 0 ? "text-red" : "text-ink"}`}>{value}</p>
    </button>
  );
}

function DeclarationRow({
  row: r,
  district,
  upcoming,
  managers,
  onOpen,
  onAction,
  onAssign,
}: {
  row: DeclarationListRow;
  district: string | null;
  upcoming: boolean;
  managers: { id: string; name: string }[];
  onOpen: () => void;
  onAction: (a: PanelAction) => void;
  onAssign: (userId: string | null) => void;
}) {
  const days = daysUntil(r.startDate);
  const quick = "flex items-center gap-1 rounded-btn border border-line bg-card px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-hover";
  const mini = "rounded-btn border border-line bg-card px-1.5 py-1 text-xs font-semibold text-ink-2";
  return (
    <div className="px-4 py-3 hover:bg-hover/40">
      <button onClick={onOpen} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left">
        <div className="w-24 shrink-0">
          <p className="text-xs font-bold text-ink-3">{r.ref}</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-ink">{r.title}</p>
          <p className="truncate text-sm text-ink-2">
            {r.clubName}
            {district ? ` · ${district}` : ""}
          </p>
          <p className="truncate text-xs text-ink-4">{r.categories.join(" · ")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-ink">{fmtPeriod(r.startDate, r.endDate)}</p>
          <p className="text-xs text-ink-4">
            {upcoming ? (days === 0 ? "aujourd'hui" : days > 0 ? `dans ${days} j` : "en cours") : `déposée le ${new Date(r.submittedAt).toLocaleDateString("fr-FR")}`}
          </p>
          <div className="mt-1 flex justify-end gap-1">
            {r.late && (
              <span className="flex items-center gap-1 rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-semibold text-warn">
                <AlertTriangle size={11} /> Hors délai
              </span>
            )}
            {r.unread > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-red px-2 py-0.5 text-[11px] font-semibold text-white">
                <MessageSquare size={11} /> {r.unread}
              </span>
            )}
            {r.opinion && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.opinion === "yes" ? "bg-good-bg text-good" : "bg-bad-bg text-bad"}`}>
                Avis {r.opinion === "yes" ? "favorable" : "défavorable"}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Actions directes, sans ouvrir le dossier */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-0 sm:pl-28">
        <button onClick={() => onAction({ type: "forward", to: "district" })} className={quick}>
          <Forward size={13} /> District
        </button>
        <button onClick={() => onAction({ type: "forward", to: "ligue" })} className={quick}>
          <Forward size={13} /> Ligue
        </button>
        <button onClick={() => onAction({ type: "mail" })} className={quick}>
          <Mail size={13} /> Écrire au club
        </button>
        <button onClick={() => onAction({ type: "note" })} className={quick}>
          <StickyNote size={13} /> Note
        </button>
        <a href={`/api/tournoi/pdf?d=${r.id}`} target="_blank" rel="noopener" className={quick}>
          <Printer size={13} /> PDF
        </a>
        <select
          aria-label="Statut"
          value={r.status}
          onChange={(e) => {
            const status = e.target.value as DeclarationStatus;
            if (status !== r.status) onAction({ type: "status", status });
          }}
          className={mini}
        >
          {(Object.keys(STATUS_LABELS) as DeclarationStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-ink-3">
          <UserRound size={13} />
          <select aria-label="Suivi par" value={r.assignedTo ?? ""} onChange={(e) => onAssign(e.target.value || null)} className={mini}>
            <option value="">Non assigné</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// --- Réglages ----------------------------------------------------------------------------------------

function SettingsTab({ overview, onSaved }: { overview: TournoisOverview; onSaved: () => void }) {
  const [days, setDays] = useState(String(overview.minNoticeDays));
  const [intro, setIntro] = useState(overview.introText ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveGeneral = async () => {
    setBusy(true);
    setMsg(null);
    try {
      unwrap(await saveTournamentSettings({ minNoticeDays: Number(days), introText: intro }));
      setMsg("Enregistré.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-line bg-card p-4">
        <h2 className="font-extrabold text-ink">Districts et ligue</h2>
        <p className="mb-3 text-sm text-ink-3">
          Coordonnées utilisées pour les envois depuis un dossier. Cochez « Envoi automatique » pour que chaque nouvelle déclaration d&apos;un club du district lui parte dès le dépôt
          (récapitulatif PDF, pièces et bouton « Répondre »). Pour la ligue : toutes les déclarations.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {overview.districts.map((d) => (
            <DistrictCard key={d.code} district={d} onSaved={onSaved} />
          ))}
        </div>
      </section>

      <section className="rounded-card border border-line bg-card p-4">
        <h2 className="font-extrabold text-ink">Catégories proposées</h2>
        <p className="mb-3 text-sm text-ink-3">Une catégorie désactivée n&apos;apparaît plus dans le formulaire (les dossiers existants la gardent).</p>
        <div className="flex flex-wrap gap-3">
          {overview.categories.map((c) => (
            <CategoryToggle key={c.slug} slug={c.slug} label={c.label} active={c.active} onSaved={onSaved} />
          ))}
        </div>
      </section>

      <section className="rounded-card border border-line bg-card p-4">
        <h2 className="font-extrabold text-ink">Formulaire</h2>
        <label className="mt-3 block max-w-xs">
          <span className="mb-1 block text-sm font-semibold text-ink-2">Délai minimum avant la manifestation (jours)</span>
          <input type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink" />
          <span className="mt-1 block text-xs text-ink-4">En deçà, la déclaration reste possible mais elle est marquée « hors délai ».</span>
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-semibold text-ink-2">Texte d&apos;accueil du formulaire (facultatif)</span>
          <textarea rows={3} value={intro} onChange={(e) => setIntro(e.target.value)} className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink" />
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={saveGeneral} disabled={busy} className="rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            Enregistrer
          </button>
          {msg && <span className="text-sm text-ink-3">{msg}</span>}
        </div>
      </section>
    </div>
  );
}

function CategoryToggle({ slug, label, active, onSaved }: { slug: string; label: string; active: boolean; onSaved: () => void }) {
  const [on, setOn] = useState(active);
  return (
    <label className="flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm font-semibold text-ink-2">
      <Toggle
        on={on}
        onClick={async () => {
          const next = !on;
          setOn(next);
          const r = await setTournamentCategoryActive(slug, next);
          if (!r.ok) setOn(!next);
          else onSaved();
        }}
      />
      {label}
    </label>
  );
}

function DistrictCard({ district: d, onSaved }: { district: DistrictSettings; onSaved: () => void }) {
  const [contactName, setContactName] = useState(d.contact_name ?? "");
  const [emails, setEmails] = useState(d.emails.join(", "));
  const [phone, setPhone] = useState(d.phone ?? "");
  const [address, setAddress] = useState(d.address ?? "");
  const [autoSend, setAutoSend] = useState(d.auto_send);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = "w-full rounded-btn border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-navy";

  const save = async (nextAuto = autoSend) => {
    setBusy(true);
    setMsg(null);
    try {
      unwrap(
        await saveTournamentDistrict(d.code, {
          contactName,
          emails: emails
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          phone,
          address,
          autoSend: nextAuto,
        })
      );
      setMsg("Enregistré");
      onSaved();
    } catch (e) {
      setAutoSend(d.auto_send);
      setMsg(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-card border p-3 ${autoSend ? "border-navy" : "border-line"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-bold text-ink">{d.name}</p>
        <label className="flex items-center gap-2 text-xs font-semibold text-ink-2">
          Envoi automatique
          <Toggle
            on={autoSend}
            disabled={busy}
            onClick={() => {
              const next = !autoSend;
              setAutoSend(next);
              void save(next);
            }}
          />
        </label>
      </div>
      <div className="grid gap-2">
        <input className={field} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Service / contact (ex. Commission foot d'animation)" />
        <input className={field} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="Adresse(s) e-mail, séparées par des virgules" />
        <div className="grid grid-cols-2 gap-2">
          <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Téléphone" />
          <input className={field} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Adresse" />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => save()} disabled={busy} className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
          Enregistrer
        </button>
        {msg && <span className="text-xs text-ink-3">{msg}</span>}
      </div>
    </div>
  );
}
