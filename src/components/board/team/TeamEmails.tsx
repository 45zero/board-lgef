"use client";

import { useCallback, useEffect, useState } from "react";
import { Kanban, Loader2, Mail, Paperclip, Search, X } from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { listMyMessages } from "@/app/actions/gmail";
import {
  getTeamCardEmail,
  linkEmailToTeamCard,
  listTeamCardEmails,
  searchLinkableTeamCards,
  unlinkTeamCardEmail,
  type TeamCardEmail,
  type TeamCardEmailSummary,
} from "@/app/actions/team-emails";
import { unwrap } from "@/lib/board/actionResult";
import type { TeamPerson } from "@/lib/board/team";
import { EmailBody } from "@/components/board/mail/EmailBody";
import { SenderAvatar, parseSenderName } from "@/components/board/mail/SenderAvatar";
import { Popover } from "./TeamUi";

// E-mails liés à une carte (voir team-emails.ts) : copie du message lisible par tous ceux qui voient
// la carte. On lie depuis la fiche (recherche dans sa boîte Gmail) ou depuis l'écran Mails
// (LinkEmailToCardPopover).

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
type MailHit = Awaited<ReturnType<typeof listMyMessages>>["messages"][number];

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Message de fin de liaison (déjà liée, pièces jointes non copiées), ou null si tout s'est bien passé. */
const linkNotice = (r: { alreadyLinked: boolean; failedAttachments: string[] }) =>
  r.alreadyLinked
    ? "Cet e-mail est déjà lié à cette carte."
    : r.failedAttachments.length
      ? `E-mail lié, mais pièces jointes non copiées : ${r.failedAttachments.join(", ")}.`
      : null;

