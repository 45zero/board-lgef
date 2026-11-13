"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, Flag, Heart, ImagePlus, Loader2, MessageCircle, MoreHorizontal, Pencil, Pin, Send, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Fil d'actualités FIEF (sql/2026-11-13_fief_social.sql) : publier (texte + photos), aimer, commenter,
// signaler. Lectures par les fonctions fief_feed / fief_post_comments, écritures par /api/fief/feed.
// Utilisé côté membres (fief.lgef.fr) et dans l'onglet FIEF du board (équipe FIEF : épingler, masquer).

export interface FeedAuthor {
  id: string;
  name: string;
  club: string | null;
  team: boolean;
}

interface FeedPost {
  id: string;
  author: FeedAuthor;
  body: string;
  pinned: boolean;
  hidden: boolean;
  created_at: string;
  edited_at: string | null;
  media: { id: string; mime: string; w: number | null; h: number | null }[];
  like_count: number;
  liked: boolean;
  comment_count: number;
  mine: boolean;
}

interface FeedComment {
  id: string;
  author: FeedAuthor;
  body: string;
  hidden: boolean;
  created_at: string;
  mine: boolean;
}

export interface FeedModeration {
  setPost: (postId: string, change: { pinned?: boolean; hidden?: boolean }) => Promise<string | null>;
  setComment: (commentId: string, hidden: boolean) => Promise<string | null>;
}

const mediaUrl = (id: string) => `/api/fief/media/${id}`;

async function api<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ ok: false, error: "Réponse illisible." }));
  if (!res.ok || !json.ok) throw new Error(json.error ?? "Action impossible.");
  return json as T;
}

export function ago(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h} h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `Il y a ${d} j` : new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function Avatar({ author, size = 40 }: { author: FeedAuthor; size?: number }) {
  if (author.team)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/fief/icon-192.png" alt="" width={size} height={size} className="shrink-0 rounded-full" style={{ width: size, height: size }} />
    );
  const initials = author.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-[#1B3A73] font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </span>
  );
}

/** Réduit une photo (2000 px max, JPEG) avant envoi : poids raisonnable, orientation respectée. */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type === "image/gif") return { blob: file, width: 0, height: 0 };
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Photo illisible."))), "image/jpeg", 0.85));
  return { blob, width, height };
}

async function fetchComments(postId: string) {
  const { data } = await createClient().rpc("fief_post_comments", { p_post: postId });
  return (data ?? []) as FeedComment[];
}

