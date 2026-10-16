"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CornerUpLeft, FileText, Heart, Loader2, Mic, Paperclip, Pause, Play, Send, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createChatUpload, getChat, markChatRead, postChat, toggleLike } from "@/app/actions/chat";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { Avatar } from "@/components/board/team/TeamUi";
import { DISCUSSIONS_CHANGED, isAttachmentFallback, type ChatAttachment, type ChatAttachmentInput, type ChatMessage, type ChatPerson, type ChatSource } from "@/lib/board/discussions";

const BUCKET = "event-files";
const MAX_VOICE_MS = 5 * 60_000;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const asTeamPerson = (p: ChatPerson) => ({ ...p, email: null, managerId: null });
const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const sizeLabel = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`);
const kindOf = (type: string): ChatAttachmentInput["kind"] => (type.startsWith("image/") ? "image" : type.startsWith("audio/") ? "audio" : "file");
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
};
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Message clair selon la raison pour laquelle le micro n'a pas pu être ouvert. */
function micError(e: unknown) {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Micro bloqué : autorisez le micro pour ce site (icône à gauche de l'adresse), et sur Mac dans Réglages Système → Confidentialité et sécurité → Micro pour votre navigateur.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Aucun micro détecté sur cet appareil.";
  if (name === "NotReadableError" || name === "AbortError") return "Le micro est déjà utilisé par une autre application (visio, enregistreur…). Fermez-la et réessayez.";
  return `Micro indisponible${name ? ` (${name})` : ""}.`;
}

/** Envoi direct vers le stockage (URL signée), puis description de la pièce jointe pour le message. */
async function uploadAttachment(source: ChatSource, file: Blob, filename: string, durationMs?: number): Promise<ChatAttachmentInput> {
  const res = await createChatUpload(source, filename, file.size);
  if (!res.ok) throw new Error(res.error);
  const contentType = file.type || null;
  const { error } = await createClient().storage.from(BUCKET).uploadToSignedUrl(res.data.path, res.data.token, file, { contentType: contentType ?? undefined });
  if (error) throw new Error(error.message);
  return { path: res.data.path, filename, contentType, size: file.size, kind: durationMs != null ? "audio" : kindOf(file.type), durationMs: durationMs ?? null };
}

/* ---------- Pièces jointes ---------- */

function VoicePlayer({ att, mine }: { att: ChatAttachment; mine: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const total = att.durationMs ?? 0;
  return (
    <div className={`flex w-56 max-w-full items-center gap-2 rounded-full px-2 py-1.5 ${mine ? "bg-navy text-white" : "bg-subtle text-ink"}`}>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Écouter"}
        onClick={() => (audio.current?.paused ? void audio.current.play() : audio.current?.pause())}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${mine ? "bg-white text-navy" : "bg-navy text-white"}`}
      >
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${mine ? "bg-white/30" : "bg-line"}`}>
        <div className={`absolute inset-y-0 left-0 rounded-full ${mine ? "bg-white" : "bg-navy"}`} style={{ width: `${progress * 100}%` }} />
      </div>
      <span className={`shrink-0 font-mono text-[11px] ${mine ? "text-white/90" : "text-ink-3"}`}>{duration(progress ? progress * total : total)}</span>
      {att.url && (
        <audio
          ref={audio}
          src={att.url}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : total;
            if (d) setProgress(Math.min(1, (a.currentTime * 1000) / d));
          }}
        />
      )}
    </div>
  );
}

function Attachments({ items, mine }: { items: ChatAttachment[]; mine: boolean }) {
  const images = items.filter((a) => a.kind === "image");
  const others = items.filter((a) => a.kind !== "image");
  return (
    <div className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
      {images.length > 0 && (
        <div className={`grid gap-1 ${images.length > 1 ? "grid-cols-2" : ""}`}>
          {images.map((a) => (
            <a key={a.id} href={a.url ?? undefined} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- URL signée du stockage */}
              <img src={a.url ?? undefined} alt={a.filename} className="max-h-60 w-full max-w-[240px] object-cover" />
            </a>
          ))}
        </div>
      )}
      {others.map((a) =>
        a.kind === "audio" ? (
          <VoicePlayer key={a.id} att={a} mine={mine} />
        ) : (
          <a key={a.id} href={a.url ?? undefined} target="_blank" rel="noreferrer" className={`flex max-w-[240px] items-center gap-2 rounded-2xl px-3 py-2 ${mine ? "bg-navy text-white" : "bg-subtle text-ink"}`}>
            <FileText size={18} className="shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold">{a.filename}</span>
              <span className={`block text-[10px] ${mine ? "text-white/75" : "text-ink-4"}`}>{sizeLabel(a.size)}</span>
            </span>
          </a>
        )
      )}
    </div>
  );
}

/* ---------- Message ---------- */

function MessageBody({ body, people }: { body: string; people: ChatPerson[] }) {
  const names = people.map((p) => p.name).filter((n) => body.includes(`@${n}`));
  if (names.length === 0) return <>{body}</>;
  const re = new RegExp(`(${names.sort((a, b) => b.length - a.length).map((n) => escapeRegex(`@${n}`)).join("|")})`, "g");
  return (
    <>
      {body.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-bold underline decoration-1 underline-offset-2">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}

/** ❤️ d'un message : qui aime au survol (ou au toucher sur mobile), et bouton pour aimer / ne plus aimer. */
function Likes({ likes, mine, onToggle }: { likes: ChatMessage["likes"]; mine: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  if (!likes.names.length) return null;
  return (
    <div className={`group/likes relative z-[1] -mt-1.5 ${mine ? "mr-2" : "ml-2"}`} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Aimé par ${likes.names.join(", ")}`}
        className={`flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[11px] shadow-sm ${likes.mine ? "border-red/30 bg-[#fde8e9]" : "border-line bg-card"}`}
      >
        <span>❤️</span>
        {likes.names.length > 1 && <span className="font-semibold text-ink-3">{likes.names.length}</span>}
      </button>
      {/* pb : le survol ne se coupe pas en passant du cœur à la liste. */}
      <div className={`absolute bottom-full z-20 pb-1 ${mine ? "right-0" : "left-0"} ${open ? "block" : "hidden group-hover/likes:block"}`}>
        <div className="w-max min-w-[140px] max-w-[220px] rounded-btn border border-line bg-card p-2 text-xs shadow-modal">
          <div className="mb-1 font-bold text-ink-2">❤️ Aimé par</div>
          {likes.names.map((n, i) => (
            <div key={i} className="truncate text-ink-3">
              {n}
            </div>
          ))}
          <button type="button" onClick={onToggle} className="mt-1.5 w-full rounded-btn bg-subtle px-2 py-1 font-semibold text-ink-2 hover:bg-hover">
            {likes.mine ? "Je n'aime plus" : "J'aime aussi"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  m,
  mine,
  first,
  last,
  people,
  active,
  onActivate,
  onLike,
  onReply,
  onJump,
}: {
  m: ChatMessage;
  mine: boolean;
  first: boolean;
  last: boolean;
  people: ChatPerson[];
  active: boolean;
  onActivate: () => void;
  onLike: () => void;
  onReply: () => void;
  onJump: (id: string) => void;
}) {
  const showBody = !(m.attachments.length && isAttachmentFallback(m.body));
  const corners = mine
    ? `rounded-l-2xl ${first ? "rounded-tr-2xl" : "rounded-tr-md"} ${last ? "rounded-br-2xl" : "rounded-br-md"}`
    : `rounded-r-2xl ${first ? "rounded-tl-2xl" : "rounded-tl-md"} ${last ? "rounded-bl-2xl" : "rounded-bl-md"}`;

  return (
    <div id={`msg-${m.id}`} className={`group flex items-end gap-2 ${mine ? "flex-row-reverse" : ""} ${first ? "mt-3" : "mt-0.5"}`}>
      {!mine && <div className="w-7 shrink-0">{last && <Avatar person={asTeamPerson(m.author)} size={28} />}</div>}
      <div className={`flex min-w-0 max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {first && !mine && <span className="mb-0.5 ml-2 text-[11px] font-semibold text-ink-4">{m.author.name}</span>}
        {m.reply && (
          <button
            type="button"
            onClick={() => onJump(m.reply!.id)}
            className={`mb-[-10px] max-w-full truncate rounded-2xl bg-chip-bg px-3 pb-3.5 pt-1.5 text-left text-[11px] text-ink-3 ${mine ? "mr-1" : "ml-1"}`}
          >
            <CornerUpLeft size={10} className="mr-1 inline" />
            {m.reply.authorName} : {m.reply.body}
          </button>
        )}
        <div className={`flex max-w-full items-center gap-1 ${mine ? "flex-row-reverse" : ""}`}>
          <div onClick={onActivate} onDoubleClick={onLike} title={timeLabel(m.createdAt)} className="relative flex min-w-0 flex-col gap-1">
            {m.attachments.length > 0 && <Attachments items={m.attachments} mine={mine} />}
            {showBody && (
              <div className={`whitespace-pre-line break-words px-3 py-2 text-sm leading-snug ${corners} ${mine ? "bg-navy text-white" : "bg-subtle text-ink"}`}>
                <MessageBody body={m.body} people={people} />
              </div>
            )}
          </div>
          {/* Aimer / répondre : au survol (ordinateur) ou au toucher du message (mobile). */}
          <div className={`flex shrink-0 items-center transition-opacity ${active ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"} ${mine ? "flex-row-reverse" : ""}`}>
            <button
              type="button"
              onClick={onLike}
              title={m.likes.mine ? "Je n'aime plus" : "J'aime"}
              aria-label={m.likes.mine ? "Je n'aime plus" : "J'aime"}
              aria-pressed={m.likes.mine}
              className={`rounded-full p-1.5 hover:bg-hover ${m.likes.mine ? "text-red" : "text-ink-4 hover:text-red"}`}
            >
              <Heart size={16} fill={m.likes.mine ? "currentColor" : "none"} />
            </button>
            <button type="button" onClick={onReply} title="Répondre" aria-label="Répondre" className="rounded-full p-1.5 text-ink-4 hover:bg-hover hover:text-ink-2">
              <CornerUpLeft size={16} />
            </button>
          </div>
        </div>
        <Likes likes={m.likes} mine={mine} onToggle={onLike} />
      </div>
    </div>
  );
}

/* ---------- Conversation ---------- */

/**
 * Conversation façon Messenger — d'un événement ou directe entre utilisateurs : bulles, réponses,
 * ❤️ (double-clic, qui aime au survol), photos et fichiers joints, messages vocaux, mentions @
 * notifiées. Même composant dans l'onglet Discussion de la fiche et dans la bulle « Discussions »
 * (ordinateur, mobile, appli).
 */
export function EventChat({ source, autoFocus = false }: { source: ChatSource; autoFocus?: boolean }) {
  const [me, setMe] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  // Un chargement parti avant un ❤️ ne doit pas l'effacer : seuls les chargements récents comptent.
  const changeSeq = useRef(0);
  const { kind, id } = source;

  const load = useCallback(async () => {
    const seq = changeSeq.current;
    const res = await getChat({ kind, id });
    if (seq !== changeSeq.current) return;
    if (!res.ok) {
      setError(res.error);
      setMessages((prev) => prev ?? []);
      return;
    }
    setError(null);
    setMe(res.data.me);
    setMessages(res.data.messages);
  }, [kind, id]);

  // Ouverture, puis toutes les 15 s et à chaque notification reçue (nouveau message).
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(poll);
    };
  }, [load]);
  useLiveRefresh(["notifications"], () => void load(), 400);

  useEffect(() => {
    createClient()
      .from("profiles")
      .select("id, first_name, last_name, avatar_url")
      .order("first_name")
      .limit(1000)
      .then(({ data }) =>
        setPeople(
          (data ?? [])
            .map((p) => {
              const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
              return { id: p.id, name, initials: initialsOf(name), avatarUrl: p.avatar_url ?? null };
            })
            .filter((p) => p.name)
        )
      );
  }, []);

  // Discussion affichée : ses messages sont lus (la bulle se met à jour).
  const lastOther = messages?.filter((m) => m.author.id !== me).at(-1)?.id;
  useEffect(() => {
    if (!lastOther) return;
    void markChatRead({ kind, id }).then(() => window.dispatchEvent(new Event(DISCUSSIONS_CHANGED)));
  }, [kind, id, lastOther]);

  // Défilement : en bas à l'ouverture et à chaque nouveau message si on y était déjà.
  const count = messages?.length ?? 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  const like = async (messageId: string) => {
    changeSeq.current++;
    // Affichage immédiat ; en cas d'échec, message et retour à l'état enregistré.
    setMessages(
      (prev) =>
        prev?.map((m) =>
          m.id !== messageId ? m : { ...m, likes: m.likes.mine ? { mine: false, names: m.likes.names.filter((n) => n !== "Vous") } : { mine: true, names: ["Vous", ...m.likes.names] } }
        ) ?? null
    );
    const res = await toggleLike({ kind, id }, messageId);
    changeSeq.current++;
    if (!res.ok) setError(res.error);
    void load();
  };

  const jump = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("animate-pulse");
    window.setTimeout(() => el?.classList.remove("animate-pulse"), 1200);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
      >
        {messages === null ? (
          <p className="py-8 text-center text-sm text-ink-4">Chargement…</p>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-semibold text-ink-2">Aucun message pour l&apos;instant.</p>
            <p className="mt-1 text-xs text-ink-4">Écrivez le premier{kind === "event" ? " — tapez @ pour notifier quelqu'un" : ""}.</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const sameDay = (a: ChatMessage, b: ChatMessage) => new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString();
            const close = (a: ChatMessage, b: ChatMessage) => Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < 5 * 60_000;
            const newDay = !prev || !sameDay(prev, m);
            const sameAsPrev = !!prev && !newDay && prev.author.id === m.author.id && close(prev, m) && !m.reply;
            const sameAsNext = !!next && sameDay(m, next) && next.author.id === m.author.id && close(m, next) && !next.reply;
            return (
              <div key={m.id}>
                {newDay && <div className="mb-1 mt-4 text-center text-[11px] font-semibold text-ink-4">{`${dayLabel(m.createdAt)} · ${timeLabel(m.createdAt)}`}</div>}
                <MessageRow
                  m={m}
                  mine={m.author.id === me}
                  first={!sameAsPrev}
                  last={!sameAsNext}
                  people={people}
                  active={active === m.id}
                  onActivate={() => setActive((a) => (a === m.id ? null : m.id))}
                  onLike={() => void like(m.id)}
                  onReply={() => {
                    setReplyTo(m);
                    setActive(null);
                  }}
                  onJump={jump}
                />
              </div>
            );
          })
        )}
        {error && <p className="mt-3 text-center text-xs text-bad">{error}</p>}
      </div>
      <Composer
        source={source}
        me={me}
        people={people}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        autoFocus={autoFocus}
        onSent={() => {
          setReplyTo(null);
          atBottom.current = true;
          void load();
          window.dispatchEvent(new Event(DISCUSSIONS_CHANGED));
        }}
      />
    </div>
  );
}