export function TeamEmails({
  cardId,
  canEdit,
  me,
  people,
  onAttachmentsAdded,
  onError,
}: {
  cardId: string;
  canEdit: boolean;
  me: string;
  people: TeamPerson[];
  /** Des pièces jointes de l'e-mail ont été copiées dans la carte. */
  onAttachmentsAdded: () => void;
  onError: (m: string) => void;
}) {
  const [emails, setEmails] = useState<TeamCardEmailSummary[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const closeViewer = useCallback(() => setOpen(null), []);

  const load = useCallback(async () => {
    try {
      setEmails(unwrap(await listTeamCardEmails(cardId)));
    } catch (e) {
      setEmails([]);
      onError(e instanceof Error ? e.message : "E-mails indisponibles.");
    }
  }, [cardId, onError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load();
  }, [load]);

  const unlink = async (e: TeamCardEmailSummary) => {
    if (!window.confirm(`Délier « ${e.subject} » de la carte ? (les pièces jointes copiées restent)`)) return;
    setEmails((list) => list?.filter((x) => x.id !== e.id) ?? null);
    try {
      unwrap(await unlinkTeamCardEmail(e.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Impossible de délier.");
    }
    await load();
  };

  if (!canEdit && emails?.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Mail size={16} className="text-ink-3" />
        <h3 className="flex-1 text-sm font-extrabold text-ink">E-mails</h3>
        {(emails === null || busy) && <Loader2 size={13} className="animate-spin text-ink-4" />}
      </div>
      <ul className="space-y-2">
        {emails?.map((e) => (
          <li key={e.id} className="group flex items-center gap-3 rounded-btn border border-line bg-card px-3 py-2.5">
            <button onClick={() => setOpen(e.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <SenderAvatar name={e.from} size={30} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-ink">{e.subject}</p>
                <p className="truncate text-[11px] text-ink-4">
                  {[parseSenderName(e.from), shortDate(e.sentAt), `lié par ${people.find((p) => p.id === e.linkedBy)?.name ?? "—"}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              {e.attachmentNames.length > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-ink-4" title={e.attachmentNames.join("\n")}>
                  <Paperclip size={11} /> {e.attachmentNames.length}
                </span>
              )}
            </button>
            {(canEdit || e.linkedBy === me) && (
              <button onClick={() => void unlink(e)} aria-label={`Délier ${e.subject}`} className="hidden text-ink-4 hover:text-bad group-hover:block">
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="relative mt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setPicking(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-btn border border-dashed border-line-strong px-3 py-2.5 text-[13px] font-semibold text-ink-3 hover:text-ink disabled:opacity-50"
          >
            <Mail size={14} /> Lier un e-mail
          </button>
          <div className="absolute left-1/2 top-full -translate-x-1/2">
            <MailPicker
              open={picking}
              onClose={() => setPicking(false)}
              onPick={async (accountId, hit, copyAttachments) => {
                setPicking(false);
                setBusy(true);
                try {
                  const r = unwrap(await linkEmailToTeamCard(cardId, accountId, hit.id, { copyAttachments }));
                  const notice = linkNotice(r);
                  if (notice) onError(notice);
                  if (copyAttachments && hit.hasAttachments && !r.alreadyLinked) onAttachmentsAdded();
                } catch (err) {
                  onError(err instanceof Error ? err.message : "Liaison impossible.");
                }
                setBusy(false);
                await load();
              }}
            />
          </div>
        </div>
      )}
      {open && <EmailViewer id={open} onClose={closeViewer} onError={onError} />}
    </section>
  );
}

/** Recherche dans une de mes boîtes Gmail connectées (mêmes opérateurs que Gmail : from:, has:attachment…). */
function MailPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (accountId: string, hit: MailHit, copyAttachments: boolean) => Promise<void> }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MailHit[] | null>(null);
  const [copyAttachments, setCopyAttachments] = useState(true);

  useEffect(() => {
    if (!open || accounts) return;
    void getMyConnectedAccounts().then((list) => {
      const google = list.filter((a) => a.provider === "google");
      setAccounts(google);
      if (google[0]) setAccountId(google[0].id);
    });
  }, [open, accounts]);

  useEffect(() => {
    if (!open || !accountId) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        const res = await listMyMessages(accountId, q.trim() ? { query: q.trim() } : { labelIds: ["INBOX"] });
        if (alive) setHits(res.messages.slice(0, 20));
      } catch {
        if (alive) setHits([]);
      }
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, accountId, q]);

  return (
    <Popover open={open} onClose={onClose} width={380}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Lier un e-mail</p>
      {accounts?.length === 0 ? (
        <p className="text-xs text-ink-4">Aucune boîte Gmail connectée — connectez un compte Google depuis l&rsquo;écran Mails.</p>
      ) : (
        <>
          {accounts && accounts.length > 1 && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mb-2 w-full rounded-btn border border-line bg-card px-2 py-1.5 text-[13px] outline-none">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label ? `${a.label} — ` : ""}
                  {a.email}
                </option>
              ))}
            </select>
          )}
          <div className="mb-2 flex items-center gap-1.5 rounded-btn border border-line px-2 py-1.5">
            <Search size={13} className="text-ink-4" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (objet, expéditeur…)" className="min-w-0 flex-1 text-[13px] outline-none" />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {(hits === null || accounts === null) && <p className="px-1.5 py-2 text-xs text-ink-4">Recherche…</p>}
            {hits?.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-4">Aucun e-mail trouvé.</p>}
            {hits?.map((m) => (
              <button key={m.id} onClick={() => void onPick(accountId, m, copyAttachments)} className="flex w-full items-start gap-2 rounded-btn px-1.5 py-1.5 text-left hover:bg-hover">
                <SenderAvatar name={m.from} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-2">{parseSenderName(m.from)}</span>
                    {m.hasAttachments && <Paperclip size={11} className="shrink-0 text-ink-4" />}
                    <span className="shrink-0 font-mono text-[10px] text-ink-4">{m.date ? new Date(m.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""}</span>
                  </span>
                  <span className="block truncate text-[12px] text-ink-3">{m.subject}</span>
                </span>
              </button>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
            <input type="checkbox" checked={copyAttachments} onChange={(e) => setCopyAttachments(e.target.checked)} />
            Copier aussi les pièces jointes dans la carte
          </label>
          <p className="mt-1 text-[10px] leading-snug text-ink-4">Une copie de l&rsquo;e-mail est gardée dans la carte : tous ceux qui la voient peuvent le lire.</p>
        </>
      )}
    </Popover>
  );
}

/** Lecture d'un e-mail lié (copie enregistrée à la liaison). */
function EmailViewer({ id, onClose, onError }: { id: string; onClose: () => void; onError: (m: string) => void }) {
  const [mail, setMail] = useState<TeamCardEmail | null>(null);

  useEffect(() => {
    let alive = true;
    void getTeamCardEmail(id).then((res) => {
      if (!alive) return;
      if (res.ok) setMail(res.data);
      else {
        onError(res.error);
        onClose();
      }
    });
    return () => {
      alive = false;
    };
  }, [id, onClose, onError]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(6,14,28,0.6)] p-4" onMouseDown={onClose}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-panel bg-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink">{mail?.subject ?? "Chargement…"}</h2>
            {mail && (
              <div className="mt-2 flex items-center gap-2.5">
                <SenderAvatar name={mail.from} size={30} />
                <div className="min-w-0 text-xs text-ink-3">
                  <div className="truncate">
                    De : {mail.from}
                    {mail.sentAt ? ` — ${new Date(mail.sentAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}` : ""}
                  </div>
                  {(mail.to || mail.cc) && (
                    <div className="mt-0.5 truncate">
                      À : {mail.to}
                      {mail.cc ? ` · Cc : ${mail.cc}` : ""}
                    </div>
                  )}
                </div>
              </div>
            )}
            {mail && mail.attachmentNames.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-ink-4">
                <Paperclip size={11} /> {mail.attachmentNames.join(" · ")}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 text-ink-4 hover:bg-hover hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-[200px] overflow-y-auto px-5 py-4">
          {mail ? <EmailBody bodyText={mail.bodyText} bodyHtml={mail.bodyHtml} /> : <Loader2 size={16} className="animate-spin text-ink-4" />}
        </div>
      </div>
    </div>
  );
}

/** Depuis l'écran Mails : choisir une carte (mes tableaux, mes cartes assignées) où lier l'e-mail ouvert. */
export function LinkEmailToCardPopover({
  open,
  onClose,
  accountId,
  messageId,
  hasAttachments,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  messageId: string;
  hasAttachments: boolean;
  /** Message à afficher (bandeau de l'écran Mails), avec la carte liée pour l'ouvrir. */
  onDone: (message: string, card: { id: string; title: string } | null) => void;
}) {
  const [q, setQ] = useState("");
  const [cards, setCards] = useState<{ id: string; title: string; boardTitle: string }[] | null>(null);
  const [copyAttachments, setCopyAttachments] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      const res = await searchLinkableTeamCards(q);
      if (alive) setCards(res.ok ? res.data : []);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, q]);

  const link = async (card: { id: string; title: string }) => {
    setBusy(card.id);
    try {
      const r = unwrap(await linkEmailToTeamCard(card.id, accountId, messageId, { copyAttachments: hasAttachments && copyAttachments }));
      onDone(linkNotice(r) ?? `E-mail lié à la carte « ${card.title} ».`, card);
    } catch (e) {
      onDone(e instanceof Error ? e.message : "Liaison impossible.", null);
    }
    setBusy(null);
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} align="right" width={340}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Lier à une carte de l&rsquo;Espace Team</p>
      <div className="mb-2 flex items-center gap-1.5 rounded-btn border border-line px-2 py-1.5">
        <Search size={13} className="text-ink-4" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une carte…" className="min-w-0 flex-1 text-[13px] outline-none" />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {cards === null && <p className="px-1.5 py-2 text-xs text-ink-4">Recherche…</p>}
        {cards?.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-4">Aucune carte trouvée.</p>}
        {cards?.map((c) => (
          <button key={c.id} disabled={!!busy} onClick={() => void link(c)} className="flex w-full items-center gap-2 rounded-btn px-1.5 py-1.5 text-left hover:bg-hover disabled:opacity-50">
            {busy === c.id ? <Loader2 size={14} className="shrink-0 animate-spin text-ink-4" /> : <Kanban size={14} className="shrink-0 text-ink-4" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink-2">{c.title}</span>
              {c.boardTitle && <span className="block truncate text-[10px] text-ink-4">{c.boardTitle}</span>}
            </span>
          </button>
        ))}
      </div>
      {hasAttachments && (
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
          <input type="checkbox" checked={copyAttachments} onChange={(e) => setCopyAttachments(e.target.checked)} />
          Copier aussi les pièces jointes dans la carte
        </label>
      )}
      <p className="mt-1 text-[10px] leading-snug text-ink-4">Une copie de l&rsquo;e-mail est gardée dans la carte : tous ceux qui la voient peuvent le lire.</p>
    </Popover>
  );
}
