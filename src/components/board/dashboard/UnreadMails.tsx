"use client";

import { useEffect, useState } from "react";
import { Archive, ChevronRight, Forward, Mail, Paperclip, Reply, Send, Trash2, X } from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { archiveMyMessage, forwardMyMessage, modifyMyMessageLabels, replyToMyMessage, trashMyMessage } from "@/app/actions/gmail";
import { loadMail, loadMailList, forgetMail, type MailDetail, type MailList } from "@/lib/board/mailClient";
import { readCache, writeCache } from "@/lib/board/localCache";
import { EmailBody } from "@/components/board/mail/EmailBody";
import { SenderAvatar, parseSenderName } from "@/components/board/mail/SenderAvatar";
import { useLive } from "@/components/board/live/LiveProvider";

// Accueil — « Mes mails non lus » : les derniers mails non lus de la boîte de réception (comptes
// Google connectés), lus et répondus dans une popup sans quitter le tableau de bord.

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
type Item = MailList["messages"][number] & { accountId: string };

const MAX = 6;
/** Comme le compteur du rail : onglet Principal de Gmail seulement (voir getInboxUnreadCount). */
const PRIMARY_QUERY = "is:unread category:primary";

type Mode = "read" | "reply" | "forward";

function shortDate(raw: string) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function IconAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-8 w-8 items-center justify-center rounded-btn text-ink-3 hover:bg-hover ${danger ? "hover:text-bad" : "hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/** Lecture d'un mail, réponse, transfert, archivage ou suppression. Le mail est marqué comme lu à l'ouverture. */
function MailPopup({
  item,
  initialMode,
  onClose,
  onRemove,
  onOpenMails,
}: {
  item: Item;
  initialMode: Mode;
  onClose: () => void;
  /** Archiver ou supprimer depuis la popup. */
  onRemove: (kind: "archive" | "trash") => Promise<void>;
  onOpenMails?: () => void;
}) {
  const [mail, setMail] = useState<MailDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMail(item.accountId, item.id)
      .then((m) => !cancelled && setMail(m))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Impossible d'ouvrir le mail."));
    return () => {
      cancelled = true;
    };
  }, [item.accountId, item.id]);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      if (mode === "forward") await forwardMyMessage(item.accountId, item.id, { to: to.trim(), body });
      else await replyToMyMessage(item.accountId, item.id, { body });
      setSent(mode === "forward" ? `✓ Transféré à ${to.trim()}` : "✓ Réponse envoyée");
      setMode("read");
      setBody("");
      setTo("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[22px] bg-card shadow-modal sm:rounded-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
          <SenderAvatar name={item.from} size={38} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-extrabold text-ink">{item.subject}</div>
            <div className="truncate text-xs text-ink-3">
              <b className="text-ink-2">{parseSenderName(item.from)}</b> · {shortDate(item.date)}
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-ink-4 hover:bg-hover" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="mb-3 rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
          {!mail && !error && <p className="py-10 text-center text-sm text-ink-4">Chargement du mail…</p>}
          {mail && (
            <>
              <EmailBody bodyText={mail.bodyText} bodyHtml={mail.bodyHtml} />
              {mail.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {mail.attachments.map((a) => (
                    <span key={a.attachmentId} className="flex items-center gap-1 rounded-full bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-2">
                      <Paperclip size={11} /> {a.filename}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-5 py-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          {mode !== "read" ? (
            <div className="space-y-2">
              {mode === "forward" && (
                <input
                  autoFocus
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="Transférer à (adresse e-mail)"
                  className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-navy"
                />
              )}
              <textarea
                autoFocus={mode === "reply"}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={mode === "forward" ? 3 : 5}
                placeholder={mode === "forward" ? "Message (facultatif)…" : `Répondre à ${parseSenderName(item.from)}…`}
                className="w-full resize-y rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none focus:border-navy"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setMode("read")} className="rounded-btn px-3 py-2 text-sm font-semibold text-ink-3 hover:bg-hover">
                  Annuler
                </button>
                <button
                  onClick={() => void send()}
                  disabled={sending || (mode === "reply" ? !body.trim() : !/^\S+@\S+\.\S+$/.test(to.trim()))}
                  className="flex items-center gap-1.5 rounded-btn bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-600 disabled:opacity-50"
                >
                  <Send size={14} /> {sending ? "Envoi…" : mode === "forward" ? "Transférer" : "Envoyer"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <IconAction label="Archiver" onClick={() => void onRemove("archive")}>
                  <Archive size={15} />
                </IconAction>
                <IconAction label="Supprimer" danger onClick={() => void onRemove("trash")}>
                  <Trash2 size={15} />
                </IconAction>
                {sent && <span className="ml-2 text-sm font-semibold text-good">{sent}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {onOpenMails && (
                  <button onClick={onOpenMails} className="hidden rounded-btn border border-line px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover sm:block">
                    Ouvrir dans Mails
                  </button>
                )}
                <button
                  onClick={() => setMode("forward")}
                  disabled={!mail}
                  className="flex items-center gap-1.5 rounded-btn border border-line px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-hover disabled:opacity-50"
                >
                  <Forward size={14} /> Transférer
                </button>
                <button
                  onClick={() => setMode("reply")}
                  disabled={!mail}
                  className="flex items-center gap-1.5 rounded-btn bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-600 disabled:opacity-50"
                >
                  <Reply size={14} /> Répondre
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Colonne « Mes mails non lus » du tableau de bord. */
export function UnreadMails({ onOpenMails }: { onOpenMails?: () => void }) {
  const [items, setItems] = useState<Item[] | null>(() => readCache<Item[]>("dashboard:unread") ?? null);
  const [noAccount, setNoAccount] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<{ item: Item; mode: Mode } | null>(null);
  // Total exact (onglet Principal), le même que le rail / dock ; la liste n'en charge que 15.
  const total = useLive().badges?.mails;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const accounts = (readCache<Account[]>("mail:accounts") ?? (await getMyConnectedAccounts())).filter((a) => a.provider === "google");
        if (cancelled) return;
        if (!accounts.length) {
          setNoAccount(true);
          setItems([]);
          return;
        }
        const lists = await Promise.all(
          accounts.map((a) =>
            loadMailList(a.id, { labelIds: ["INBOX"], query: PRIMARY_QUERY })
              .then((l) => l.messages.map((m) => ({ ...m, accountId: a.id })))
              .catch(() => [] as Item[])
          )
        );
        if (cancelled) return;
        const merged = lists.flat().sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
        setItems(merged);
        writeCache("dashboard:unread", merged);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const dropFromList = (item: Item) =>
    setItems((prev) => {
      const next = (prev ?? []).filter((m) => m.id !== item.id);
      writeCache("dashboard:unread", next);
      return next;
    });

  const openMail = (item: Item, mode: Mode = "read") => {
    setOpen({ item, mode });
    // Lu dès l'ouverture : retiré de la liste, et le cache du contenu est relu dans Mails.
    dropFromList(item);
    void modifyMyMessageLabels(item.accountId, item.id, { removeLabelIds: ["UNREAD"] })
      .then(() => forgetMail(item.accountId, item.id))
      .catch(() => undefined);
  };

  const remove = async (item: Item, kind: "archive" | "trash") => {
    dropFromList(item);
    try {
      await (kind === "archive" ? archiveMyMessage(item.accountId, item.id) : trashMyMessage(item.accountId, item.id));
      forgetMail(item.accountId, item.id);
    } catch {
      setItems((prev) => [item, ...(prev ?? [])]);
    }
  };

  const shown = (items ?? []).slice(0, MAX);
  const more = Math.max((total ?? items?.length ?? 0) - shown.length, 0);

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-ink md:text-base">
          Mes mails non lus
          {(total ?? items?.length ?? 0) > 0 && (
            <span className="rounded-full bg-red px-1.5 text-[10px] font-bold text-white">{(total ?? items!.length) > 99 ? "99+" : (total ?? items!.length)}</span>
          )}
        </h2>
        {onOpenMails && (
          <button onClick={onOpenMails} className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-link hover:underline md:text-xs">
            Mails <ChevronRight size={12} />
          </button>
        )}
      </div>

      {items === null ? (
        <div className="rounded-panel border border-line bg-card p-6 text-sm text-ink-4">Chargement…</div>
      ) : noAccount ? (
        <a href="/api/oauth/google/start" className="flex items-center gap-3 rounded-panel border border-line bg-card p-4 text-sm text-ink-2 hover:bg-hover">
          <Mail size={18} className="shrink-0 text-ink-4" /> Connectez votre compte Google pour voir vos mails ici.
        </a>
      ) : error ? (
        <div className="rounded-panel border border-line bg-card p-4 text-sm text-ink-4">Mails indisponibles pour le moment.</div>
      ) : shown.length === 0 ? (
        <div className="flex items-center gap-3 rounded-panel border border-line bg-card p-4 text-sm text-ink-3">
          <Mail size={18} className="shrink-0 text-good" /> Aucun mail non lu.
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
          {shown.map((m) => (
            <div
              key={`${m.accountId}:${m.id}`}
              role="button"
              tabIndex={0}
              onClick={() => openMail(m)}
              onKeyDown={(e) => e.key === "Enter" && openMail(m)}
              className="group relative flex w-full cursor-pointer items-start gap-2.5 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-hover"
            >
              <SenderAvatar name={m.from} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-bold text-ink">{parseSenderName(m.from)}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-4 md:group-hover:invisible">{shortDate(m.date)}</span>
                </span>
                <span className="block truncate text-[12px] font-semibold text-ink-2">{m.subject}</span>
                <span className="block truncate text-[11px] text-ink-4">{m.snippet}</span>
              </span>
              {/* Survol (ordinateur) : comme dans Mails — archiver, supprimer, transférer. */}
              <span className="absolute right-2 top-1.5 hidden items-center rounded-btn border border-line bg-card shadow-card md:group-hover:flex">
                <IconAction label="Archiver" onClick={() => void remove(m, "archive")}>
                  <Archive size={14} />
                </IconAction>
                <IconAction label="Supprimer" danger onClick={() => void remove(m, "trash")}>
                  <Trash2 size={14} />
                </IconAction>
                <IconAction label="Transférer" onClick={() => openMail(m, "forward")}>
                  <Forward size={14} />
                </IconAction>
              </span>
            </div>
          ))}
          {more > 0 && onOpenMails && (
            <button onClick={onOpenMails} className="block w-full px-3 py-2 text-center text-xs font-semibold text-link hover:bg-hover">
              + {more} autre{more > 1 ? "s" : ""} dans Mails
            </button>
          )}
        </div>
      )}

      {open && (
        <MailPopup
          item={open.item}
          initialMode={open.mode}
          onClose={() => setOpen(null)}
          onRemove={async (kind) => {
            const item = open.item;
            setOpen(null);
            await remove(item, kind);
          }}
          onOpenMails={
            onOpenMails
              ? () => {
                  setOpen(null);
                  onOpenMails();
                }
              : undefined
          }
        />
      )}
    </>
  );
}
