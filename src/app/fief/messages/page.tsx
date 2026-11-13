"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Flag, Loader2, MessageCircle, PenSquare, Search, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ComingSoon, useFiefHref, type FiefMe } from "@/components/fief/ui";
import { MemberGate } from "@/components/fief/shell";
import { Avatar, ago, type FeedAuthor } from "@/components/fief/feed";

// Messagerie privée FIEF (conversations à deux, sql/2026-11-13_fief_social.sql) : liste, nouvelle
// conversation (annuaire des membres), fil de messages en direct (Realtime, filtré par la RLS).
// ?c=<conversation> ouvre une conversation ; ?to=<membre> ouvre (ou prépare) celle avec cette membre.

interface Conversation {
  id: string;
  other: FeedAuthor;
  last_body: string | null;
  last_at: string;
  last_mine: boolean;
  unread: number;
}

interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  mine: boolean;
}

interface DirectoryEntry {
  user_id: string;
  first_name: string;
  last_name: string;
  club_name: string | null;
}

async function post(body: unknown) {
  const res = await fetch("/api/fief/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: "Réponse illisible." }));
  if (!res.ok || !json.ok) throw new Error(json.error ?? "Action impossible.");
  return json as { conversationId?: string; id?: string; createdAt?: string };
}

function Messages({ me }: { me: FiefMe }) {
  const href = useFiefHref();
  const router = useRouter();
  const params = useSearchParams();
  const convParam = params.get("c");
  const toParam = params.get("to");
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [draftTo, setDraftTo] = useState<FeedAuthor | null>(null);

  const loadConvs = useCallback(async () => {
    const { data } = await createClient().rpc("fief_my_conversations");
    const list = (data ?? []) as Conversation[];
    setConvs(list);
    return list;
  }, []);

  useEffect(() => {
    let alive = true;
    void createClient()
      .rpc("fief_my_conversations")
      .then(async ({ data }) => {
        const list = (data ?? []) as Conversation[];
        if (!alive) return;
        setConvs(list);
        if (!toParam) return;
        const existing = list.find((c) => c.other.id === toParam);
        if (existing) return router.replace(href(`/messages?c=${existing.id}`));
        const { data: dir } = await createClient().rpc("fief_directory");
        const person = ((dir ?? []) as DirectoryEntry[]).find((d) => d.user_id === toParam);
        if (alive && person)
          setDraftTo({
            id: person.user_id,
            name: `${person.first_name} ${person.last_name}`,
            club: person.club_name,
            team: false,
          });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- href change d'identité à chaque rendu ; seul ?to= compte
  }, [toParam, router]);

  const open = convs?.find((c) => c.id === convParam) ?? null;
  const showThread = !!open || !!draftTo;
  const startWith = (person: FeedAuthor) => {
    setPicking(false);
    const existing = convs?.find((c) => c.other.id === person.id);
    if (existing) {
      setDraftTo(null);
      router.push(href(`/messages?c=${existing.id}`));
    } else {
      setDraftTo(person);
      router.push(href(`/messages?to=${person.id}`));
    }
  };

  return (
    <div className="space-y-4">
      <div className={`flex items-center justify-between ${showThread ? "hidden md:flex" : ""}`}>
        <h1 className="text-2xl font-extrabold">Messages</h1>
        <button onClick={() => setPicking(true)} className="flex items-center gap-2 rounded-xl bg-f-accent px-3.5 py-2 text-sm font-bold text-white">
          <PenSquare size={16} /> Nouveau message
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <div className={`space-y-2 ${showThread ? "hidden md:block" : ""}`}>
          {convs === null && <p className="text-sm text-f-muted">Chargement…</p>}
          {convs?.length === 0 && (
            <ComingSoon
              icon={MessageCircle}
              title="Aucune conversation"
              text="Écrivez à une autre membre depuis « Nouveau message », ou en touchant son nom dans le fil d'actu."
            />
          )}
          {convs?.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setDraftTo(null);
                router.push(href(`/messages?c=${c.id}`));
              }}
              className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left border border-f-border ${
                c.id === convParam ? "bg-f-accent text-white" : "bg-f-surface hover:ring-2 hover:ring-f-accent/15"
              }`}
            >
              <Avatar author={c.other} size={44} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-bold">{c.other.name}</span>
                  <span className={`shrink-0 text-[11px] ${c.id === convParam ? "text-white/70" : "text-f-faint"}`}>{ago(c.last_at)}</span>
                </span>
                <span
                  className={`block truncate text-sm ${c.id === convParam ? "text-white/80" : c.unread ? "font-semibold text-f-text" : "text-f-muted"}`}
                >
                  {c.last_mine ? "Vous : " : ""}
                  {c.last_body ?? "Nouvelle conversation"}
                </span>
              </span>
              {c.unread > 0 && c.id !== convParam && <span className="rounded-full bg-[#D7262E] px-2 text-xs font-bold leading-5 text-white">{c.unread}</span>}
            </button>
          ))}
        </div>

        {showThread ? (
          <Thread
            key={open?.id ?? `to-${draftTo?.id}`}
            meId={me.userId}
            conversation={open}
            draftTo={open ? null : draftTo}
            onBack={() => {
              setDraftTo(null);
              router.push(href("/messages"));
            }}
            onSent={(conversationId) => {
              void loadConvs();
              if (!open) {
                setDraftTo(null);
                router.replace(href(`/messages?c=${conversationId}`));
              }
            }}
            onRead={() => setConvs((prev) => (prev ?? []).map((c) => (c.id === open?.id ? { ...c, unread: 0 } : c)))}
          />
        ) : (
          <div className="hidden items-center justify-center rounded-3xl bg-f-surface p-10 text-center text-f-muted border border-f-border md:flex">
            Choisissez une conversation.
          </div>
        )}
      </div>

      {picking && <PeoplePicker meId={me.userId} onPick={startWith} onClose={() => setPicking(false)} />}
    </div>
  );
}

function Thread({
  meId,
  conversation,
  draftTo,
  onBack,
  onSent,
  onRead,
}: {
  meId: string;
  conversation: Conversation | null;
  draftTo: FeedAuthor | null;
  onBack: () => void;
  onSent: (conversationId: string) => void;
  onRead: () => void;
}) {
  const other = conversation?.other ?? draftTo!;
  const [messages, setMessages] = useState<Message[] | null>(conversation ? null : []);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const convId = conversation?.id ?? null;
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });

  useEffect(() => {
    if (!convId) return;
    let alive = true;
    const supabase = createClient();
    supabase.rpc("fief_conversation_messages", { p_conversation: convId }).then(({ data }) => {
      if (alive) setMessages(((data ?? []) as Message[]).slice().reverse());
    });
    void post({ action: "read", conversationId: convId })
      .then(() => onReadRef.current())
      .catch(() => {});
    // Nouveaux messages en direct (la RLS ne laisse passer que ceux de cette conversation).
    const channel = supabase
      .channel(`fief-conv-${convId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "fief_messages",
          filter: `conversation_id=eq.${convId}`,
        },
        (payload) => {
          const m = payload.new as {
            id: string;
            sender_id: string;
            body: string;
            created_at: string;
          };
          setMessages((prev) => (prev?.some((x) => x.id === m.id) ? prev : [...(prev ?? []), { ...m, mine: m.sender_id === meId }]));
          if (m.sender_id !== meId) void post({ action: "read", conversationId: convId }).catch(() => {});
        }
      )
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [convId, meId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post(convId ? { action: "send", conversationId: convId, body: text } : { action: "send", to: other.id, body: text });
      setBody("");
      if (r.id && r.createdAt) {
        const sent = {
          id: r.id,
          sender_id: meId,
          body: text,
          created_at: r.createdAt,
          mine: true,
        };
        setMessages((prev) => (prev?.some((x) => x.id === sent.id) ? prev : [...(prev ?? []), sent]));
      }
      onSent(r.conversationId!);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message non envoyé.");
    }
    setBusy(false);
  };
  const report = async (m: Message) => {
    const reason = window.prompt("Pourquoi signalez-vous ce message à l'équipe FIEF ? (facultatif)");
    if (reason === null) return;
    const res = await fetch("/api/fief/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "report", messageId: m.id, reason }),
    });
    window.alert(res.ok ? "Merci : l'équipe FIEF va regarder." : "Signalement impossible.");
  };

  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col overflow-hidden rounded-3xl bg-f-surface border border-f-border md:h-[calc(100dvh-9rem)]">
      <div className="flex items-center gap-3 border-b border-f-subtle px-4 py-3">
        <button onClick={onBack} aria-label="Retour" className="rounded-full p-1.5 hover:bg-f-subtle md:hidden">
          <ArrowLeft size={20} />
        </button>
        <Avatar author={other} size={38} />
        <div className="min-w-0">
          <p className="truncate font-bold">{other.name}</p>
          {other.club && <p className="truncate text-xs text-f-muted">{other.club}</p>}
        </div>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto bg-f-bg px-4 py-4">
        {messages === null && (
          <div className="flex justify-center py-8 text-f-muted">
            <Loader2 className="animate-spin" />
          </div>
        )}
        {messages?.length === 0 && <p className="py-8 text-center text-sm text-f-muted">Écrivez votre premier message à {other.name.split(" ")[0]}.</p>}
        {messages?.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          return (
            <div key={m.id}>
              {newDay && (
                <p className="py-2 text-center text-[11px] font-semibold uppercase text-f-faint">
                  {new Date(m.created_at).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </p>
              )}
              <div className={`group flex items-end gap-1.5 ${m.mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[15px] ${
                    m.mine ? "rounded-br-md bg-f-accent text-white" : "rounded-bl-md bg-f-surface text-f-text border border-f-border"
                  }`}
                >
                  <p className="whitespace-pre-line break-words">{m.body}</p>
                  <p className={`mt-0.5 text-right text-[10px] ${m.mine ? "text-white/60" : "text-f-faint"}`}>
                    {new Date(m.created_at).toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {!m.mine && (
                  <button onClick={() => void report(m)} aria-label="Signaler ce message" className="rounded-full p-1 text-f-border-strong hover:text-f-danger">
                    <Flag size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {error && <p className="px-4 pt-2 text-sm text-f-danger">{error}</p>}
      <div className="flex items-end gap-2 border-t border-f-subtle p-3">
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
          maxLength={4000}
          placeholder="Votre message…"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-f-border px-3.5 py-2.5 text-[15px] outline-none focus:border-f-accent"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !body.trim()}
          aria-label="Envoyer"
          className="rounded-full bg-f-accent p-3 text-white disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

function PeoplePicker({ meId, onPick, onClose }: { meId: string; onPick: (p: FeedAuthor) => void; onClose: () => void }) {
  const [people, setPeople] = useState<DirectoryEntry[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    createClient()
      .rpc("fief_directory")
      .then(({ data }) => setPeople(((data ?? []) as DirectoryEntry[]).filter((p) => p.user_id !== meId)));
  }, [meId]);
  const shown = useMemo(() => {
    const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return (people ?? []).filter((p) => !q.trim() || fold(`${p.first_name} ${p.last_name} ${p.club_name ?? ""}`).includes(fold(q.trim())));
  }, [people, q]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-f-surface sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h2 className="text-lg font-extrabold">Nouveau message</h2>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-f-subtle">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom ou club"
              className="w-full rounded-xl border border-f-border py-2.5 pl-10 pr-3 text-[15px] outline-none focus:border-f-accent"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {people === null && <p className="px-3 py-4 text-sm text-f-muted">Chargement…</p>}
          {people && shown.length === 0 && <p className="px-3 py-4 text-sm text-f-muted">Aucune membre trouvée.</p>}
          {shown.map((p) => {
            const author = {
              id: p.user_id,
              name: `${p.first_name} ${p.last_name}`,
              club: p.club_name,
              team: false,
            };
            return (
              <button
                key={p.user_id}
                onClick={() => onPick(author)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-f-bg"
              >
                <Avatar author={author} size={38} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{author.name}</span>
                  {p.club_name && <span className="block truncate text-xs text-f-muted">{p.club_name}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function FiefMessagesPage() {
  return (
    <MemberGate>
      {(me) => (
        <Suspense fallback={null}>
          <Messages me={me} />
        </Suspense>
      )}
    </MemberGate>
  );
}
