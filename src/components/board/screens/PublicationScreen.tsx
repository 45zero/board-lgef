"use client";

import { useEffect, useState } from "react";
import { Send, Clock, CheckCircle2, Video, Image as ImageIcon, X, Calendar, Play, Share2, ExternalLink } from "lucide-react";
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
import { getEventFileViewUrl, createEventFileShareUrl, publishToYoutube, publishToFacebook } from "@/lib/board/eventFiles";
import { shareBoardDriveFile } from "@/app/actions/drive-share";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { personName } from "@/components/board/calendar/EventTabs";
import { YoutubeIcon, FacebookIcon, TiktokIcon, InstagramIcon } from "@/components/board/publication/BrandIcons";

const TABS: { id: PublicationStatus; label: string; icon: typeof Send }[] = [
  { id: "to_publish", label: "À publier", icon: Send },
  { id: "scheduled", label: "Programmés", icon: Clock },
  { id: "published", label: "Publiés", icon: CheckCircle2 },
];

const FACEBOOK_REGIONS: { key: "lorraine" | "champagne_ardenne" | "alsace"; label: string }[] = [
  { key: "lorraine", label: "Lorraine" },
  { key: "champagne_ardenne", label: "Champagne-Ardenne" },
  { key: "alsace", label: "Alsace" },
];

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

function PublishedBadgeRow({ pub }: { pub: MediaPublication }) {
  const yt = pub.event_files.publish_info?.youtube;
  const fb = pub.event_files.publish_info?.facebook;
  const fbEntries = FACEBOOK_REGIONS.map((r) => ({ ...r, info: fb?.[r.key] })).filter((e) => e.info?.published);
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {yt?.published && (
        <span className="flex items-center gap-1 rounded-full bg-bad-bg px-2 py-0.5 text-[10px] font-bold text-bad">
          <YoutubeIcon size={11} /> YouTube
        </span>
      )}
      {fbEntries.map((e) => (
        <span
          key={e.key}
          className="flex items-center gap-1 rounded-full bg-sel-bg px-2 py-0.5 text-[10px] font-bold text-link"
        >
          <FacebookIcon size={11} /> {e.label}
        </span>
      ))}
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
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<{ first_name: string | null; last_name: string | null } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single().then(({ data }) => setMe(data ?? null));
  }, [user?.id]);

  const isVideo = (pub.event_files.content_type ?? "").startsWith("video");
  const canRealPublish = isVideo;
  const anyTarget = youtube || fb.lorraine || fb.champagne_ardenne || fb.alsace;

  const targets: PublicationTargets = { youtube, facebook: fb };

  const publishNow = async () => {
    if (!confirm("Publier maintenant sur les réseaux sélectionnés ? Action publique et non réversible.")) return;
    setBusy(true);
    try {
      if (youtube) {
        await publishToYoutube(pub.event_files, { title: pub.events?.title ?? pub.event_files.filename, description: caption }, me);
      }
      if (fb.lorraine || fb.champagne_ardenne || fb.alsace) {
        await publishToFacebook(
          pub.event_files,
          {
            lorraine: fb.lorraine ? { enabled: true, message: caption } : undefined,
            champagne_ardenne: fb.champagne_ardenne ? { enabled: true, message: caption } : undefined,
            alsace: fb.alsace ? { enabled: true, message: caption } : undefined,
          },
          me
        );
      }
      await markMediaPublished(pub.id);
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la publication.");
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
              canRealPublish ? "text-ink cursor-pointer" : "cursor-not-allowed text-ink-4 opacity-50"
            }`}
          >
            <input type="checkbox" disabled={!canRealPublish} checked={youtube} onChange={(e) => setYoutube(e.target.checked)} />
            <YoutubeIcon size={16} /> YouTube
          </label>

          <div className={`space-y-1.5 rounded-btn border border-line px-3 py-2 ${canRealPublish ? "" : "opacity-50"}`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <FacebookIcon size={16} /> Facebook
            </div>
            {FACEBOOK_REGIONS.map((r) => (
              <label key={r.key} className={`flex items-center gap-2 pl-1 text-xs ${canRealPublish ? "cursor-pointer text-ink-2" : "cursor-not-allowed text-ink-4"}`}>
                <input
                  type="checkbox"
                  disabled={!canRealPublish}
                  checked={fb[r.key]}
                  onChange={(e) => setFb((prev) => ({ ...prev, [r.key]: e.target.checked }))}
                />
                {r.label}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-btn border border-dashed border-line px-3 py-2 text-sm font-semibold text-ink-4 opacity-60">
            <TiktokIcon size={16} /> TikTok <span className="ml-auto text-[10px] font-normal">Bientôt disponible</span>
          </div>
          <div className="flex items-center gap-2 rounded-btn border border-dashed border-line px-3 py-2 text-sm font-semibold text-ink-4 opacity-60">
            <InstagramIcon size={16} /> Instagram <span className="ml-auto text-[10px] font-normal">Bientôt disponible</span>
          </div>

          {!canRealPublish && (
            <p className="text-[11px] italic text-ink-4">
              Seules les vidéos peuvent être publiées automatiquement pour l&rsquo;instant.
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
        {tab === "published" && <PublishedBadgeRow pub={pub} />}
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

  const refetch = async () => {
    setLoading(true);
    const [list, countRes] = await Promise.all([listMediaPublications(tab), countMediaPublications()]);
    setItems(list);
    setCounts(countRes);
    setLoading(false);
  };

  useEffect(() => {
    refetch();
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
