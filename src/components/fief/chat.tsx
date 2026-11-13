"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Flag, Loader2, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, type FeedAuthor } from "@/components/fief/feed";

// Conversation privée FIEF (sql/2026-11-13_fief_social.sql) : messages en direct (Realtime, filtrés par la
// RLS), envoi par /api/fief/messages, signalement. Utilisée par la page Messages et par la fenêtre de chat
// en bas à droite (`compact`).

export interface Conversation {
  id: string;
  other: FeedAuthor;
  last_body: string | null;
  last_at: string;
  last_mine: boolean;
  unread: number;
}

export interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  mine: boolean;
}

export async function postMessage(body: unknown) {
  const res = await fetch("/api/fief/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ ok: false, error: "Réponse illisible." }));
  if (!res.ok || !json.ok) throw new Error(json.error ?? "Action impossible.");
  return json as { conversationId?: string; id?: string; createdAt?: string };
}

export function ChatThread({
  meId,
  conversation,
  draftTo,
  onBack,
  onSent,
  onRead,
  compact = false,
  header,
}: {
  meId: string;
  conversation: Pick<Conversation, "id" | "other"> | null;
  draftTo: FeedAuthor | null;
  onBack?: () => void;
  onSent: (conversationId: string) => void;
  onRead?: () => void;
  /** Fenêtre de chat (bulle en bas à droite) : remplit son conteneur. */
  compact?: boolean;
  /** En-tête remplacé (fenêtre de chat : boutons agrandir / fermer). */
  header?: ReactNode;
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
    void postMessage({ action: "read", conversationId: convId })
      .then(() => onReadRef.current?.())
      .catch(() => {});
    // Nouveaux messages en direct (la RLS ne laisse passer que ceux de cette conversation).
    const channel = supabase
      .channel(`fief-conv-${convId}-${compact ? "bulle" : "page"}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "fief_messages", filter: `conversation_id=eq.${convId}` }, (payload) => {
        const m = payload.new as { id: string; sender_id: string; body: string; created_at: string };
        setMessages((prev) => (prev?.some((x) => x.id === m.id) ? prev : [...(prev ?? []), { ...m, mine: m.sender_id === meId }]));
        if (m.sender_id !== meId) void postMessage({ action: "read", conversationId: convId }).catch(() => {});
      })
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [convId, meId, compact]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postMessage(convId ? { action: "send", conversationId: convId, body: text } : { action: "send", to: other.id, body: text });
      setBody("");
      if (r.id && r.createdAt) {
        const sent = { id: r.id, sender_id: meId, body: text, created_at: r.createdAt, mine: true };
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
    const res = await fetch("/api/fief/feed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "report", messageId: m.id, reason }) });
    window.alert(res.ok ? "Merci : l'équipe FIEF va regarder." : "Signalement impossible.");
  };

  return (
    <div
      className={
        compact
          ? "flex h-full flex-col overflow-hidden bg-f-surface"
          : "flex h-[calc(100dvh-11rem)] flex-col overflow-hidden rounded-3xl border border-f-border bg-f-surface md:h-[calc(100dvh-9rem)]"
      }
    >
      {header ?? (
        <div className="flex items-center gap-3 border-b border-f-subtle px-4 py-3">
          {onBack && (
            <button onClick={onBack} aria-label="Retour" className="rounded-full p-1.5 hover:bg-f-subtle md:hidden">
              <ArrowLeft size={20} />
            </button>
          )}
          <Avatar author={other} size={38} />
          <div className="min-w-0">
            <p className="truncate font-bold">{other.name}</p>
            {other.club && <p className="truncate text-xs text-f-muted">{other.club}</p>}
          </div>
        </div>
      )}
      <div className={`flex-1 space-y-1.5 overflow-y-auto bg-f-bg ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
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
                  {new Date(m.created_at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                </p>
              )}
              <div className={`group flex items-end gap-1.5 ${m.mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${compact ? "text-sm" : "text-[15px]"} ${m.mine ? "rounded-br-md bg-f-accent text-white" : "rounded-bl-md border border-f-border bg-f-surface text-f-text"}`}
                >
                  <p className="whitespace-pre-line break-words">{m.body}</p>
                  <p className={`mt-0.5 text-right text-[10px] ${m.mine ? "text-white/60" : "text-f-faint"}`}>
                    {new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
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
      <div className="flex items-end gap-2 border-t border-f-subtle p-2.5">
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
          placeholder="Aa"
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-full bg-f-subtle px-4 py-2.5 text-[15px] text-f-text outline-none"
        />
        <button onClick={() => void send()} disabled={busy || !body.trim()} aria-label="Envoyer" className="rounded-full p-2.5 text-f-accent hover:bg-f-subtle disabled:opacity-40">
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
