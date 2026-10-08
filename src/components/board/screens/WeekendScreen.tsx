"use client";

import { readCache, writeCache } from "@/lib/board/localCache";
import { getPeriodCosts } from "@/app/actions/staff";
import { euros } from "@/lib/board/staff";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Hand,
  MapPin,
  Pencil,
  Plus,
  Send,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from "lucide-react";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { EventArrow } from "@/components/board/calendar/EventOpener";
import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";
import { uploadEventFiles } from "@/lib/board/eventFiles";
import {
  claimMission,
  deleteMatch,
  getWeekend,
  releaseMission,
  saveMatch,
  searchProfiles,
  sendToNetwork,
  setCoverageMember,
} from "@/app/actions/weekend";
import { listAccessRequests, type AccessRequest } from "@/app/actions/account-requests";
import { AccessRequestCard } from "@/components/board/users/AccessRequestCard";
import { unwrap, type ActionResult } from "@/lib/board/actionResult";
import {
  buildRecap,
  COMPETITION_SUGGESTIONS,
  dayHeading,
  groupMatches,
  LEVEL_SUGGESTIONS,
  matchLabel,
  REGION_LABELS,
  REGION_ORDER,
  regionsGroupLabel,
  shiftWeekend,
  weekendLabel,
  weekendOf,
  type MatchInput,
  type PersonLite,
  type WeekendData,
  type WeekendMatch,
} from "@/lib/board/weekend";
import type { FacebookRegion } from "@/lib/social/targets";

const btnPrimary = "flex items-center gap-1.5 rounded-btn bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-600 disabled:opacity-50";
const btnGhost = "flex items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover disabled:opacity-50";
const btnSmall = "flex items-center gap-1 rounded-btn px-2.5 py-1.5 text-xs font-bold disabled:opacity-50";
const input = "w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm outline-none focus:border-navy";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Une erreur est survenue.");

type RegionFilter = FacebookRegion | "all";

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------- Pastilles photo / vidéo ---------- */

function PhotoPill({ match, meId }: { match: WeekendMatch; meId: string }) {
  const p = match.photo;
  if (!p) return null;
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold";
  if (p.status === "draft") return <span className={`${base} bg-subtle text-ink-3`}><Camera size={11} /> Brouillon</span>;
  if (p.status === "open") return <span className={`${base} bg-warn-bg text-warn`}><Camera size={11} /> Proposé au réseau</span>;
  const mine = p.photographer?.id === meId;
  return (
    <span className={`${base} bg-good-bg text-good`}>
      <Camera size={11} /> {mine ? "Vous" : p.photographer?.name ?? "Photographe"}
      {p.publisher && <span className="font-normal opacity-80"> · publi {p.publisher.firstName}</span>}
    </span>
  );
}

function VideoPill({ match }: { match: WeekendMatch }) {
  const v = match.video;
  if (!v) return null;
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold";
  if (v.state === "accepted") return <span className={`${base} bg-good-bg text-good`}><Video size={11} /> {v.technician ?? "Vidéo"}</span>;
  if (v.state === "no") return <span className={`${base} bg-bad-bg text-bad`}><Video size={11} /> Refusée</span>;
  if (v.state === "pending")
    return <span className={`${base} bg-warn-bg text-warn`} title="Proposé, réponse attendue"><Video size={11} /> {v.technician} (en attente)</span>;
  return <span className={`${base} bg-warn-bg text-warn`} title="Personne n'est désigné : à attribuer depuis l'événement"><Video size={11} /> Vidéo à pourvoir</span>;
}

function PhotosProgress({ match }: { match: WeekendMatch }) {
  if (match.photosPublished) return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-good"><Check size={11} /> Photos publiées</span>;
  if (match.photoCount > 0) return <span className="text-[11px] font-semibold text-ink-3">{match.photoCount} photo{match.photoCount > 1 ? "s" : ""} reçue{match.photoCount > 1 ? "s" : ""}</span>;
  return null;
}

/* ---------- Ligne d'un match ---------- */