/* ---------- Saisie ---------- */

type Pending = { key: string; file: File; preview: string | null };

function Composer({
  source,
  me,
  people,
  replyTo,
  onCancelReply,
  onSent,
  autoFocus,
}: {
  source: ChatSource;
  me: string | null;
  people: ChatPerson[];
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onSent: () => void;
  autoFocus: boolean;
}) {
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [files, setFiles] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Vocal
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const keepVoice = useRef(false);

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);
  useEffect(() => {
    if (recordingSince === null) return;
    const t = window.setInterval(() => {
      const ms = Date.now() - recordingSince;
      setElapsed(ms);
      if (ms >= MAX_VOICE_MS) {
        keepVoice.current = true;
        recorder.current?.stop();
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [recordingSince]);
  // Micro coupé si la conversation se ferme pendant un enregistrement.
  useEffect(
    () => () => {
      keepVoice.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
    },
    []
  );

  const suggestions = query === null ? [] : people.filter((p) => p.id !== me && fold(p.name).includes(fold(query))).slice(0, 6);

  const resize = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const onChange = (text: string, caret: number) => {
    setValue(text);
    const m = /(?:^|\s)@([^\s@]*(?: [^\s@]*)?)$/.exec(text.slice(0, caret));
    setQuery(m ? m[1] : null);
    setHighlight(0);
    resize();
  };

  const pick = (p: ChatPerson) => {
    const el = input.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([^\s@]*(?: [^\s@]*)?)$/, `@${p.name} `);
    setValue(before + value.slice(caret));
    setPicked((prev) => new Map(prev).set(p.name, p.id));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...list].slice(0, Math.max(0, 10 - files.length)).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setFiles((prev) => [...prev, ...next]);
    input.current?.focus();
  };
  const removeFile = (f: Pending) => {
    if (f.preview) URL.revokeObjectURL(f.preview);
    setFiles((prev) => prev.filter((x) => x.key !== f.key));
  };

  const send = async (override?: { text?: string; voice?: { blob: Blob; durationMs: number } }) => {
    const voice = override?.voice;
    const text = voice ? "" : (override?.text ?? value.trim());
    const toUpload = voice || override?.text ? [] : files;
    if (sending || (!text && !toUpload.length && !voice)) return;
    setSending(true);
    setError(null);
    try {
      const attachments: ChatAttachmentInput[] = [];
      if (voice) {
        const ext = voice.blob.type.includes("mp4") ? "m4a" : voice.blob.type.includes("ogg") ? "ogg" : "webm";
        attachments.push(await uploadAttachment(source, voice.blob, `message-vocal.${ext}`, voice.durationMs));
      }
      for (const f of toUpload) attachments.push(await uploadAttachment(source, f.file, f.file.name));
      const mentionIds = [...picked].filter(([name]) => text.includes(`@${name}`)).map(([, pid]) => pid);
      const res = await postChat(source, text, mentionIds, { parentId: replyTo?.id ?? null, attachments });
      if (!res.ok) throw new Error(res.error);
      if (!voice && !override?.text) {
        toUpload.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
        setFiles([]);
        setValue("");
        setPicked(new Map());
        requestAnimationFrame(resize);
      }
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setSending(false);
    }
  };

  const startVoice = async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? "L'enregistrement vocal n'est pas pris en charge par ce navigateur." : "Le micro n'est disponible qu'en https.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      keepVoice.current = false;
      const startedAt = Date.now();
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecordingSince(null);
        setElapsed(0);
        const durationMs = Date.now() - startedAt;
        if (keepVoice.current && durationMs > 700) void send({ voice: { blob: new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }), durationMs } });
      };
      recorder.current = rec;
      rec.start(250);
      setRecordingSince(startedAt);
    } catch (e) {
      setError(micError(e));
    }
  };
  const stopVoice = (keep: boolean) => {
    keepVoice.current = keep;
    recorder.current?.stop();
  };

  const mentionedCount = [...picked.keys()].filter((name) => value.includes(`@${name}`)).length;
  const empty = !value.trim() && files.length === 0;
  const iconBtn = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy hover:bg-hover disabled:opacity-50";

  return (
    <div className="relative shrink-0 border-t border-line bg-card px-2 pt-2" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
      {suggestions.length > 0 && (
        <div className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-btn border border-line bg-card shadow-modal">
          <div className="border-b border-line px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-4">Notifier</div>
          {suggestions.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === highlight ? "bg-sel-bg text-navy" : "text-ink-2 hover:bg-subtle"}`}
            >
              <Avatar person={asTeamPerson(p)} size={22} />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-btn bg-subtle px-3 py-1.5">
          <CornerUpLeft size={13} className="mt-0.5 shrink-0 text-ink-4" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-ink-2">Réponse à {replyTo.author.id === me ? "vous-même" : replyTo.author.name}</div>
            <div className="truncate text-xs text-ink-4">{replyTo.body}</div>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Annuler la réponse" className="rounded-full p-0.5 text-ink-4 hover:bg-hover">
            <X size={14} />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1 pt-1.5">
          {files.map((f) => (
            <div key={f.key} className="relative shrink-0">
              {f.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- aperçu local avant envoi
                <img src={f.preview} alt={f.file.name} className="h-16 w-16 rounded-xl object-cover" />
              ) : (
                <div className="flex h-16 w-28 flex-col justify-center rounded-xl bg-subtle px-2">
                  <FileText size={16} className="text-ink-3" />
                  <span className="truncate text-[10px] font-semibold text-ink-2">{f.file.name}</span>
                  <span className="text-[9px] text-ink-4">{sizeLabel(f.file.size)}</span>
                </div>
              )}
              {!sending && (
                <button type="button" onClick={() => removeFile(f)} aria-label="Retirer" className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white">
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {recordingSince !== null ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => stopVoice(false)} aria-label="Annuler le vocal" className="flex h-9 w-9 items-center justify-center rounded-full text-bad hover:bg-hover">
            <Trash2 size={18} />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-full bg-navy px-4 py-2 text-white">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red" />
            <span className="flex-1 text-sm font-semibold">Enregistrement…</span>
            <span className="font-mono text-sm">{duration(elapsed)}</span>
          </div>
          <button type="button" onClick={() => stopVoice(true)} aria-label="Envoyer le vocal" className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-white">
            <Send size={16} />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-0.5">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={sending} title="Joindre une photo ou un fichier" aria-label="Joindre" className={iconBtn}>
            <Paperclip size={19} />
          </button>
          <button type="button" onClick={() => void startVoice()} disabled={sending} title="Message vocal" aria-label="Message vocal" className={iconBtn}>
            <Mic size={19} />
          </button>
          <textarea
            ref={input}
            rows={1}
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onBlur={() => setQuery(null)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if (suggestions.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => (h + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pick(suggestions[Math.min(highlight, suggestions.length - 1)]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setQuery(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Aa"
            className="mx-1 max-h-32 min-h-9 flex-1 resize-none rounded-[18px] bg-subtle px-3.5 py-2 text-sm text-ink outline-none placeholder:text-ink-4"
          />
          {sending ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center text-navy">
              <Loader2 size={18} className="animate-spin" />
            </span>
          ) : empty ? (
            <button type="button" onClick={() => void send({ text: "👍" })} title="Envoyer 👍" aria-label="Envoyer un pouce" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl hover:bg-hover">
              👍
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              title={mentionedCount ? `Envoyer et notifier ${mentionedCount} personne${mentionedCount > 1 ? "s" : ""}` : "Envoyer"}
              aria-label="Envoyer"
              className={iconBtn}
            >
              <Send size={19} />
            </button>
          )}
        </div>
      )}
      {(error || mentionedCount > 0) && (
        <p className={`mt-1 px-2 text-[11px] ${error ? "text-bad" : "text-ink-4"}`}>
          {error ?? `${mentionedCount} personne${mentionedCount > 1 ? "s" : ""} ${mentionedCount > 1 ? "seront notifiées" : "sera notifiée"}.`}
        </p>
      )}
    </div>
  );
}
