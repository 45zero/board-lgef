"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Clock,
  CheckCircle2,
  Video,
  Image as ImageIcon,
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
} from "lucide-react";
import {
  listMediaPublications,
  countMediaPublications,
  scheduleMediaPublication,
  cancelScheduledPublication,
  markMediaPublished,
  type MediaPublication,
  type PublicationStatus,
  type PublicationTargets,
} from "@/lib/board/mediaPublications";
import {
  getEventFileViewUrl,
  createEventFileShareUrl,
  publishToYoutube,
  publishToSocial,
  describeSocialFailures,
  type PublishInfo,
  type SocialPublishTarget,
} from "@/lib/board/eventFiles";
import { shareBoardDriveFile } from "@/app/actions/drive-share";
import { refreshSocialStats, getSocialComments, deleteSocialComment } from "@/app/actions/social";
import {
  SOCIAL_TARGETS,
  FACEBOOK_REGIONS,
  isInstagramCompatible,
  type SocialComment,
  type SocialTargetKey,
} from "@/lib/social/targets";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { personName } from "@/components/board/calendar/EventTabs";
import { YoutubeIcon, FacebookIcon, TiktokIcon, InstagramIcon } from "@/components/board/publication/BrandIcons";

const TABS: { id: PublicationStatus; label: string; icon: typeof Send }[] = [
  { id: "to_publish", label: "À publier", icon: Send },
  { id: "scheduled", label: "Programmés", icon: Clock },
  { id: "published", label: "Publiés", icon: CheckCircle2 },
];

const compactFormatter = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const numberFormatter = new Intl.NumberFormat("fr-FR");

/** Au-delà de ce délai, les stats d'une publication sont rafraîchies automatiquement à l'ouverture de l'onglet « Publiés ». */
const STATS_STALE_MS = 60 * 60_000;
const AUTO_REFRESH_LIMIT = 20;

function getSocialEntry(info: PublishInfo | null | undefined, key: SocialTargetKey): SocialPublishTarget | undefined {
  if (!info) return undefined;
  return key === "instagram" ? info.instagram : info.facebook?.[key];
}

