"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Clock,
  CheckCircle2,
  Video,
  Image as ImageIcon,
  Images,
  FileText,
  X,
  Calendar,
  Play,
  Share2,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Repeat2,
  Users,
  RefreshCw,
  Trash2,
  Plus,
  Search,
  AlertTriangle,
} from "lucide-react";
import {
  listMediaPublications,
  countMediaPublications,
  scheduleMediaPublication,
  cancelScheduledPublication,
  markMediaPublished,
  createPublication,
  setPublicationFiles,
  deletePublication,
  publishPublicationToYoutube,
  publicationTitle,
  publicationCategory,
  publicationKind,
  type MediaPublication,
  type PublicationStatus,
  type PublicationTargets,
} from "@/lib/board/mediaPublications";
import {
  getEventFileViewUrl,
  createEventFileShareUrl,
  listEventFiles,
  uploadEventFiles,
  uploadStandaloneMedia,
  type EventFile,
} from "@/lib/board/eventFiles";
import { shareBoardDriveFile } from "@/app/actions/drive-share";
import {
  publishSocial,
  refreshSocialStats,
  getSocialComments,
  deleteSocialComment,
  deleteSocialPosts,
} from "@/app/actions/social";
import {
  FACEBOOK_REGIONS,
  NETWORK_KEYS,
  COMPETITION_TAGS,
  PUBLICATION_KIND_LABELS,
  competitionTag,
  describeFailures,
  describeWarnings,
  normalizeInstagramUsernames,
  getNetworkEntry,
  isInstagramCompatible,
  networkLabel,
  type CompetitionTag,
  type NetworkKey,
  type PublicationKind,
  type SocialComment,
  type SocialPublishTarget,
  type SocialTargetKey,
} from "@/lib/social/targets";
import { EVENT_TYPE_TO_ORG, ORG_TO_EVENT_TYPE, CALENDAR_ORG_KEYS, type DbEventType } from "@/lib/board/calendar";
import { ORG_LABELS, ORG_COLORS } from "@/lib/board/tokens";
import { useAuth } from "@/contexts/AuthContext";
import { pdfToJpegFiles } from "@/lib/board/pdfToImages";
import { createClient } from "@/lib/supabase/client";
import { personName } from "@/components/board/calendar/EventTabs";
import { YoutubeIcon, FacebookIcon, TiktokIcon, InstagramIcon } from "@/components/board/publication/BrandIcons";

const TABS: { id: PublicationStatus; label: string; icon: typeof Send }[] = [
  { id: "to_publish", label: "À publier", icon: Send },
  { id: "scheduled", label: "Programmés", icon: Clock },
  { id: "published", label: "Publiés", icon: CheckCircle2 },
];

const KIND_ICONS: Record<PublicationKind, typeof Video> = { video: Video, photo: ImageIcon, gallery: Images, text: FileText };

const compactFormatter = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const numberFormatter = new Intl.NumberFormat("fr-FR");

/** Au-delà de ce délai, les stats d'une publication sont rafraîchies automatiquement à l'ouverture de l'onglet « Publiés ». */
const STATS_STALE_MS = 60 * 60_000;
const AUTO_REFRESH_LIMIT = 20;

type By = { first_name: string | null; last_name: string | null } | null;

function categoryLabel(type: DbEventType | null): string {
  return type ? ORG_LABELS[EVENT_TYPE_TO_ORG[type]] : "Sans catégorie";
}

function publishedEntries(pub: MediaPublication) {
  return NETWORK_KEYS.map((key) => ({ key, info: getNetworkEntry(pub.publish_info, key) })).filter(
    (e): e is { key: NetworkKey; info: SocialPublishTarget } => !!e.info?.published
  );
}

function isStale(entry: SocialPublishTarget) {
  const fetchedAt = entry.stats?.fetchedAt ? Date.parse(entry.stats.fetchedAt) : 0;
  return Date.now() - fetchedAt > STATS_STALE_MS;
}

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `le ${new Date(iso).toLocaleDateString("fr-FR")}`;
}

function NetworkIcon({ networkKey, size }: { networkKey: NetworkKey; size: number }) {
  if (networkKey === "youtube") return <YoutubeIcon size={size} />;
  if (networkKey === "instagram") return <InstagramIcon size={size} />;
  return <FacebookIcon size={size} />;
}

function chipLabel(key: NetworkKey) {
  if (key === "youtube") return "YouTube";
  if (key === "instagram") return "Instagram";
  return FACEBOOK_REGIONS.find((r) => r.key === key)?.label ?? key;
}

const CHIP_STYLES: Record<"youtube" | "instagram" | "facebook", string> = {
  youtube: "bg-bad-bg text-bad",
  instagram: "bg-subtle text-ink-2",
  facebook: "bg-sel-bg text-link",
};

function MediaThumb({ pub }: { pub: MediaPublication }) {
  const [url, setUrl] = useState<string | null>(null);
  const kind = publicationKind(pub);
  const first = pub.files[0];
  const firstIsImage = (first?.content_type ?? "").startsWith("image") && first?.storage_provider !== "drive";
  const count = pub.files.length || pub.media.length;

  useEffect(() => {
    if (!first || !firstIsImage) return;
    getEventFileViewUrl(first).then(setUrl);
  }, [first, firstIsImage]);

  const Icon = KIND_ICONS[kind];
  return (
    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-btn bg-subtle">
      {firstIsImage && url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire, pas un asset statique optimisable
        <img src={url} alt={first.filename} className="h-full w-full object-cover" />
      ) : (
        <Icon size={20} className="text-ink-4" />
      )}
      {kind === "gallery" && count > 1 && (
        <span className="absolute bottom-0.5 right-0.5 rounded-full bg-navy px-1.5 text-[9px] font-bold text-white">{count}</span>
      )}
    </div>
  );
}