export function Feed({ moderation, focusPostId, messageHref }: { moderation?: FeedModeration; focusPostId?: string | null; messageHref?: (userId: string) => string }) {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before: string | null) => {
    const { data, error: e } = await createClient().rpc("fief_feed", { p_before: before, p_limit: 20 });
    if (e) throw new Error("Le fil est indisponible pour le moment.");
    return (data ?? []) as FeedPost[];
  }, []);

  const refresh = useCallback(() => {
    load(null)
      .then((list) => {
        setPosts(list);
        setMore(list.length === 20);
      })
      .catch((e: Error) => setError(e.message));
  }, [load]);
  useEffect(refresh, [refresh]);

  const loadMore = async () => {
    if (!posts?.length) return;
    setLoadingMore(true);
    const last = posts.filter((p) => !p.pinned).at(-1) ?? posts.at(-1)!;
    const list = await load(last.created_at).catch(() => [] as FeedPost[]);
    setPosts((prev) => [...(prev ?? []), ...list.filter((p) => !(prev ?? []).some((x) => x.id === p.id))]);
    setMore(list.length === 20);
    setLoadingMore(false);
  };

  const update = (id: string, patch: Partial<FeedPost> | null) =>
    setPosts((prev) => (prev ?? []).flatMap((p) => (p.id !== id ? [p] : patch === null ? [] : [{ ...p, ...patch }])));

  return (
    <div className="space-y-4">
      <Composer canPostAsTeam={!!moderation} onPosted={refresh} />
      {error && <p className="rounded-xl bg-[#FDECEC] px-3 py-2 text-sm text-[#B91F26]">{error}</p>}
      {posts === null && !error && (
        <div className="flex justify-center py-10 text-[#5B6B86]">
          <Loader2 className="animate-spin" />
        </div>
      )}
      {posts?.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-[#5B6B86] shadow-sm">Pas encore de publication : lancez la conversation !</div>}
      {posts?.map((p) => (
        <PostCard key={p.id} post={p} moderation={moderation} startOpen={p.id === focusPostId} onChange={(patch) => update(p.id, patch)} messageHref={messageHref} />
      ))}
      {more && posts && posts.length > 0 && (
        <button onClick={() => void loadMore()} disabled={loadingMore} className="w-full rounded-xl bg-white py-3 text-sm font-bold text-[#0E2754] shadow-sm disabled:opacity-60">
          {loadingMore ? "Chargement…" : "Voir plus"}
        </button>
      )}
    </div>
  );
}

function Composer({ canPostAsTeam, onPosted }: { canPostAsTeam: boolean; onPosted: () => void }) {
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<{ key: string; preview: string; id: string | null; error?: string }[]>([]);
  const [asTeam, setAsTeam] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = async (files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, 6 - photos.length);
    for (const file of list) {
      const key = crypto.randomUUID();
      const preview = URL.createObjectURL(file);
      setPhotos((prev) => [...prev, { key, preview, id: null }]);
      try {
        const { blob, width, height } = await shrink(file);
        const form = new FormData();
        form.append("file", new File([blob], file.name, { type: blob.type || file.type }));
        if (width) form.append("width", String(width));
        if (height) form.append("height", String(height));
        const res = await fetch("/api/fief/media", { method: "POST", body: form });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Envoi impossible.");
        setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, id: json.id } : p)));
      } catch (e) {
        setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, error: e instanceof Error ? e.message : "Envoi impossible." } : p)));
      }
    }
  };

  const uploading = photos.some((p) => !p.id && !p.error);
  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/fief/feed", { action: "post", body, mediaIds: photos.filter((p) => p.id).map((p) => p.id), asTeam: canPostAsTeam && asTeam });
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
      setBody("");
      setPhotos([]);
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publication impossible.");
    }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={body.split("\n").length > 2 ? 4 : 2}
        maxLength={5000}
        placeholder="Partagez une actualité, une question, une réussite…"
        className="w-full resize-none rounded-xl border border-[#DCE3EF] px-3.5 py-3 text-[15px] text-[#0E2754] outline-none placeholder:text-[#94A3B8] focus:border-[#0E2754]"
      />
      {photos.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {photos.map((p) => (
            <div key={p.key} className="relative aspect-square overflow-hidden rounded-xl bg-[#EEF2F8]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className={`h-full w-full object-cover ${p.id ? "" : "opacity-50"}`} />
              {!p.id && !p.error && <Loader2 size={20} className="absolute inset-0 m-auto animate-spin text-[#0E2754]" />}
              {p.error && <span className="absolute inset-x-1 bottom-1 rounded bg-[#B91F26] px-1 text-[10px] text-white">{p.error}</span>}
              <button
                type="button"
                onClick={() => setPhotos((prev) => prev.filter((x) => x.key !== p.key))}
                aria-label="Retirer la photo"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-[#B91F26]">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const target = e.target;
            void add(target.files).then(() => {
              target.value = "";
            });
          }}
        />
        <button
          type="button"
          disabled={photos.length >= 6}
          onClick={() => input.current?.click()}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-[#1B3A73] hover:bg-[#EEF2F8] disabled:opacity-50"
        >
          <ImagePlus size={18} /> Photos
        </button>
        {canPostAsTeam && (
          <label className="flex items-center gap-2 text-sm text-[#5B6B86]">
            <input type="checkbox" checked={asTeam} onChange={(e) => setAsTeam(e.target.checked)} className="accent-[#0E2754]" /> Au nom de l&apos;équipe FIEF
          </label>
        )}
        <button
          type="button"
          disabled={busy || uploading || (!body.trim() && !photos.some((p) => p.id))}
          onClick={() => void publish()}
          className="ml-auto flex items-center gap-2 rounded-xl bg-[#0E2754] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          <Send size={15} /> {busy ? "Publication…" : uploading ? "Envoi des photos…" : "Publier"}
        </button>
      </div>
    </div>
  );
}

function PhotoGrid({ media, onOpen }: { media: FeedPost["media"]; onOpen: (i: number) => void }) {
  if (!media.length) return null;
  const cols = media.length === 1 ? "grid-cols-1" : media.length === 2 || media.length === 4 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className={`mt-3 grid gap-1 overflow-hidden rounded-xl ${cols}`}>
      {media.map((m, i) => (
        <button key={m.id} type="button" onClick={() => onOpen(i)} className={`relative bg-[#EEF2F8] ${media.length === 1 ? "max-h-[520px]" : "aspect-square"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl(m.id)} alt="" loading="lazy" className={`h-full w-full ${media.length === 1 ? "max-h-[520px] object-contain" : "object-cover"}`} />
        </button>
      ))}
    </div>
  );
}

function Lightbox({ media, index, onClose }: { media: FeedPost["media"]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl(media[i].id)} alt="" className="max-h-[92dvh] max-w-[96vw] object-contain" onClick={(e) => e.stopPropagation()} />
      {media.length > 1 && (
        <div className="absolute bottom-6 flex gap-2" onClick={(e) => e.stopPropagation()}>
          {media.map((m, j) => (
            <button key={m.id} onClick={() => setI(j)} aria-label={`Photo ${j + 1}`} className={`h-2.5 w-2.5 rounded-full ${j === i ? "bg-white" : "bg-white/40"}`} />
          ))}
        </div>
      )}
      <button onClick={onClose} aria-label="Fermer" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white">
        <X size={22} />
      </button>
    </div>
  );
}

function PostCard({
  post,
  moderation,
  startOpen,
  onChange,
  messageHref,
}: {
  post: FeedPost;
  moderation?: FeedModeration;
  startOpen: boolean;
  onChange: (patch: Partial<FeedPost> | null) => void;
  messageHref?: (userId: string) => string;
}) {
  const [showComments, setShowComments] = useState(startOpen);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (startOpen) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [startOpen]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setMenu(false);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    }
  };
  const like = () =>
    run(async () => {
      onChange({ liked: !post.liked, like_count: post.like_count + (post.liked ? -1 : 1) });
      const r = await api<{ liked: boolean; count: number }>("/api/fief/feed", { action: "like", postId: post.id });
      onChange({ liked: r.liked, like_count: r.count });
    });
  const remove = () =>
    run(async () => {
      if (!window.confirm("Supprimer cette publication ?")) return;
      await api("/api/fief/feed", { action: "delete", postId: post.id });
      onChange(null);
    });
  const report = () =>
    run(async () => {
      const reason = window.prompt("Pourquoi signalez-vous cette publication ? (facultatif)");
      if (reason === null) return;
      await api("/api/fief/feed", { action: "report", postId: post.id, reason });
      window.alert("Merci : l'équipe FIEF va regarder.");
    });
  const saveEdit = () =>
    run(async () => {
      await api("/api/fief/feed", { action: "edit", postId: post.id, body: draft });
      onChange({ body: draft.trim(), edited_at: new Date().toISOString() });
      setEditing(false);
    });
  const moderate = (change: { pinned?: boolean; hidden?: boolean }) =>
    run(async () => {
      const err = await moderation!.setPost(post.id, change);
      if (err) throw new Error(err);
      onChange(change.hidden !== undefined ? { hidden: change.hidden } : { pinned: change.pinned });
    });

  const canMessage = !!messageHref && !post.mine && !post.author.team;
  return (
    <article ref={ref} className={`rounded-2xl bg-white p-4 shadow-sm ${post.hidden ? "opacity-70 ring-2 ring-[#F3C9CB]" : ""}`}>
      <header className="flex items-start gap-3">
        <Avatar author={post.author} />
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-tight">
            {canMessage ? (
              <Link href={messageHref!(post.author.id)} className="hover:underline" title="Envoyer un message">
                {post.author.name}
              </Link>
            ) : (
              post.author.name
            )}
          </p>
          <p className="text-xs text-[#5B6B86]">{[post.author.club, ago(post.created_at), post.edited_at ? "modifié" : null].filter(Boolean).join(" · ")}</p>
        </div>
        {post.pinned && (
          <span className="flex items-center gap-1 rounded-full bg-[#EEF2F8] px-2 py-0.5 text-[11px] font-semibold text-[#1B3A73]">
            <Pin size={11} /> Épinglé
          </span>
        )}
        {post.hidden && (
          <span className="flex items-center gap-1 rounded-full bg-[#FDECEC] px-2 py-0.5 text-[11px] font-semibold text-[#B91F26]">
            <EyeOff size={11} /> Masqué
          </span>
        )}
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} aria-label="Options" className="rounded-full p-1.5 text-[#5B6B86] hover:bg-[#EEF2F8]">
            <MoreHorizontal size={18} />
          </button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-[#DCE3EF] bg-white py-1 text-sm shadow-lg">
              {post.mine && (
                <MenuItem
                  icon={Pencil}
                  onClick={() => {
                    setMenu(false);
                    setEditing(true);
                  }}
                >
                  Modifier
                </MenuItem>
              )}
              {moderation && (
                <>
                  <MenuItem icon={Pin} onClick={() => void moderate({ pinned: !post.pinned })}>
                    {post.pinned ? "Désépingler" : "Épingler en haut du fil"}
                  </MenuItem>
                  <MenuItem icon={EyeOff} onClick={() => void moderate({ hidden: !post.hidden })}>
                    {post.hidden ? "Rendre visible" : "Masquer aux membres"}
                  </MenuItem>
                </>
              )}
              {(post.mine || moderation) && (
                <MenuItem icon={Trash2} danger onClick={() => void remove()}>
                  Supprimer
                </MenuItem>
              )}
              {!post.mine && !moderation && (
                <MenuItem icon={Flag} onClick={() => void report()}>
                  Signaler
                </MenuItem>
              )}
            </div>
          )}
        </div>
      </header>

      {editing ? (
        <div className="mt-3 space-y-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} maxLength={5000} className="w-full rounded-xl border border-[#DCE3EF] px-3 py-2 text-[15px] outline-none focus:border-[#0E2754]" />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setEditing(false);
                setDraft(post.body);
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-[#5B6B86]"
            >
              Annuler
            </button>
            <button onClick={() => void saveEdit()} className="rounded-lg bg-[#0E2754] px-3 py-1.5 text-sm font-bold text-white">
              Enregistrer
            </button>
          </div>
        </div>
      ) : (
        post.body && <p className="mt-3 whitespace-pre-line break-words text-[15px] leading-relaxed">{post.body}</p>
      )}
      <PhotoGrid media={post.media} onOpen={setLightbox} />
      {error && <p className="mt-2 text-sm text-[#B91F26]">{error}</p>}

      <footer className="mt-3 flex items-center gap-1 border-t border-[#EEF2F8] pt-2 text-sm font-semibold text-[#5B6B86]">
        <button onClick={() => void like()} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 hover:bg-[#EEF2F8] ${post.liked ? "text-[#D7262E]" : ""}`}>
          <Heart size={18} fill={post.liked ? "currentColor" : "none"} /> {post.like_count || ""}
        </button>
        <button onClick={() => setShowComments((s) => !s)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 hover:bg-[#EEF2F8]">
          <MessageCircle size={18} /> {post.comment_count || ""}
          <span className="hidden sm:inline">Commenter</span>
        </button>
      </footer>

      {showComments && <Comments postId={post.id} moderation={moderation} onCount={(n) => onChange({ comment_count: n })} />}
      {lightbox !== null && <Lightbox media={post.media} index={lightbox} onClose={() => setLightbox(null)} />}
    </article>
  );
}

function MenuItem({ icon: Icon, children, onClick, danger }: { icon: typeof Pin; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[#F3F6FB] ${danger ? "text-[#B91F26]" : "text-[#0E2754]"}`}>
      <Icon size={15} /> {children}
    </button>
  );
}

function Comments({ postId, moderation, onCount }: { postId: string; moderation?: FeedModeration; onCount: (n: number) => void }) {
  const [list, setList] = useState<FeedComment[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchComments(postId).then((l) => {
      if (alive) setList(l);
    });
    return () => {
      alive = false;
    };
  }, [postId]);

  const reload = async () => {
    const next = await fetchComments(postId);
    setList(next);
    onCount(next.filter((c) => !c.hidden).length);
  };
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/fief/feed", { action: "comment", postId, body, asTeam: !!moderation });
      setBody("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commentaire impossible.");
    }
    setBusy(false);
  };
  const act = async (c: FeedComment, what: "delete" | "report" | "hide") => {
    setError(null);
    try {
      if (what === "delete") {
        if (!window.confirm("Supprimer ce commentaire ?")) return;
        await api("/api/fief/feed", { action: "deleteComment", commentId: c.id });
      } else if (what === "report") {
        const reason = window.prompt("Pourquoi signalez-vous ce commentaire ? (facultatif)");
        if (reason === null) return;
        await api("/api/fief/feed", { action: "report", commentId: c.id, reason });
        window.alert("Merci : l'équipe FIEF va regarder.");
        return;
      } else {
        const err = await moderation!.setComment(c.id, !c.hidden);
        if (err) throw new Error(err);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    }
  };

  return (
    <div className="mt-2 space-y-3 border-t border-[#EEF2F8] pt-3">
      {list === null && <p className="text-sm text-[#5B6B86]">Chargement…</p>}
      {list?.map((c) => (
        <div key={c.id} className={`flex gap-2.5 ${c.hidden ? "opacity-60" : ""}`}>
          <Avatar author={c.author} size={32} />
          <div className="min-w-0 flex-1">
            <div className="rounded-2xl bg-[#F3F6FB] px-3 py-2">
              <p className="text-sm font-bold">
                {c.author.name}
                {c.hidden && <span className="ml-2 text-[11px] font-semibold text-[#B91F26]">masqué</span>}
              </p>
              <p className="whitespace-pre-line break-words text-sm">{c.body}</p>
            </div>
            <div className="mt-0.5 flex gap-3 px-2 text-[11px] font-semibold text-[#8A97AD]">
              <span>{ago(c.created_at)}</span>
              {(c.mine || moderation) && (
                <button onClick={() => void act(c, "delete")} className="hover:text-[#B91F26]">
                  Supprimer
                </button>
              )}
              {moderation && (
                <button onClick={() => void act(c, "hide")} className="hover:text-[#0E2754]">
                  {c.hidden ? "Rendre visible" : "Masquer"}
                </button>
              )}
              {!c.mine && !moderation && (
                <button onClick={() => void act(c, "report")} className="hover:text-[#0E2754]">
                  Signaler
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-[#B91F26]">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Écrire un commentaire…"
          className="min-h-[40px] flex-1 resize-none rounded-2xl border border-[#DCE3EF] px-3.5 py-2 text-sm outline-none focus:border-[#0E2754]"
        />
        <button onClick={() => void send()} disabled={busy || !body.trim()} aria-label="Envoyer" className="rounded-full bg-[#0E2754] p-2.5 text-white disabled:opacity-50">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