function publishedSocialEntries(pub: MediaPublication) {
  return SOCIAL_TARGETS.map((t) => ({ ...t, info: getSocialEntry(pub.event_files.publish_info, t.key) })).filter(
    (e): e is typeof e & { info: SocialPublishTarget } => !!e.info?.published
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

function MediaThumb({ pub, className }: { pub: MediaPublication; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = (pub.event_files.content_type ?? "").startsWith("image");
  const isVideo = (pub.event_files.content_type ?? "").startsWith("video");

  useEffect(() => {
    if (!isImage) return;
    getEventFileViewUrl(pub.event_files).then(setUrl);
  }, [pub.event_files, isImage]);

  return (
    <div
      className={
        className ?? "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-btn bg-subtle"
      }
    >
      {isImage && url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire, pas un asset statique optimisable
        <img src={url} alt={pub.event_files.filename} className="h-full w-full object-cover" />
      ) : isVideo ? (
        <Video size={20} className="text-ink-4" />
      ) : (
        <ImageIcon size={20} className="text-ink-4" />
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

/** Commentaires lus en direct sur Facebook/Instagram à l'ouverture (jamais stockés), supprimables depuis le board. */
function CommentsSection({ fileId, targetKey, count }: { fileId: string; targetKey: SocialTargetKey; count?: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<SocialComment[] | null>(null);

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (comments) return;
    setLoading(true);
    const res = await getSocialComments(fileId, targetKey);
    setError(res.error);
    setComments(res.comments);
    setLoading(false);
  };

  const remove = async (commentId: string) => {
    if (!confirm("Supprimer ce commentaire sur le réseau ? Action irréversible.")) return;
    const res = await deleteSocialComment(fileId, targetKey, commentId);
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

function SocialDetail({ pub, entry }: { pub: MediaPublication; entry: ReturnType<typeof publishedSocialEntries>[number] }) {
  const { info } = entry;
  const stats = info.stats;
  const isInstagram = entry.plateforme === "INSTAGRAM";
  const by = info.by ? personName({ ...info.by, email: null }) : null;

  return (
    <div className="mt-2 space-y-2 border-t border-dashed border-line pt-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-3">
        <span className="font-semibold text-ink-2">
          {isInstagram ? "Instagram" : "Facebook"} · {entry.label}
        </span>
        {info.at && (
          <span>
            publié le {new Date(info.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
            {by && by !== "—" ? ` par ${by}` : ""}
          </span>
        )}
        {info.permalink && (
          <a href={info.permalink} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 font-semibold text-link hover:underline">
            <ExternalLink size={11} /> Voir la publication
          </a>
        )}
      </div>

      {stats ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <StatTile icon={Eye} label="Vues" value={stats.views} />
            {isInstagram && <StatTile icon={Users} label="Portée" value={stats.reach} />}
            <StatTile icon={Heart} label={isInstagram ? "J'aime" : "Réactions"} value={stats.likes} />
            <StatTile icon={MessageCircle} label="Comm." value={stats.comments} />
            {!isInstagram && <StatTile icon={Repeat2} label="Partages" value={stats.shares} />}
          </div>
          <p className="text-[10px] text-ink-4">Stats mises à jour {timeAgo(stats.fetchedAt)}</p>
        </>
      ) : (
        <p className="text-[11px] italic text-ink-4">Stats pas encore récupérées — cliquez sur « Rafraîchir les stats ».</p>
      )}

      {(info.videoId || info.postId) && <CommentsSection fileId={pub.event_files.id} targetKey={entry.key} count={stats?.comments} />}
    </div>
  );
}

/** Une pastille par réseau/page publié, avec la stat principale visible sans clic — cliquer ouvre le détail (toutes les stats, lien, commentaires). */
function PublishedStatsRow({ pub }: { pub: MediaPublication }) {
  const [openKey, setOpenKey] = useState<SocialTargetKey | null>(null);
  const yt = pub.event_files.publish_info?.youtube;
  const entries = publishedSocialEntries(pub);
  const openEntry = entries.find((e) => e.key === openKey);

  return (
    <div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {yt?.published && (
          <a
            href={yt.videoId ? `https://www.youtube.com/watch?v=${yt.videoId}` : undefined}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-full bg-bad-bg px-2 py-0.5 text-[10px] font-bold text-bad"
          >
            <YoutubeIcon size={11} /> YouTube
          </a>
        )}
        {entries.map((e) => {
          const Icon = e.plateforme === "INSTAGRAM" ? InstagramIcon : FacebookIcon;
          const stats = e.info.stats;
          const headline = stats?.views !== undefined ? { icon: Eye, value: stats.views } : stats ? { icon: Heart, value: stats.likes } : null;
          const HeadlineIcon = headline?.icon;
          return (
            <button
              key={e.key}
              onClick={() => setOpenKey((prev) => (prev === e.key ? null : e.key))}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 transition-colors ${
                e.plateforme === "INSTAGRAM" ? "bg-subtle text-ink-2" : "bg-sel-bg text-link"
              } ${openKey === e.key ? "ring-current" : "ring-transparent"}`}
            >
              <Icon size={11} /> {e.label}
              {headline && HeadlineIcon && (
                <span className="ml-0.5 flex items-center gap-0.5 font-semibold opacity-80">
                  · <HeadlineIcon size={10} /> {compactFormatter.format(headline.value)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {openEntry && <SocialDetail pub={pub} entry={openEntry} />}
    </div>
  );
}

/** Totaux de l'onglet « Publiés » + rafraîchissement manuel des stats Meta. */
function StatsToolbar({ items, refreshing, onRefresh }: { items: MediaPublication[]; refreshing: boolean; onRefresh: () => void }) {
  const totals = useMemo(() => {
    const t = { views: 0, likes: 0, comments: 0, shares: 0, posts: 0, lastFetch: null as string | null };
    for (const pub of items) {
      for (const e of publishedSocialEntries(pub)) {
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
      <StatTile icon={Heart} label="Réactions" value={totals.likes} />
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
          {totals.posts} publication{totals.posts > 1 ? "s" : ""} Facebook/Instagram
          {totals.lastFetch ? ` · maj ${timeAgo(totals.lastFetch)}` : ""}
        </span>
      </div>
    </div>
  );
}

function Composer({
  pub,
  onClose,
  onDone,
}: {
  pub: MediaPublication;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [caption, setCaption] = useState(pub.caption ?? "");
  const [youtube, setYoutube] = useState(!!pub.targets.youtube);
  const [fb, setFb] = useState({
    lorraine: !!pub.targets.facebook?.lorraine,
    champagne_ardenne: !!pub.targets.facebook?.champagne_ardenne,
    alsace: !!pub.targets.facebook?.alsace,
  });
  const [instagram, setInstagram] = useState(!!pub.targets.instagram);
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<{ first_name: string | null; last_name: string | null } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single().then(({ data }) => setMe(data ?? null));
  }, [user?.id]);

  const contentType = pub.event_files.content_type ?? "";
  const isVideo = contentType.startsWith("video");
  const isImage = contentType.startsWith("image");
  // YouTube : vidéos uniquement. Facebook : photos et vidéos. Instagram : vidéos et photos JPEG.
  const canYoutube = isVideo;
  const canFacebook = isVideo || isImage;
  const canInstagram = isInstagramCompatible(contentType);
  const anyTarget = (canYoutube && youtube) || (canFacebook && (fb.lorraine || fb.champagne_ardenne || fb.alsace)) || (canInstagram && instagram);

  const targets: PublicationTargets = { youtube, facebook: fb, instagram };

  const publishNow = async () => {
    if (!confirm("Publier maintenant sur les réseaux sélectionnés ? Action publique et non réversible.")) return;
    setBusy(true);
    const failures: string[] = [];
    let anyOk = false;
    try {
      if (canYoutube && youtube) {
        try {
          await publishToYoutube(pub.event_files, { title: pub.events?.title ?? pub.event_files.filename, description: caption }, me);
          anyOk = true;
        } catch (e) {
          failures.push(`YouTube : ${e instanceof Error ? e.message : "échec"}`);
        }
      }

      const socialTargets = [
        ...(canFacebook ? FACEBOOK_REGIONS.filter((r) => fb[r.key]).map((r) => ({ key: r.key as SocialTargetKey, caption })) : []),
        ...(canInstagram && instagram ? [{ key: "instagram" as SocialTargetKey, caption }] : []),
      ];
      if (socialTargets.length > 0) {
        try {
          const results = await publishToSocial(pub.event_files, socialTargets, me);
          anyOk ||= results.some((r) => r.ok);
          const socialFailures = describeSocialFailures(results);
          if (socialFailures) failures.push(socialFailures);
        } catch (e) {
          failures.push(e instanceof Error ? e.message : "Échec de la publication Facebook/Instagram.");
        }
      }

      if (anyOk) await markMediaPublished(pub.id);
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
      await scheduleMediaPublication(pub.id, { caption, targets, scheduledAt: new Date(scheduledAt).toISOString() });
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la programmation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-modal border border-line bg-card p-5 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">{pub.event_files.filename}</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-ink-4">
          Événement : {pub.events?.title ?? "—"} — {pub.event_files.filename}
        </p>

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={4}
          placeholder="Texte de la publication…"
          className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
        />

        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Réseaux</div>

          <label
            className={`flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm font-semibold ${
              canYoutube ? "text-ink cursor-pointer" : "cursor-not-allowed text-ink-4 opacity-50"
            }`}
          >
            <input type="checkbox" disabled={!canYoutube} checked={youtube} onChange={(e) => setYoutube(e.target.checked)} />
            <YoutubeIcon size={16} /> YouTube
            {!canYoutube && <span className="ml-auto text-[10px] font-normal">Vidéos uniquement</span>}
          </label>

          <div className={`space-y-1.5 rounded-btn border border-line px-3 py-2 ${canFacebook ? "" : "opacity-50"}`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <FacebookIcon size={16} /> Facebook
            </div>
            {FACEBOOK_REGIONS.map((r) => (
              <label key={r.key} className={`flex items-center gap-2 pl-1 text-xs ${canFacebook ? "cursor-pointer text-ink-2" : "cursor-not-allowed text-ink-4"}`}>
                <input
                  type="checkbox"
                  disabled={!canFacebook}
                  checked={fb[r.key]}
                  onChange={(e) => setFb((prev) => ({ ...prev, [r.key]: e.target.checked }))}
                />
                {r.label}
              </label>
            ))}
          </div>

          <label
            className={`flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm font-semibold ${
              canInstagram ? "text-ink cursor-pointer" : "cursor-not-allowed text-ink-4 opacity-50"
            }`}
          >
            <input type="checkbox" disabled={!canInstagram} checked={instagram} onChange={(e) => setInstagram(e.target.checked)} />
            <InstagramIcon size={16} /> Instagram <span className="text-xs font-normal text-ink-3">@lgefofficiel</span>
            {!canInstagram && <span className="ml-auto text-[10px] font-normal">Vidéo ou photo JPEG</span>}
          </label>

          <div className="flex items-center gap-2 rounded-btn border border-dashed border-line px-3 py-2 text-sm font-semibold text-ink-4 opacity-60">
            <TiktokIcon size={16} /> TikTok <span className="ml-auto text-[10px] font-normal">Bientôt disponible</span>
          </div>

          {!canFacebook && (
            <p className="text-[11px] italic text-ink-4">
              Seules les photos et les vidéos peuvent être publiées automatiquement.
            </p>
          )}
          {canInstagram && instagram && isVideo && (
            <p className="text-[11px] italic text-ink-4">
              Instagram publie la vidéo en Reel : le traitement côté Meta peut prendre jusqu&rsquo;à une minute.
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

function PublicationCard({
  pub,
  tab,
  onOpenComposer,
  onCancelSchedule,
}: {
  pub: MediaPublication;
  tab: PublicationStatus;
  onOpenComposer: () => void;
  onCancelSchedule: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const isDrive = pub.event_files.storage_provider === "drive";
  const uploader = personName(pub.event_files.uploaded_by_profile);
  const uploadedAt = new Date(pub.event_files.created_at).toLocaleDateString("fr-FR");

  const openMedia = async () => {
    const url = await getEventFileViewUrl(pub.event_files);
    if (url) window.open(url, "_blank", "noreferrer");
  };

  const share = async () => {
    setSharing(true);
    try {
      let url: string | null = null;
      if (isDrive && pub.event_files.drive_file_id) {
        await shareBoardDriveFile(pub.event_files.drive_file_id);
        url = pub.event_files.drive_web_view_link;
      } else if (pub.event_files.path) {
        url = await createEventFileShareUrl(pub.event_files.path);
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

  return (
    <div className="flex items-center gap-3 border-b border-line bg-card px-4 py-3 last:border-b-0 hover:bg-hover">
      <MediaThumb pub={pub} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold text-ink">{pub.events?.title ?? "Événement"}</span>
          {isDrive && (
            <span className="shrink-0 rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">
              Drive
            </span>
          )}
        </div>
        <div className="truncate text-xs text-ink-4">{pub.event_files.filename}</div>
        <div className="mt-0.5 text-[11px] text-ink-4">
          {uploader} · {uploadedAt}
          {tab === "scheduled" && pub.scheduled_at && (
            <span className="ml-2 font-semibold text-link">
              {new Date(pub.scheduled_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
            </span>
          )}
        </div>
        {tab === "published" && <PublishedStatsRow pub={pub} />}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button onClick={openMedia} className="flex items-center gap-1 text-[11px] font-semibold text-ink-3 hover:text-ink">
          {isDrive ? <ExternalLink size={12} /> : <Play size={12} />}
          {isDrive ? "Voir sur Drive" : "Lire"}
        </button>
        <button
          onClick={share}
          disabled={sharing}
          className="flex items-center gap-1 text-[11px] font-semibold text-ink-3 hover:text-ink disabled:opacity-50"
        >
          <Share2 size={12} /> {sharing ? "…" : "Partager"}
        </button>

        {tab === "to_publish" && (
          <button
            onClick={onOpenComposer}
            className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white"
          >
            Publier / Programmer
          </button>
        )}
        {tab === "scheduled" && (
          <button
            onClick={onCancelSchedule}
            className="rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2"
          >
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
  const [counts, setCounts] = useState<Record<PublicationStatus, number>>({
    to_publish: 0,
    scheduled: 0,
    published: 0,
  });
  const [loading, setLoading] = useState(true);
  const [composerFor, setComposerFor] = useState<MediaPublication | null>(null);
  const [refreshingStats, setRefreshingStats] = useState(false);
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const refetch = async () => {
    setLoading(true);
    const [list, countRes] = await Promise.all([listMediaPublications(tab), countMediaPublications()]);
    setItems(list);
    setCounts(countRes);
    setLoading(false);
    return list;
  };

  /** Relit les stats sur Meta puis recharge la liste sans repasser par l'écran de chargement. */
  const refreshStats = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    setRefreshingStats(true);
    try {
      await refreshSocialStats(fileIds);
      const list = await listMediaPublications("published");
      // L'utilisateur a pu changer d'onglet pendant l'appel à Meta : ne pas écraser l'autre liste.
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
      const stale = list.filter((p) => publishedSocialEntries(p).some((e) => isStale(e.info))).slice(0, AUTO_REFRESH_LIMIT);
      refreshStats(stale.map((p) => p.event_files.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="flex h-full gap-4 p-4">
      <aside className="w-[220px] shrink-0 rounded-panel border border-line bg-card p-3">
        <div className="mb-3 px-1 text-sm font-extrabold text-ink">Centre de publication</div>
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
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    tab === t.id ? "bg-white/20 text-white" : "bg-subtle text-ink-3"
                  }`}
                >
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
          {tab === "published" && (
            <StatsToolbar
              items={items}
              refreshing={refreshingStats}
              onRefresh={() => refreshStats(items.filter((p) => publishedSocialEntries(p).length > 0).map((p) => p.event_files.id))}
            />
          )}
          <div className="overflow-hidden rounded-panel border border-line">
            {items.map((pub) => (
              <PublicationCard
                key={pub.id}
                pub={pub}
                tab={tab}
                onOpenComposer={() => setComposerFor(pub)}
                onCancelSchedule={async () => {
                  await cancelScheduledPublication(pub.id);
                  refetch();
                }}
              />
            ))}
          </div>
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
    </div>
  );
}