function StatTile({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: number | undefined }) {
  return (
    <div className="min-w-[78px] rounded-btn bg-subtle px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.08em] text-ink-4">
        <Icon size={10} /> {label}
      </div>
      <div className="text-sm font-bold text-ink">{value === undefined ? "—" : numberFormatter.format(value)}</div>
    </div>
  );
}

/** Commentaires lus en direct sur la plateforme à l'ouverture (jamais stockés), supprimables depuis le board. */
function CommentsSection({ publicationId, networkKey, count }: { publicationId: string; networkKey: NetworkKey; count?: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<SocialComment[] | null>(null);

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (comments) return;
    setLoading(true);
    const res = await getSocialComments(publicationId, networkKey);
    setError(res.error);
    setComments(res.comments);
    setLoading(false);
  };

  const remove = async (commentId: string) => {
    if (!confirm("Supprimer ce commentaire sur le réseau ? Action irréversible.")) return;
    const res = await deleteSocialComment(networkKey, commentId);
    if (res.error) setError(res.error);
    else setComments((prev) => prev?.filter((c) => c.id !== commentId) ?? null);
  };

  return (
    <div>
      <button onClick={toggle} className="flex items-center gap-1 text-[11px] font-semibold text-link hover:underline">
        <MessageCircle size={12} />
        {open ? "Masquer les commentaires" : `Voir les commentaires${count ? ` (${count})` : ""}`}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {loading && <p className="text-[11px] text-ink-4">Chargement…</p>}
          {error && <p className="text-[11px] text-bad">{error}</p>}
          {comments && comments.length === 0 && !loading && <p className="text-[11px] text-ink-4">Aucun commentaire.</p>}
          {comments?.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 rounded-btn bg-subtle px-2.5 py-1.5 text-[11px]">
              <span className="min-w-0 text-ink-2">
                <strong className="text-ink">{c.author}</strong>
                {c.createdAt && <span className="text-ink-4"> · {new Date(c.createdAt).toLocaleDateString("fr-FR")}</span>}
                <br />
                {c.text}
              </span>
              <button onClick={() => remove(c.id)} title="Supprimer" className="shrink-0 text-ink-4 hover:text-bad">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SocialDetail({
  pub,
  networkKey,
  info,
  onChanged,
}: {
  pub: MediaPublication;
  networkKey: NetworkKey;
  info: SocialPublishTarget;
  onChanged: () => void;
}) {
  const stats = info.stats;
  const isInstagram = networkKey === "instagram";
  const isFacebook = networkKey !== "instagram" && networkKey !== "youtube";
  const by = info.by ? personName({ ...info.by, email: null }) : null;
  const [deleting, setDeleting] = useState(false);

  const removeFromNetwork = async () => {
    if (!confirm(`Supprimer cette publication de ${networkLabel(networkKey)} ? Action publique et irréversible.`)) return;
    setDeleting(true);
    try {
      const failures = describeFailures(await deleteSocialPosts(pub.id, [networkKey]));
      if (failures) alert(failures);
      onChanged();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 border-t border-dashed border-line pt-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-3">
        <span className="font-semibold text-ink-2">{networkLabel(networkKey)}</span>
        {info.at && (
          <span>
            publié le {new Date(info.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
            {by && by !== "—" ? ` par ${by}` : ""}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          {info.permalink && (
            <a href={info.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-link hover:underline">
              <ExternalLink size={11} /> Voir la publication
            </a>
          )}
          <button onClick={removeFromNetwork} disabled={deleting} className="flex items-center gap-1 font-semibold text-ink-4 hover:text-bad disabled:opacity-50">
            <Trash2 size={11} /> {deleting ? "Suppression…" : "Supprimer du réseau"}
          </button>
        </span>
      </div>

      {stats ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <StatTile icon={Eye} label="Vues" value={stats.views} />
            {(isInstagram || stats.reach !== undefined) && <StatTile icon={Users} label="Portée" value={stats.reach} />}
            <StatTile icon={Heart} label={isFacebook ? "Réactions" : "J'aime"} value={stats.likes} />
            <StatTile icon={MessageCircle} label="Comm." value={stats.comments} />
            {isFacebook && <StatTile icon={Repeat2} label="Partages" value={stats.shares} />}
          </div>
          <p className="text-[10px] text-ink-4">Stats mises à jour {timeAgo(stats.fetchedAt)}</p>
        </>
      ) : (
        <p className="text-[11px] italic text-ink-4">Stats pas encore récupérées — cliquez sur « Rafraîchir les stats ».</p>
      )}

      {(info.videoId || info.postId) && <CommentsSection publicationId={pub.id} networkKey={networkKey} count={stats?.comments} />}
    </div>
  );
}

/** Une pastille par réseau/page publié, avec vues et commentaires visibles sans clic — cliquer ouvre le détail. */
function PublishedStatsRow({ pub, onChanged }: { pub: MediaPublication; onChanged: () => void }) {
  const [openKey, setOpenKey] = useState<NetworkKey | null>(null);
  const entries = publishedEntries(pub);
  const open = entries.find((e) => e.key === openKey);

  return (
    <div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.map((e) => {
          const stats = e.info.stats;
          const style = e.key === "youtube" ? CHIP_STYLES.youtube : e.key === "instagram" ? CHIP_STYLES.instagram : CHIP_STYLES.facebook;
          return (
            <button
              key={e.key}
              onClick={() => setOpenKey((prev) => (prev === e.key ? null : e.key))}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 transition-colors ${style} ${
                openKey === e.key ? "ring-current" : "ring-transparent"
              }`}
            >
              <NetworkIcon networkKey={e.key} size={11} /> {chipLabel(e.key)}
              {stats && (
                <span className="ml-0.5 flex items-center gap-1 font-semibold opacity-80">
                  {stats.views !== undefined && (
                    <span className="flex items-center gap-0.5">
                      · <Eye size={10} /> {compactFormatter.format(stats.views)}
                    </span>
                  )}
                  <span className="flex items-center gap-0.5">
                    <MessageCircle size={10} /> {compactFormatter.format(stats.comments)}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {pub.publish_info?.lastError && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-bad">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-line">{pub.publish_info.lastError.message}</span>
        </p>
      )}
      {open && <SocialDetail pub={pub} networkKey={open.key} info={open.info} onChanged={onChanged} />}
    </div>
  );
}

/** Totaux de l'onglet « Publiés » (sur la sélection filtrée) + rafraîchissement manuel des stats. */
function StatsToolbar({ items, refreshing, onRefresh }: { items: MediaPublication[]; refreshing: boolean; onRefresh: () => void }) {
  const totals = useMemo(() => {
    const t = { views: 0, likes: 0, comments: 0, shares: 0, posts: 0, lastFetch: null as string | null };
    for (const pub of items) {
      for (const e of publishedEntries(pub)) {
        t.posts += 1;
        const s = e.info.stats;
        if (!s) continue;
        t.views += s.views ?? 0;
        t.likes += s.likes;
        t.comments += s.comments;
        t.shares += s.shares ?? 0;
        if (!t.lastFetch || s.fetchedAt > t.lastFetch) t.lastFetch = s.fetchedAt;
      }
    }
    return t;
  }, [items]);

  if (totals.posts === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-panel border border-line bg-card p-3">
      <StatTile icon={Eye} label="Vues" value={totals.views} />
      <StatTile icon={Heart} label="J'aime" value={totals.likes} />
      <StatTile icon={MessageCircle} label="Comm." value={totals.comments} />
      <StatTile icon={Repeat2} label="Partages" value={totals.shares} />
      <div className="ml-auto flex flex-col items-end gap-1">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Actualisation…" : "Rafraîchir les stats"}
        </button>
        <span className="text-[10px] text-ink-4">
          {totals.posts} publication{totals.posts > 1 ? "s" : ""} en ligne
          {totals.lastFetch ? ` · maj ${timeAgo(totals.lastFetch)}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ---------- Filtres ---------- */

type Filters = { category: DbEventType | "all"; competition: CompetitionTag | "all"; kind: PublicationKind | "all" };

function FilterChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: { base: string; bg: string; ink: string };
}) {
  return (
    <button
      onClick={onClick}
      style={active && color ? { background: color.base, color: "#fff" } : !active && color ? { background: color.bg, color: color.ink } : undefined}
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        color ? "" : active ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

function FiltersBar({ items, filters, onChange }: { items: MediaPublication[]; filters: Filters; onChange: (f: Filters) => void }) {
  const counts = useMemo(() => {
    const byCategory = new Map<DbEventType | null, number>();
    const byTag = new Map<CompetitionTag, number>();
    const byKind = new Map<PublicationKind, number>();
    for (const p of items) {
      const cat = publicationCategory(p);
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
      byKind.set(publicationKind(p), (byKind.get(publicationKind(p)) ?? 0) + 1);
      if (cat === "competitions") {
        const tag = competitionTag(publicationTitle(p));
        byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
      }
    }
    return { byCategory, byTag, byKind };
  }, [items]);

  const categories = CALENDAR_ORG_KEYS.map((org) => ORG_TO_EVENT_TYPE[org]).filter((t) => counts.byCategory.has(t));

  return (
    <div className="mb-3 space-y-2 rounded-panel border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={filters.category === "all"} onClick={() => onChange({ ...filters, category: "all", competition: "all" })}>
          Tous ({items.length})
        </FilterChip>
        {categories.map((cat) => (
          <FilterChip
            key={cat}
            active={filters.category === cat}
            color={ORG_COLORS[EVENT_TYPE_TO_ORG[cat]]}
            onClick={() => onChange({ ...filters, category: cat, competition: "all" })}
          >
            {categoryLabel(cat)} ({counts.byCategory.get(cat)})
          </FilterChip>
        ))}
      </div>

      {filters.category === "competitions" && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-line pt-2">
          <FilterChip active={filters.competition === "all"} onClick={() => onChange({ ...filters, competition: "all" })}>
            Tous
          </FilterChip>
          {COMPETITION_TAGS.filter((t) => counts.byTag.has(t.key)).map((t) => (
            <FilterChip key={t.key} active={filters.competition === t.key} onClick={() => onChange({ ...filters, competition: t.key })}>
              {t.label} ({counts.byTag.get(t.key)})
            </FilterChip>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-line pt-2">
        <FilterChip active={filters.kind === "all"} onClick={() => onChange({ ...filters, kind: "all" })}>
          Tous les types
        </FilterChip>
        {(Object.keys(PUBLICATION_KIND_LABELS) as PublicationKind[])
          .filter((k) => counts.byKind.has(k))
          .map((k) => {
            const Icon = KIND_ICONS[k];
            return (
              <FilterChip key={k} active={filters.kind === k} onClick={() => onChange({ ...filters, kind: k })}>
                <span className="flex items-center gap-1">
                  <Icon size={11} /> {PUBLICATION_KIND_LABELS[k]} ({counts.byKind.get(k)})
                </span>
              </FilterChip>
            );
          })}
      </div>
    </div>
  );
}

function applyFilters(items: MediaPublication[], f: Filters) {
  return items.filter((p) => {
    const cat = publicationCategory(p);
    if (f.category !== "all" && cat !== f.category) return false;
    if (f.category === "competitions" && f.competition !== "all" && competitionTag(publicationTitle(p)) !== f.competition) return false;
    if (f.kind !== "all" && publicationKind(p) !== f.kind) return false;
    return true;
  });
}

/* ---------- Compositeur ---------- */

function useMe() {
  const { user } = useAuth();
  const [me, setMe] = useState<By>(null);
  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single().then(({ data }) => setMe(data ?? null));
  }, [user?.id]);
  return { me, userId: user?.id ?? null };
}

/** Médias de l'événement sélectionnables pour composer une galerie (photos/vidéos uniquement). */
function EventMediaPicker({ eventId, selected, onChange }: { eventId: string; selected: EventFile[]; onChange: (files: EventFile[]) => void }) {
  const [files, setFiles] = useState<EventFile[] | null>(null);
  useEffect(() => {
    listEventFiles(eventId).then((all) =>
      setFiles(all.filter((f) => /^(image|video)\//.test(f.content_type ?? "")).sort((a, b) => a.created_at.localeCompare(b.created_at)))
    );
  }, [eventId]);

  if (!files) return <p className="text-[11px] text-ink-4">Chargement des médias de l&rsquo;événement…</p>;
  if (files.length <= 1) return null;

  const toggle = (f: EventFile) => {
    const isSelected = selected.some((s) => s.id === f.id);
    if (isSelected && selected.length === 1) return; // au moins un média
    onChange(isSelected ? selected.filter((s) => s.id !== f.id) : [...selected, f]);
  };

  return (
    <div className="space-y-1.5 rounded-btn border border-line p-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
        Médias de l&rsquo;événement — cochez-en plusieurs pour une galerie
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {files.map((f) => {
          const isVideo = (f.content_type ?? "").startsWith("video");
          return (
            <label key={f.id} className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" checked={selected.some((s) => s.id === f.id)} onChange={() => toggle(f)} />
              {isVideo ? <Video size={12} className="text-ink-4" /> : <ImageIcon size={12} className="text-ink-4" />}
              <span className="truncate">{f.filename}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Composer({ pub, onClose, onDone }: { pub: MediaPublication; onClose: () => void; onDone: () => void }) {
  const { me } = useMe();
  const [caption, setCaption] = useState(pub.caption ?? "");
  const [files, setFiles] = useState<EventFile[]>(pub.files);
  const [youtube, setYoutube] = useState(!!pub.targets.youtube);
  const [fb, setFb] = useState({
    lorraine: !!pub.targets.facebook?.lorraine,
    champagne_ardenne: !!pub.targets.facebook?.champagne_ardenne,
    alsace: !!pub.targets.facebook?.alsace,
  });
  const [instagram, setInstagram] = useState(!!pub.targets.instagram);
  const [igTagsInput, setIgTagsInput] = useState((pub.targets.igTags ?? []).map((u) => `@${u}`).join(" "));
  const igTags = normalizeInstagramUsernames(igTagsInput);
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);

  // Types des médias réellement publiés (galerie composée ici pour une publication d'événement).
  const contentTypes = pub.media.length > 0 ? pub.media.map((m) => m.content_type ?? "") : files.map((f) => f.content_type ?? "");
  const count = contentTypes.length;
  const videos = contentTypes.filter((ct) => ct.startsWith("video")).length;
  const kindLabel = count === 0 ? "Texte" : count > 1 ? `Galerie (${count})` : videos ? "Vidéo" : "Photo";

  const canYoutube = count === 1 && videos === 1;
  const canFacebook = count <= 1 || videos === 0;
  // Sans média, Instagram reçoit un visuel généré à partir du texte (voir /api/media/text-card).
  const canInstagram = count <= 10 && contentTypes.every((ct) => isInstagramCompatible(ct));
  const fbReason = !canFacebook ? "Galerie : photos uniquement" : null;
  const igReason = count > 10 ? "10 médias max." : !canInstagram ? "Format non pris en charge (HEIC)" : count === 0 ? "Visuel généré depuis le texte" : null;
  const ytReason = !canYoutube ? "Une seule vidéo" : null;

  const anyTarget = (canYoutube && youtube) || (canFacebook && (fb.lorraine || fb.champagne_ardenne || fb.alsace)) || (canInstagram && instagram);
  const targets: PublicationTargets = {
    youtube: canYoutube && youtube,
    facebook: canFacebook ? fb : {},
    instagram: canInstagram && instagram,
    igTags: canInstagram && instagram ? igTags : [],
  };

  const persistFiles = async () => {
    const changed = files.map((f) => f.id).join() !== pub.files.map((f) => f.id).join();
    if (changed) await setPublicationFiles(pub.id, files);
  };

  const publishNow = async () => {
    if (count === 0 && !caption.trim()) return alert("Écrivez le texte de la publication.");
    if (!confirm("Publier maintenant sur les réseaux sélectionnés ? Action publique et non réversible.")) return;
    setBusy(true);
    const failures: string[] = [];
    let anyOk = false;
    try {
      await persistFiles();
      if (targets.youtube) {
        try {
          await publishPublicationToYoutube({ id: pub.id, files, media: pub.media }, { title: publicationTitle(pub), description: caption }, me);
          anyOk = true;
        } catch (e) {
          failures.push(`YouTube : ${e instanceof Error ? e.message : "échec"}`);
        }
      }

      const socialTargets: { key: SocialTargetKey; caption: string }[] = [
        ...FACEBOOK_REGIONS.filter((r) => targets.facebook?.[r.key]).map((r) => ({ key: r.key as SocialTargetKey, caption })),
        ...(targets.instagram ? [{ key: "instagram" as SocialTargetKey, caption }] : []),
      ];
      if (socialTargets.length > 0) {
        try {
          const results = await publishSocial(pub.id, socialTargets, me, { igUserTags: targets.igTags });
          anyOk ||= results.some((r) => r.ok);
          const socialFailures = describeFailures(results);
          if (socialFailures) failures.push(socialFailures);
          const warnings = describeWarnings(results);
          if (warnings) failures.push(`Attention — ${warnings}`);
        } catch (e) {
          failures.push(e instanceof Error ? e.message : "Échec de la publication Facebook/Instagram.");
        }
      }

      if (anyOk) await markMediaPublished(pub.id, caption);
      if (failures.length > 0) alert(`${anyOk ? "Publié partiellement." : "Échec de la publication."}\n\n${failures.join("\n")}`);
      if (anyOk) onDone();
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    if (!scheduledAt) return;
    setBusy(true);
    try {
      await persistFiles();
      await scheduleMediaPublication(pub.id, { caption, targets, scheduledAt: new Date(scheduledAt).toISOString() });
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la programmation.");
    } finally {
      setBusy(false);
    }
  };

  const networkRow = (
    key: "youtube" | "instagram",
    enabled: boolean,
    checked: boolean,
    onToggle: (v: boolean) => void,
    reason: string | null,
    extra?: React.ReactNode
  ) => (
    <label
      className={`flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm font-semibold ${
        enabled ? "cursor-pointer text-ink" : "cursor-not-allowed text-ink-4 opacity-50"
      }`}
    >
      <input type="checkbox" disabled={!enabled} checked={enabled && checked} onChange={(e) => onToggle(e.target.checked)} />
      <NetworkIcon networkKey={key} size={16} /> {key === "youtube" ? "YouTube" : "Instagram"} {extra}
      {reason && <span className="ml-auto text-[10px] font-normal">{reason}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-modal border border-line bg-card p-5 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">{publicationTitle(pub)}</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-ink-4">
          {pub.events ? "Événement" : "Publication directe"} · {categoryLabel(publicationCategory(pub))} · {kindLabel}
        </p>

        {pub.event_id && files.length > 0 && <EventMediaPicker eventId={pub.event_id} selected={files} onChange={setFiles} />}
        {pub.media.length > 0 && (
          <ul className="space-y-0.5 text-xs text-ink-3">
            {pub.media.map((m) => (
              <li key={m.drive_file_id} className="flex items-center gap-1.5 truncate">
                {(m.content_type ?? "").startsWith("video") ? <Video size={12} /> : <ImageIcon size={12} />} {m.filename}
              </li>
            ))}
          </ul>
        )}

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={4}
          placeholder="Texte de la publication…"
          className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
        />

        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Réseaux</div>

          {networkRow("youtube", canYoutube, youtube, setYoutube, ytReason)}

          <div className={`space-y-1.5 rounded-btn border border-line px-3 py-2 ${canFacebook ? "" : "opacity-50"}`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <FacebookIcon size={16} /> Facebook
              {fbReason && <span className="ml-auto text-[10px] font-normal text-ink-4">{fbReason}</span>}
            </div>
            {FACEBOOK_REGIONS.map((r) => (
              <label key={r.key} className={`flex items-center gap-2 pl-1 text-xs ${canFacebook ? "cursor-pointer text-ink-2" : "cursor-not-allowed text-ink-4"}`}>
                <input
                  type="checkbox"
                  disabled={!canFacebook}
                  checked={canFacebook && fb[r.key]}
                  onChange={(e) => setFb((prev) => ({ ...prev, [r.key]: e.target.checked }))}
                />
                {r.label}
              </label>
            ))}
          </div>

          {networkRow(
            "instagram",
            canInstagram,
            instagram,
            setInstagram,
            igReason,
            <span className="text-xs font-normal text-ink-3">@lgefofficiel</span>
          )}

          {canInstagram && instagram && (videos < count || count === 0) && (
            <div className="space-y-1 rounded-btn border border-line px-3 py-2">
              <label className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                Identifier des comptes Instagram sur la photo
              </label>
              <input
                value={igTagsInput}
                onChange={(e) => setIgTagsInput(e.target.value)}
                placeholder="@club_exemple @autre_compte"
                className="w-full rounded-btn border border-line px-2.5 py-1.5 text-sm outline-none"
              />
              <p className="text-[10px] text-ink-4">
                {igTags.length > 0 ? `${igTags.length} compte${igTags.length > 1 ? "s" : ""} identifié${igTags.length > 1 ? "s" : ""} — ` : ""}
                notifiés sur Instagram (comptes publics). Pour une simple mention, écrivez aussi @compte dans le texte.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-btn border border-dashed border-line px-3 py-2 text-sm font-semibold text-ink-4 opacity-60">
            <TiktokIcon size={16} /> TikTok <span className="ml-auto text-[10px] font-normal">Bientôt disponible</span>
          </div>

          {canInstagram && instagram && videos > 0 && (
            <p className="text-[11px] italic text-ink-4">
              Instagram traite les vidéos côté Meta : la publication peut prendre jusqu&rsquo;à une minute.
            </p>
          )}
        </div>

        <div className="space-y-2 rounded-btn border border-line p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
            <Calendar size={12} /> Programmer (optionnel)
          </div>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full rounded-btn border border-line px-2.5 py-1.5 text-sm outline-none"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm text-ink-2">
            Annuler
          </button>
          <button
            onClick={schedule}
            disabled={busy || !scheduledAt || !anyTarget}
            className="rounded-btn border border-line px-4 py-2 text-sm font-bold text-ink-2 disabled:opacity-50"
          >
            Programmer
          </button>
          <button
            onClick={publishNow}
            disabled={busy || !anyTarget}
            className="rounded-btn bg-red px-4 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-50"
          >
            {busy ? "…" : "Publier maintenant"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Nouvelle publication ---------- */

type EventOption = { id: string; title: string; start_date: string; event_type: DbEventType | null };

function EventSearch({ onPick }: { onPick: (e: EventOption) => void }) {
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<EventOption[]>([]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      const supabase = createClient();
      let req = supabase
        .from("events")
        .select("id, title, start_date, event_type")
        .not("event_type", "is", null)
        .order("start_date", { ascending: false })
        .limit(15);
      req = query.trim()
        ? req.ilike("title", `%${query.trim()}%`)
        : req.lte("start_date", new Date(Date.now() + 14 * 86_400_000).toISOString());
      const { data } = await req;
      setEvents((data as EventOption[] | null) ?? []);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-btn border border-line px-2.5 py-1.5">
        <Search size={13} className="text-ink-4" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un événement du planning…"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>
      <div className="max-h-56 overflow-y-auto rounded-btn border border-line">
        {events.length === 0 && <p className="p-3 text-xs text-ink-4">Aucun événement trouvé.</p>}
        {events.map((e) => (
          <button key={e.id} onClick={() => onPick(e)} className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-hover">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: e.event_type ? ORG_COLORS[EVENT_TYPE_TO_ORG[e.event_type]].base : undefined }}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{e.title}</span>
            <span className="shrink-0 text-[11px] text-ink-4">{new Date(e.start_date).toLocaleDateString("fr-FR")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * « Nouvelle publication » : on demande d'abord si elle appartient à un événement du planning —
 * oui : les fichiers deviennent des pièces jointes de l'événement ; non : publication autonome
 * (titre + catégorie, médias sur le Drive du board). Sans fichier, c'est un post texte. Crée la
 * publication dans « À publier » puis ouvre le compositeur (réseaux, publier/programmer).
 */
function NewPublicationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (pubId: string) => void }) {
  const { userId } = useMe();
  const [step, setStep] = useState<"ask" | "event" | "content">("ask");
  const [event, setEvent] = useState<EventOption | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DbEventType>("communication");
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    if (!event && !title.trim()) return alert("Donnez un titre à la publication.");
    if (files.length === 0 && !caption.trim()) return alert("Ajoutez un texte ou des médias.");
    setBusy(true);
    try {
      let fileIds: string[] = [];
      let media: Awaited<ReturnType<typeof uploadStandaloneMedia>> = [];
      if (files.length > 0 && event) {
        const results = await uploadEventFiles(event.id, files);
        const failed = results.filter((r) => !r.ok);
        if (failed.length) throw new Error(`Échec de l'envoi : ${failed.map((f) => f.name).join(", ")}`);
        fileIds = results.map((r) => r.id).filter((id): id is string => !!id);
      } else if (files.length > 0) {
        media = await uploadStandaloneMedia(files);
      }
      const id = await createPublication(
        { eventId: event?.id ?? null, fileIds, media, title: event ? null : title.trim(), category: event ? null : category, caption },
        userId
      );
      onCreated(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la création.");
    } finally {
      setBusy(false);
    }
  };

  const kind = files.length === 0 ? "Texte" : files.length > 1 ? `Galerie (${files.length})` : files[0].type.startsWith("video") ? "Vidéo" : "Photo";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-modal border border-line bg-card p-5 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">Nouvelle publication</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        {step === "ask" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">Cette publication appartient-elle à un événement du planning ?</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setStep("event")} className="rounded-btn border border-line p-3 text-left hover:bg-hover">
                <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <Calendar size={14} /> Oui
                </div>
                <div className="mt-1 text-[11px] text-ink-4">Les médias sont ajoutés aux pièces jointes de l&rsquo;événement.</div>
              </button>
              <button onClick={() => setStep("content")} className="rounded-btn border border-line p-3 text-left hover:bg-hover">
                <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <Send size={14} /> Non
                </div>
                <div className="mt-1 text-[11px] text-ink-4">Publication directe depuis le centre de publication.</div>
              </button>
            </div>
          </div>
        )}

        {step === "event" && (
          <EventSearch
            onPick={(e) => {
              setEvent(e);
              setStep("content");
            }}
          />
        )}

        {step === "content" && (
          <div className="space-y-3">
            {event ? (
              <div className="flex items-center justify-between rounded-btn bg-subtle px-3 py-2 text-xs">
                <span className="min-w-0 truncate">
                  <strong className="text-ink">{event.title}</strong>{" "}
                  <span className="text-ink-4">· {new Date(event.start_date).toLocaleDateString("fr-FR")} · {categoryLabel(event.event_type)}</span>
                </span>
                <button onClick={() => setStep("event")} className="shrink-0 font-semibold text-link hover:underline">
                  Changer
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Titre (ex. R1 — J5 : résultats)"
                  className="rounded-btn border border-line px-3 py-2 text-sm outline-none"
                />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DbEventType)}
                  className="rounded-btn border border-line px-2 py-2 text-sm outline-none"
                >
                  {CALENDAR_ORG_KEYS.filter((o) => o !== "perso").map((org) => (
                    <option key={org} value={ORG_TO_EVENT_TYPE[org]}>
                      {ORG_LABELS[org]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              placeholder="Texte de la publication…"
              className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
            />

            <div className="space-y-1.5">
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,video/*,application/pdf"
                className="hidden"
                onChange={async (e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (picked.length === 0) return;
                  setConverting(true);
                  try {
                    // Un PDF devient une galerie : une photo JPEG par page (10 max).
                    const expanded: File[] = [];
                    for (const f of picked) {
                      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) expanded.push(...(await pdfToJpegFiles(f)));
                      else expanded.push(f);
                    }
                    setFiles((prev) => [...prev, ...expanded]);
                  } catch (err) {
                    alert(err instanceof Error ? `PDF illisible : ${err.message}` : "PDF illisible.");
                  } finally {
                    setConverting(false);
                  }
                }}
              />
              <button
                onClick={() => inputRef.current?.click()}
                disabled={converting}
                className="flex w-full items-center gap-1.5 rounded-btn border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-hover disabled:opacity-50"
              >
                <Plus size={13} />{" "}
                {converting ? "Conversion du PDF…" : "Ajouter photos (JPEG, PNG), vidéo ou PDF — facultatif, sans média : post texte"}
              </button>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-ink-2">
                  {f.type.startsWith("video") ? <Video size={12} /> : <ImageIcon size={12} />}
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-ink-4 hover:text-bad">
                    <X size={12} />
                  </button>
                </div>
              ))}
              <p className="text-[11px] text-ink-4">Type : {kind}</p>
            </div>

            <div className="flex justify-between gap-2">
              <button onClick={() => setStep("ask")} className="rounded-btn border border-line px-4 py-2 text-sm text-ink-2">
                Retour
              </button>
              <button onClick={create} disabled={busy || converting} className="rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {busy ? "Envoi…" : "Continuer vers la publication"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Liste ---------- */

function PublicationCard({
  pub,
  tab,
  onOpenComposer,
  onCancelSchedule,
  onChanged,
}: {
  pub: MediaPublication;
  tab: PublicationStatus;
  onOpenComposer: () => void;
  onCancelSchedule: () => void;
  onChanged: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const first = pub.files[0] ?? null;
  const standalone = pub.media[0] ?? null;
  const isDrive = first ? first.storage_provider === "drive" : !!standalone;
  const kind = publicationKind(pub);
  const category = publicationCategory(pub);
  const orgColor = category ? ORG_COLORS[EVENT_TYPE_TO_ORG[category]] : null;
  const uploader = first ? personName(first.uploaded_by_profile) : null;
  const createdAt = new Date(pub.created_at).toLocaleDateString("fr-FR");
  const hasMedia = !!first || !!standalone;

  const openMedia = async () => {
    const url = first ? await getEventFileViewUrl(first) : standalone?.web_view_link;
    if (url) window.open(url, "_blank", "noreferrer");
  };

  const share = async () => {
    setSharing(true);
    try {
      let url: string | null = null;
      const driveId = first?.drive_file_id ?? standalone?.drive_file_id;
      if (isDrive && driveId) {
        await shareBoardDriveFile(driveId);
        url = first?.drive_web_view_link ?? standalone?.web_view_link ?? null;
      } else if (first?.path) {
        url = await createEventFileShareUrl(first.path);
      }
      if (!url) throw new Error("Lien indisponible.");
      await navigator.clipboard.writeText(url);
      alert("Lien de partage copié dans le presse-papiers.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec du partage.");
    } finally {
      setSharing(false);
    }
  };

  const remove = async () => {
    const msg = pub.event_id
      ? "Retirer cette publication du centre ? Les fichiers restent dans l'événement."
      : "Supprimer cette publication ? (Rien n'est retiré des réseaux.)";
    if (!confirm(msg)) return;
    await deletePublication(pub.id);
    onChanged();
  };

  const KindIcon = KIND_ICONS[kind];

  return (
    <div className="flex items-start gap-3 border-b border-line bg-card px-4 py-3 last:border-b-0 hover:bg-hover">
      <MediaThumb pub={pub} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold text-ink">{publicationTitle(pub)}</span>
          {isDrive && hasMedia && <span className="shrink-0 rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">Drive</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
          {orgColor && (
            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: orgColor.bg, color: orgColor.ink }}>
              {categoryLabel(category)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <KindIcon size={11} /> {PUBLICATION_KIND_LABELS[kind]}
            {kind === "gallery" && ` (${pub.files.length || pub.media.length})`}
          </span>
          <span>·</span>
          <span>{pub.events ? "Événement" : "Publication directe"}</span>
          <span>·</span>
          <span>
            {uploader && uploader !== "—" ? `${uploader} · ` : ""}
            {createdAt}
          </span>
          {tab === "scheduled" && pub.scheduled_at && (
            <span className="font-semibold text-link">
              {new Date(pub.scheduled_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
            </span>
          )}
        </div>
        {kind === "text" && pub.caption && <p className="mt-1 line-clamp-2 text-xs text-ink-3">{pub.caption}</p>}
        {tab !== "published" && pub.publish_info?.lastError && (
          <p className="mt-1 flex items-start gap-1 text-[11px] text-bad">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-line">Échec de l&rsquo;envoi programmé : {pub.publish_info.lastError.message}</span>
          </p>
        )}
        {tab === "published" && <PublishedStatsRow pub={pub} onChanged={onChanged} />}
      </div>

      <div className="flex shrink-0 items-center gap-3 self-center">
        {hasMedia && (
          <button onClick={openMedia} className="flex items-center gap-1 text-[11px] font-semibold text-ink-3 hover:text-ink">
            {isDrive ? <ExternalLink size={12} /> : <Play size={12} />}
            {isDrive ? "Voir sur Drive" : "Lire"}
          </button>
        )}
        {hasMedia && (
          <button
            onClick={share}
            disabled={sharing}
            className="flex items-center gap-1 text-[11px] font-semibold text-ink-3 hover:text-ink disabled:opacity-50"
          >
            <Share2 size={12} /> {sharing ? "…" : "Partager"}
          </button>
        )}
        {tab === "to_publish" && (
          <>
            <button onClick={remove} title="Retirer" className="text-ink-4 hover:text-bad">
              <Trash2 size={13} />
            </button>
            <button onClick={onOpenComposer} className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white">
              Publier / Programmer
            </button>
          </>
        )}
        {tab === "scheduled" && (
          <button onClick={onCancelSchedule} className="rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2">
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

export function PublicationScreen() {
  const [tab, setTab] = useState<PublicationStatus>("to_publish");
  const [items, setItems] = useState<MediaPublication[]>([]);
  const [counts, setCounts] = useState<Record<PublicationStatus, number>>({ to_publish: 0, scheduled: 0, published: 0 });
  const [loading, setLoading] = useState(true);
  const [composerFor, setComposerFor] = useState<MediaPublication | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshingStats, setRefreshingStats] = useState(false);
  const [filters, setFilters] = useState<Filters>({ category: "all", competition: "all", kind: "all" });
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const visible = useMemo(() => applyFilters(items, filters), [items, filters]);

  const refetch = async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [list, countRes] = await Promise.all([listMediaPublications(tabRef.current), countMediaPublications()]);
    setItems(list);
    setCounts(countRes);
    setLoading(false);
    return list;
  };

  /** Relit les stats sur les plateformes puis recharge la liste sans repasser par l'écran de chargement. */
  const refreshStats = async (ids: string[]) => {
    if (ids.length === 0) return;
    setRefreshingStats(true);
    try {
      const res = await refreshSocialStats(ids);
      if (res.youtubeError) console.warn("[PublicationScreen] stats YouTube :", res.youtubeError);
      const list = await listMediaPublications("published");
      // L'utilisateur a pu changer d'onglet pendant l'appel : ne pas écraser l'autre liste.
      if (tabRef.current === "published") setItems(list);
    } catch (e) {
      console.error("[PublicationScreen.refreshStats]", e);
    } finally {
      setRefreshingStats(false);
    }
  };

  useEffect(() => {
    refetch().then((list) => {
      if (tab !== "published") return;
      const stale = list.filter((p) => publishedEntries(p).some((e) => isStale(e.info))).slice(0, AUTO_REFRESH_LIMIT);
      refreshStats(stale.map((p) => p.id));
    });
  }, [tab]);

  return (
    <div className="flex h-full gap-4 p-4">
      <aside className="w-[220px] shrink-0 rounded-panel border border-line bg-card p-3">
        <div className="mb-3 px-1 text-sm font-extrabold text-ink">Centre de publication</div>
        <button
          onClick={() => setCreating(true)}
          className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-btn bg-red px-3 py-2 text-sm font-bold text-white shadow-btn-red"
        >
          <Plus size={15} /> Nouvelle publication
        </button>
        <div className="space-y-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex w-full items-center justify-between gap-2.5 rounded-btn px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                  tab === t.id ? "bg-navy text-white" : "text-ink-2 hover:bg-hover"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={16} /> {t.label}
                </span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === t.id ? "bg-white/20 text-white" : "bg-subtle text-ink-3"}`}>
                  {counts[t.id]}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-ink-4">Chargement…</div>
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-panel border border-dashed border-line text-sm text-ink-4">
            Rien ici pour l&rsquo;instant.
          </div>
        ) : (
          <>
            <FiltersBar items={items} filters={filters} onChange={setFilters} />
            {tab === "published" && (
              <StatsToolbar
                items={visible}
                refreshing={refreshingStats}
                onRefresh={() => refreshStats(visible.filter((p) => publishedEntries(p).length > 0).map((p) => p.id))}
              />
            )}
            {visible.length === 0 ? (
              <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-4">
                Aucune publication pour ces filtres.
              </div>
            ) : (
              <div className="overflow-hidden rounded-panel border border-line">
                {visible.map((pub) => (
                  <PublicationCard
                    key={pub.id}
                    pub={pub}
                    tab={tab}
                    onOpenComposer={() => setComposerFor(pub)}
                    onCancelSchedule={async () => {
                      await cancelScheduledPublication(pub.id);
                      refetch();
                    }}
                    onChanged={() => refetch(true)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {composerFor && (
        <Composer
          pub={composerFor}
          onClose={() => setComposerFor(null)}
          onDone={() => {
            setComposerFor(null);
            refetch();
          }}
        />
      )}

      {creating && (
        <NewPublicationDialog
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            setTab("to_publish");
            tabRef.current = "to_publish";
            const list = await refetch();
            const created = list.find((p) => p.id === id);
            if (created) setComposerFor(created);
          }}
        />
      )}
    </div>
  );
}