function MatchRow({
  match,
  data,
  now,
  onEdit,
  onChanged,
}: {
  match: WeekendMatch;
  data: WeekendData;
  now: number;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { runTask } = useBackgroundTasks();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { viewer } = data;
  const p = match.photo;
  const mine = p?.status === "taken" && p.photographer?.id === viewer.id;
  const upcoming = new Date(match.start).getTime() > now;

  const run = async (fn: () => Promise<ActionResult<unknown>>) => {
    setBusy(true);
    setError(null);
    try {
      unwrap(await fn());
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const upload = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    void runTask(
      `Photos — ${match.details?.homeTeam ?? match.title}`,
      async ({ setProgress }) => {
        const results = await uploadEventFiles(match.eventId, files, (sent, total, current) => setProgress(total ? sent / total : undefined, current));
        const ok = results.filter((r) => r.ok).length;
        if (ok === 0) throw new Error("Aucune photo n'a pu être envoyée.");
        onChanged();
        return ok;
      },
      { success: (n) => `${n} photo${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""} — elles rejoignent l'album à publier.` }
    );
  };

  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
      <div className="w-12 shrink-0 font-mono text-xs font-bold text-ink-3">{fmtTime(match.start)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold text-ink">{match.details ? matchLabel(match.details) : match.title}</span>
          <EventArrow eventId={match.eventId} className="h-6 w-6 shrink-0" />
        </div>
        {match.location && (
          <div className="flex items-center gap-1 truncate text-[11px] text-ink-4">
            <MapPin size={10} /> {match.location}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <PhotoPill match={match} meId={viewer.id} />
          <VideoPill match={match} />
          <PhotosProgress match={match} />
        </div>
        {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {p?.status === "open" && (viewer.isPhotographer || viewer.canCoordinate) && upcoming && (
          <button disabled={busy} onClick={() => run(() => claimMission(p.missionId))} className={`${btnSmall} bg-good text-white`}>
            <Hand size={12} /> Je prends
          </button>
        )}
        {mine && (
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} className={`${btnSmall} bg-navy text-white`}>
              <Upload size={12} /> Déposer les photos
            </button>
            {upcoming && (
              <button
                disabled={busy}
                onClick={() => confirm("Vous désister ? Le match sera de nouveau proposé au réseau.") && run(() => releaseMission(p!.missionId))}
                className={`${btnSmall} border border-line text-ink-3 hover:bg-hover`}
              >
                Me désister
              </button>
            )}
          </>
        )}
        {viewer.canCoordinate && (
          <>
            <button onClick={onEdit} title="Modifier" className="rounded-btn p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
              <Pencil size={14} />
            </button>
            <button
              disabled={busy}
              title="Supprimer le match"
              onClick={() => confirm(`Supprimer « ${match.title} » ?`) && run(() => deleteMatch(match.eventId))}
              className="rounded-btn p-1.5 text-ink-3 hover:bg-bad-bg hover:text-bad"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Saisie d'un match ---------- */

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function emptyForm(weekendStart: Date, previous?: FormState): FormState {
  const sat = new Date(weekendStart.getFullYear(), weekendStart.getMonth(), weekendStart.getDate() + 1, 15, 0);
  return {
    date: previous?.date ?? toLocalInput(sat.toISOString()).date,
    time: previous?.time ?? "15:00",
    location: "",
    competition: previous?.competition ?? "",
    homeTeam: "",
    homeLevel: "",
    awayTeam: "",
    awayLevel: "",
    regions: previous?.regions ?? [],
    photo: previous?.photo ?? true,
    photographerId: "",
    publisherId: previous?.publisherId ?? "",
    video: false,
    videographerId: "",
  };
}

type FormState = Omit<MatchInput, "start" | "photographerId" | "publisherId" | "videographerId"> & {
  date: string;
  time: string;
  photographerId: string;
  publisherId: string;
  videographerId: string;
};

function formFromMatch(m: WeekendMatch): FormState {
  const { date, time } = toLocalInput(m.start);
  return {
    date,
    time,
    location: m.location,
    competition: m.details?.competition ?? "",
    homeTeam: m.details?.homeTeam ?? m.title,
    homeLevel: m.details?.homeLevel ?? "",
    awayTeam: m.details?.awayTeam ?? "",
    awayLevel: m.details?.awayLevel ?? "",
    regions: m.details?.regions ?? [],
    photo: !!m.photo,
    photographerId: m.photo?.status === "taken" ? m.photo.photographer?.id ?? "" : "",
    publisherId: m.photo?.publisher?.id ?? "",
    video: !!m.video,
    videographerId: m.video && m.video.state !== "no" ? m.video.technicianId ?? "" : "",
  };
}

/** Le match tel qu'il vient d'être enregistré, pour l'afficher sans attendre le rechargement. */
function savedMatch(id: string, input: MatchInput, data: WeekendData, previous: WeekendMatch | null): WeekendMatch {
  const person = (list: PersonLite[], pid: string | null) => (pid ? list.find((p) => p.id === pid) ?? null : null);
  const photographer = person(data.photographers, input.photographerId);
  const videographer = person(data.videographers, input.videographerId ?? null);
  return {
    eventId: id,
    title: matchLabel(input),
    start: input.start,
    location: input.location.trim(),
    details: {
      competition: input.competition.trim(),
      homeTeam: input.homeTeam.trim(),
      homeLevel: input.homeLevel.trim(),
      awayTeam: input.awayTeam.trim(),
      awayLevel: input.awayLevel.trim(),
      regions: input.regions,
    },
    photo: input.photo
      ? {
          missionId: previous?.photo?.missionId ?? "",
          status: photographer ? "taken" : previous?.photo?.status === "open" ? "open" : (previous?.photo?.status ?? "draft"),
          photographer,
          publisher: person(data.publishers, input.publisherId),
        }
      : null,
    video: input.video
      ? previous?.video && (!videographer || previous.video.technicianId === videographer.id)
        ? previous.video
        : { state: videographer ? "pending" : "open", technician: videographer?.name ?? null, technicianId: videographer?.id ?? null }
      : null,
    photoCount: previous?.photoCount ?? 0,
    photosPublished: previous?.photosPublished ?? false,
  };
}

function MatchForm({
  weekendStart,
  match,
  data,
  onClose,
  onSaved,
}: {
  weekendStart: Date;
  match: WeekendMatch | null;
  data: WeekendData;
  onClose: () => void;
  /** Match tel qu'enregistré, affiché tout de suite dans la liste (avant le rechargement). */
  onSaved: (saved: WeekendMatch) => void;
}) {
  const [form, setForm] = useState<FormState>(() => (match ? formFromMatch(match) : emptyForm(weekendStart)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const homeRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleRegion = (r: FacebookRegion) =>
    set("regions", form.regions.includes(r) ? form.regions.filter((x) => x !== r) : [...form.regions, r]);

  // Verrou immédiat : `busy` ne désactive les boutons qu'au rendu suivant — un double clic (ou Entrée
  // puis clic) créait le match en double, avec deux propositions envoyées au vidéaste.
  const submitting = useRef(false);
  const submit = async (again: boolean) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const start = new Date(`${form.date}T${form.time || "15:00"}`);
      const input = {
        ...form,
        start: start.toISOString(),
        photographerId: form.photo ? form.photographerId || null : null,
        publisherId: form.photo ? form.publisherId || null : null,
        videographerId: form.video ? form.videographerId || null : null,
      };
      const id = unwrap(await saveMatch(input, match?.eventId));
      onSaved(savedMatch(id, input, data, match));
      if (again) {
        // Enchaîner la saisie : même jour, compétition, pages et relais ; équipes et lieu vidés.
        setForm((f) => emptyForm(weekendStart, f));
        setSavedCount((n) => n + 1);
        homeRef.current?.focus();
      } else onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-4";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">{weekendLabel(weekendStart)}</div>
            <h3 className="mt-1 text-base font-extrabold">{match ? "Modifier le match" : "Nouveau match"}</h3>
            {savedCount > 0 && <div className="mt-0.5 text-xs text-white/80">{savedCount} match{savedCount > 1 ? "s" : ""} ajouté{savedCount > 1 ? "s" : ""}</div>}
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <form
          className="flex-1 space-y-4 overflow-y-auto p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(!match);
          }}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Date</label>
              <input type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Coup d&apos;envoi</label>
              <input type="time" required value={form.time} onChange={(e) => set("time", e.target.value)} className={input} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className={label}>Compétition</label>
              <input list="weekend-competitions" required value={form.competition} onChange={(e) => set("competition", e.target.value)} placeholder="CF-CA 4T" className={input} />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_84px] gap-2">
            <div>
              <label className={label}>Domicile</label>
              <input ref={homeRef} required value={form.homeTeam} onChange={(e) => set("homeTeam", e.target.value)} placeholder="Seebach" className={input} autoFocus />
            </div>
            <div>
              <label className={label}>Niveau</label>
              <input list="weekend-levels" value={form.homeLevel} onChange={(e) => set("homeLevel", e.target.value)} placeholder="D2" className={input} />
            </div>
            <div>
              <label className={label}>Extérieur</label>
              <input required value={form.awayTeam} onChange={(e) => set("awayTeam", e.target.value)} placeholder="Oberschaeffolsheim" className={input} />
            </div>
            <div>
              <label className={label}>Niveau</label>
              <input list="weekend-levels" value={form.awayLevel} onChange={(e) => set("awayLevel", e.target.value)} placeholder="R3" className={input} />
            </div>
          </div>

          <div>
            <label className={label}>Stade / adresse</label>
            <input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Stade municipal, 67160 Seebach" className={input} />
          </div>

          <div>
            <label className={label}>Pages où publier</label>
            <div className="flex flex-wrap gap-2">
              {REGION_ORDER.map((r) => (
                <FilterChip key={r} active={form.regions.includes(r)} onClick={() => toggleRegion(r)}>
                  {REGION_LABELS[r]}
                </FilterChip>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-btn border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" checked={form.photo} onChange={(e) => set("photo", e.target.checked)} />
              <Camera size={14} /> À photographier
            </label>
            {form.photo && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label}>Photographe</label>
                  <select value={form.photographerId} onChange={(e) => set("photographerId", e.target.value)} className={input}>
                    <option value="">Proposer au réseau</option>
                    {data.photographers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>Relais publication</label>
                  <select value={form.publisherId} onChange={(e) => set("publisherId", e.target.value)} className={input}>
                    <option value="">Aucun</option>
                    {data.publishers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" checked={form.video} disabled={!!match?.video} onChange={(e) => set("video", e.target.checked)} />
              <Video size={14} /> Demande vidéo
            </label>
            {form.video && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label}>Vidéaste</label>
                  <select value={form.videographerId} onChange={(e) => set("videographerId", e.target.value)} className={input}>
                    <option value="">Proposer au réseau</option>
                    {data.videographers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {match?.video && (
                  <p className="self-end pb-2 text-xs text-ink-4">
                    {match.video.state === "accepted"
                      ? `Confirmé par ${match.video.technician}`
                      : match.video.state === "pending"
                        ? `Demande envoyée à ${match.video.technician}, réponse attendue`
                        : match.video.state === "no"
                          ? "Demande refusée — choisissez un autre vidéaste"
                          : "Personne de désigné pour l'instant"}
                  </p>
                )}
              </div>
            )}
          </div>

          <datalist id="weekend-competitions">
            {COMPETITION_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
          </datalist>
          <datalist id="weekend-levels">
            {LEVEL_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
          </datalist>

          {error && <p className="text-sm text-bad">{error}</p>}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {!match ? (
              <>
                <button type="button" disabled={busy} onClick={() => void submit(false)} className={btnGhost}>
                  Enregistrer et fermer
                </button>
                <button type="submit" disabled={busy} className={btnPrimary}>
                  <Plus size={14} /> Enregistrer et ajouter un autre
                </button>
              </>
            ) : (
              <button type="submit" disabled={busy} className={btnPrimary}>
                <Check size={14} /> Enregistrer
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- Couverture match ---------- */

type NetworkMember = WeekendData["network"][number];

function TradeToggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      title={on ? `Retirer : ${label}` : `Ajouter : ${label}`}
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${on ? "bg-good-bg text-good" : "bg-subtle text-ink-4 hover:bg-hover"}`}
    >
      {icon} {label}
    </button>
  );
}

function NetworkModal({
  network,
  requests,
  onClose,
  onChanged,
}: {
  network: NetworkMember[];
  requests: AccessRequest[] | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonLite[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = window.setTimeout(() => {
      searchProfiles(q).then(unwrap).then(setResults).catch((e) => setError(errorMessage(e)));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const toggle = async (id: string, trade: "photo" | "video", member: boolean) => {
    setError(null);
    try {
      unwrap(await setCoverageMember(id, trade, member));
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const byId = new Map(network.map((m) => [m.person.id, m]));
  const photoCount = network.filter((m) => m.photo).length;
  const videoCount = network.filter((m) => m.video).length;
  const trades = (id: string, name: string) => {
    const m = byId.get(id);
    return (
      <div className="flex shrink-0 gap-1">
        <TradeToggle
          on={!!m?.photo}
          icon={<Camera size={11} />}
          label="Photo"
          onClick={() => (!m?.photo || confirm(`Retirer ${name} des photographes ?`)) && void toggle(id, "photo", !m?.photo)}
        />
        <TradeToggle
          on={!!m?.video}
          icon={<Video size={11} />}
          label="Vidéo"
          onClick={() => (!m?.video || confirm(`Retirer ${name} des vidéastes ?`)) && void toggle(id, "video", !m?.video)}
        />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Couverture match</div>
            <h3 className="mt-1 text-base font-extrabold">
              {photoCount} photographe{photoCount > 1 ? "s" : ""} · {videoCount} vidéaste{videoCount > 1 ? "s" : ""}
            </h3>
            <div className="mt-0.5 text-xs text-white/80">
              Les photographes reçoivent les matchs proposés et cliquent « Je prends » ; les vidéastes sont proposés pour les captations.
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {notice && <div className="rounded-btn bg-sel-bg px-3 py-2 text-xs font-semibold text-ink">{notice}</div>}
          {requests && requests.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-4">Demandes d&apos;accès ({requests.length})</div>
              <div className="overflow-hidden rounded-btn border border-warn">
                {requests.map((r) => (
                  <AccessRequestCard
                    key={r.id}
                    request={r}
                    onDone={(message) => {
                      setNotice(message);
                      onChanged();
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ajouter : nom ou e-mail d'un compte du board…" className={input} />
            {query.trim().length >= 2 && (
              <div className="mt-1 overflow-hidden rounded-btn border border-line">
                {results.length === 0 && <div className="px-3 py-2 text-xs text-ink-4">Aucun compte trouvé.</div>}
                {results.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0">
                    <span className="min-w-0 truncate text-sm text-ink">{p.name}</span>
                    {trades(p.id, p.name)}
                  </div>
                ))}
              </div>
            )}
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="overflow-hidden rounded-btn border border-line">
            {network.length === 0 && <div className="px-3 py-3 text-sm text-ink-4">Personne dans Couverture match pour l&apos;instant.</div>}
            {network.map(({ person }) => (
              <div key={person.id} className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0">
                <span className="min-w-0 truncate text-sm font-semibold text-ink">{person.name}</span>
                {trades(person.id, person.name)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Écran ---------- */

/**
 * Week-end : les matchs à couvrir, groupés par page régionale puis par jour (même lecture que le
 * récap envoyé jusqu'ici à la main, qui se génère maintenant d'un clic). Coordinateurs : saisie,
 * envoi au réseau Couverture match, désignation. Photographes : « Je prends », dépôt des photos.
 */
export function WeekendScreen() {
  const [range, setRange] = useState(() => weekendOf(new Date()));
  const [data, setData] = useState<WeekendData | null>(null);
  // Week-end dont les données sont affichées : différent de `range` pendant un changement de semaine.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<RegionFilter>("all");
  const [onlyMine, setOnlyMine] = useState(false);
  const [editing, setEditing] = useState<WeekendMatch | "new" | null>(null);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const rangeKey = range.start.toISOString();
  const loading = loadedKey !== rangeKey;
  // Listes du réseau (photographes, vidéastes, relais) : chargées une fois, puis seulement quand le
  // réseau change ; les rechargements après chaque match ne demandent que les matchs.
  const peopleLoaded = useRef(false);
  const load = useCallback(
    (withPeople = false) => {
      const people = withPeople || !peopleLoaded.current;
      return getWeekend(range.start.toISOString(), range.end.toISOString(), people)
        .then(unwrap)
        .then((d) => {
          if (people) peopleLoaded.current = true;
          setData((prev) => {
            const next = people || !prev ? d : { ...d, photographers: prev.photographers, videographers: prev.videographers, network: prev.network, publishers: prev.publishers };
            writeCache(`weekend:${range.start.toISOString()}`, next);
            return next;
          });
          setError(null);
        })
        .catch((e) => setError(errorMessage(e)))
        .finally(() => {
          setLoadedKey(range.start.toISOString());
          setNow(Date.now());
        });
    },
    [range]
  );

  useEffect(() => {
    // Week-end déjà vu : affiché tout de suite (navigateur), puis rafraîchi.
    const cached = readCache<WeekendData>(`weekend:${range.start.toISOString()}`);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- version connue d'abord, puis le réseau
      setData(cached);
      setLoadedKey(range.start.toISOString());
    }
    void load();
  }, [load, range]);
  // Coût du week-end pour un N+1 (ses N-1) ou un administrateur (tout le monde) : null pour les autres.
  const [cost, setCost] = useState<{ key: string; value: { confirmed: number; pending: number; people: number } | null } | null>(null);
  const loadCost = useCallback(async () => {
    const res = await getPeriodCosts(range.start.toISOString(), range.end.toISOString());
    setCost({ key: rangeKey, value: res.ok ? res.data : null });
  }, [range, rangeKey]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void loadCost();
  }, [loadCost]);
  const weekendCost = cost?.key === rangeKey ? cost.value : null;
  useLiveRefresh(["events", "coverage_requests", "media_publications", "photo_missions", "match_details"], () => {
    void load();
    void loadCost();
  });



  // Demandes d'accès en attente (administrateurs) : pastille sur « Couverture match ».
  const isAdmin = !!data?.viewer.isAdmin;
  const loadRequests = useCallback(() => listAccessRequests().then(unwrap).then(setRequests).catch(() => setRequests(null)), []);
  useEffect(() => {
    if (isAdmin) void loadRequests();
  }, [isAdmin, loadRequests]);
  useLiveRefresh(isAdmin ? ["notifications"] : [], () => void loadRequests());

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const visible = useMemo(() => {
    let list = data?.matches ?? [];
    if (region !== "all") list = list.filter((m) => m.details?.regions.includes(region));
    if (onlyMine && data) list = list.filter((m) => m.photo?.photographer?.id === data.viewer.id);
    return list;
  }, [data, region, onlyMine]);
  const groups = useMemo(() => groupMatches(visible), [visible]);

  const matches = data?.matches ?? [];
  const drafts = matches.filter((m) => m.photo?.status === "draft");
  const stats = {
    total: matches.length,
    covered: matches.filter((m) => m.photo?.status === "taken").length,
    open: matches.filter((m) => m.photo?.status === "open").length,
    photos: matches.filter((m) => m.photo).length,
  };

  const copyRecap = async () => {
    const text = buildRecap(visible);
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Récap copié — prêt à coller.");
    } catch {
      setNotice("Copie impossible dans ce navigateur.");
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const n = unwrap(await sendToNetwork(drafts.map((m) => m.eventId)));
      setNotice(`${n} match${n > 1 ? "s" : ""} envoyé${n > 1 ? "s" : ""} aux photographes.`);
      await load();
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const canCoordinate = !!data?.viewer.canCoordinate;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* Semaine + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-btn border border-line bg-card p-1">
          <button onClick={() => setRange((r) => shiftWeekend(r.start, -1))} className="rounded-btn p-1.5 text-ink-3 hover:bg-hover" aria-label="Week-end précédent">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[190px] px-1 text-center text-sm font-bold text-ink">{weekendLabel(range.start)}</span>
          <button onClick={() => setRange((r) => shiftWeekend(r.start, 1))} className="rounded-btn p-1.5 text-ink-3 hover:bg-hover" aria-label="Week-end suivant">
            <ChevronRight size={16} />
          </button>
        </div>
        <button onClick={() => setRange(weekendOf(new Date()))} className={btnGhost}>
          Ce week-end
        </button>
        <div className="flex-1" />
        {canCoordinate && (
          <>
            <button onClick={() => setNetworkOpen(true)} className={btnGhost}>
              <Users size={14} /> Couverture match
              {!!requests?.length && <span className="rounded-full bg-red px-1.5 text-[10px] font-bold text-white">{requests.length}</span>}
            </button>
            <button onClick={() => void copyRecap()} disabled={visible.length === 0} className={btnGhost}>
              <ClipboardCopy size={14} /> Copier le récap
            </button>
            {drafts.length > 0 && (
              <button onClick={() => void send()} disabled={sending} className={`${btnPrimary} !bg-good`}>
                <Send size={14} /> Envoyer aux photographes ({drafts.length})
              </button>
            )}
            <button onClick={() => setEditing("new")} className={btnPrimary}>
              <Plus size={14} /> Match
            </button>
          </>
        )}
      </div>

      {/* Compteurs + filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={region === "all"} onClick={() => setRegion("all")}>
          Toutes les pages
        </FilterChip>
        {REGION_ORDER.map((r) => (
          <FilterChip key={r} active={region === r} onClick={() => setRegion(r)}>
            {REGION_LABELS[r]}
          </FilterChip>
        ))}
        {data?.viewer.isPhotographer && (
          <FilterChip active={onlyMine} onClick={() => setOnlyMine((v) => !v)}>
            Mes matchs
          </FilterChip>
        )}
        <div className="flex-1" />
        {data && (
          <div className="text-xs text-ink-3">
            {stats.total} match{stats.total > 1 ? "s" : ""} · <span className="font-semibold text-good">{stats.covered} photographe{stats.covered > 1 ? "s" : ""} confirmé{stats.covered > 1 ? "s" : ""}</span>
            {stats.open > 0 && <> · <span className="font-semibold text-warn">{stats.open} à prendre</span></>}
            {weekendCost && (weekendCost.confirmed > 0 || weekendCost.pending > 0) && (
              <span title="Intervenants dont vous êtes le N+1 (tous pour un administrateur), d'après leur forfait — détail dans Effectif">
                {" · "}
                <span className="font-semibold text-ink">Coût {euros(weekendCost.confirmed)}</span>
                {weekendCost.pending > 0 && <span className="text-warn"> + {euros(weekendCost.pending)} prévisionnel</span>}
              </span>
            )}
          </div>
        )}
      </div>

      {notice && <div className="rounded-btn bg-sel-bg px-3 py-2 text-sm font-semibold text-ink">{notice}</div>}
      {error && <div className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>}

      {loading && <div className="text-center text-xs text-ink-4">Chargement…</div>}

      {data && !loading && visible.length === 0 && (
        <div className="rounded-panel border border-line bg-card p-8 text-center text-sm text-ink-3">
          {canCoordinate
            ? "Aucun match saisi pour ce week-end. Ajoutez les matchs à couvrir avec « + Match »."
            : data.viewer.isPhotographer
              ? "Aucun match proposé aux photographes pour ce week-end."
              : "Aucun match à afficher. Le module Week-end est réservé au réseau Couverture match et à ses coordinateurs."}
        </div>
      )}

      {groups.map(({ key, days }) => (
        <section key={key} className="overflow-hidden rounded-panel border border-line bg-card shadow-bar">
          <div className="border-b border-line bg-head px-4 py-2.5 text-sm font-extrabold text-ink">{regionsGroupLabel(key, "ui")}</div>
          {days.map(({ day, items }) => (
            <div key={day}>
              <div className="bg-subtle px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">{dayHeading(items[0].start, "ui")}</div>
              {items.map((m) => (
                <MatchRow key={m.eventId} match={m} data={data!} now={now} onEdit={() => setEditing(m)} onChanged={() => void load()} />
              ))}
            </div>
          ))}
        </section>
      ))}

      {editing && data && (
        <MatchForm
          weekendStart={range.start}
          match={editing === "new" ? null : editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            // Affiché tout de suite ; le rechargement (et le direct) remet ensuite tout à jour.
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    matches: prev.matches.some((m) => m.eventId === saved.eventId)
                      ? prev.matches.map((m) => (m.eventId === saved.eventId ? saved : m))
                      : [...prev.matches, saved].sort((a, b) => a.start.localeCompare(b.start)),
                  }
                : prev
            );
            void load();
          }}
        />
      )}
      {networkOpen && data && (
        <NetworkModal
          network={data.network}
          requests={requests}
          onClose={() => setNetworkOpen(false)}
          onChanged={() => {
            // Le réseau a changé : listes des photographes, vidéastes et relais relues.
            void load(true);
            if (isAdmin) void loadRequests();
          }}
        />
      )}
    </div>
  );
}
