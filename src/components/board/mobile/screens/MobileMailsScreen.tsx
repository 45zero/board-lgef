"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  Plus,
  RefreshCw,
  Send,
  X,
  Trash2,
  Reply,
  Paperclip,
  Download,
  Inbox as InboxIcon,
  AlertOctagon,
  FileEdit,
  ChevronLeft,
} from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import {
  listMyMessages,
  getMyMessage,
  sendMyMessage,
  replyToMyMessage,
  trashMyMessage,
  getMyAttachment,
  listMyLabels,
  listMyDrafts,
  getMyDraft,
  saveMyDraft,
  sendMyDraft,
  deleteMyDraft,
} from "@/app/actions/gmail";

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
type MessageListItem = Awaited<ReturnType<typeof listMyMessages>>["messages"][number];
type MessageDetail = Awaited<ReturnType<typeof getMyMessage>>;
type LabelItem = Awaited<ReturnType<typeof listMyLabels>>[number];
type DraftListItem = Awaited<ReturnType<typeof listMyDrafts>>["drafts"][number];

const SYSTEM_FOLDERS = [
  { id: "INBOX", name: "Boîte de réception", labelIds: ["INBOX"], icon: InboxIcon },
  { id: "SENT", name: "Envoyés", labelIds: ["SENT"], icon: Send },
  { id: "DRAFTS", name: "Brouillons", labelIds: [] as string[], icon: FileEdit },
  { id: "SPAM", name: "Spam", labelIds: ["SPAM"], icon: AlertOctagon },
  { id: "TRASH", name: "Corbeille", labelIds: ["TRASH"], icon: Trash2 },
] as const;

function base64UrlToBlob(base64url: string, mimeType: string) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const byteChars = atob(padded);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function MobileMailsScreen() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string>("INBOX");
  const [labels, setLabels] = useState<LabelItem[]>([]);

  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  useEffect(() => {
    getMyConnectedAccounts().then((accs) => {
      setAccounts(accs);
      if (accs.length > 0) setActiveAccountId(accs[0].id);
    });
  }, []);

  useEffect(() => {
    if (!activeAccountId) return;
    listMyLabels(activeAccountId).then(setLabels);
  }, [activeAccountId]);

  const refresh = () => {
    if (!activeAccountId) return;
    setLoading(true);
    setSelected(null);
    if (folder === "DRAFTS") {
      listMyDrafts(activeAccountId)
        .then((res) => setDrafts(res.drafts))
        .finally(() => setLoading(false));
      return;
    }
    const systemFolder = SYSTEM_FOLDERS.find((f) => f.id === folder);
    const labelIds: string[] = systemFolder ? [...systemFolder.labelIds] : [folder];
    listMyMessages(activeAccountId, { labelIds })
      .then((res) => setMessages(res.messages))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dep-change needs a loading flag reset before the request resolves
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, folder]);

  const openMessage = async (id: string) => {
    if (!activeAccountId) return;
    const detail = await getMyMessage(activeAccountId, id);
    setSelected(detail);
  };

  const openDraft = (id: string) => {
    setEditingDraftId(id);
    setComposing(true);
  };

  const handleTrash = async (id: string) => {
    if (!activeAccountId) return;
    await trashMyMessage(activeAccountId, id);
    setSelected(null);
    refresh();
  };

  const handleDownload = async (messageId: string, attachmentId: string, filename: string, mimeType: string) => {
    if (!activeAccountId) return;
    const { data } = await getMyAttachment(activeAccountId, messageId, attachmentId);
    const blob = base64UrlToBlob(data, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (accounts === null) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-[0.1em] text-ink-4">
        Chargement…
      </div>
    );
  }

  if (accounts.length === 0) {
    return <MobileConnectAccountEmptyState />;
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 py-2.5">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setActiveAccountId(acc.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              activeAccountId === acc.id
                ? "border-navy bg-navy text-white"
                : "border-line bg-card text-ink-2"
            }`}
          >
            {acc.label || acc.email}
          </button>
        ))}
        <a
          href="/api/oauth/google/start"
          className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-ink-3"
        >
          <Plus size={12} /> Compte
        </a>
        <button
          onClick={refresh}
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-ink-3"
          aria-label="Actualiser"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 pb-2.5">
        {SYSTEM_FOLDERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFolder(f.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
              folder === f.id ? "bg-navy text-white" : "bg-subtle text-ink-2"
            }`}
          >
            <f.icon size={12} /> {f.name}
          </button>
        ))}
        {labels.map((l) => (
          <button
            key={l.id}
            onClick={() => setFolder(l.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
              folder === l.id ? "bg-navy text-white" : "bg-subtle text-ink-2"
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Chargement…</div>
        )}

        {!loading && folder === "DRAFTS" && drafts.length === 0 && (
          <div className="p-4 text-sm text-ink-3">Aucun brouillon.</div>
        )}
        {!loading &&
          folder === "DRAFTS" &&
          drafts.map((d) => (
            <button
              key={d.id}
              onClick={() => openDraft(d.id)}
              className="block w-full border-b border-line px-4 py-3 text-left active:bg-hover"
            >
              <div className="truncate text-sm font-medium text-ink-2">{d.to || "(destinataire vide)"}</div>
              <div className="truncate text-sm text-ink-2">{d.subject}</div>
              <div className="truncate text-xs text-ink-4">{d.snippet}</div>
            </button>
          ))}

        {!loading && folder !== "DRAFTS" && messages.length === 0 && (
          <div className="p-4 text-sm text-ink-3">Aucun message.</div>
        )}
        {!loading &&
          folder !== "DRAFTS" &&
          messages.map((m) => (
            <button
              key={m.id}
              onClick={() => openMessage(m.id)}
              className="block w-full border-b border-line px-4 py-3 text-left active:bg-hover"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm ${m.unread ? "font-bold text-ink" : "font-medium text-ink-2"}`}>
                  {m.from}
                </span>
                {m.hasAttachments && <Paperclip size={12} className="shrink-0 text-ink-4" />}
              </div>
              <div className="truncate text-sm text-ink-2">{m.subject}</div>
              <div className="truncate text-xs text-ink-4">{m.snippet}</div>
            </button>
          ))}
      </div>

      <button
        onClick={() => {
          setEditingDraftId(null);
          setComposing(true);
        }}
        className="absolute bottom-4 right-4 flex items-center justify-center rounded-full bg-red text-white shadow-btn-red"
        style={{ width: 52, height: 52 }}
        aria-label="Nouveau message"
      >
        <Plus size={22} />
      </button>

      {selected && (
        <MobileMessageDetail
          message={selected}
          onClose={() => setSelected(null)}
          onReply={() => setReplying(true)}
          onTrash={() => handleTrash(selected.id)}
          onDownload={handleDownload}
        />
      )}

      {composing && activeAccountId && (
        <MobileComposeModal
          accountId={activeAccountId}
          draftId={editingDraftId}
          onClose={() => {
            setComposing(false);
            setEditingDraftId(null);
            refresh();
          }}
        />
      )}

      {replying && activeAccountId && selected && (
        <MobileReplyModal
          accountId={activeAccountId}
          message={selected}
          onClose={() => setReplying(false)}
        />
      )}
    </div>
  );
}

function MobileMessageDetail({
  message,
  onClose,
  onReply,
  onTrash,
  onDownload,
}: {
  message: MessageDetail;
  onClose: () => void;
  onReply: () => void;
  onTrash: () => void;
  onDownload: (messageId: string, attachmentId: string, filename: string, mimeType: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3">
          <ChevronLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-ink">{message.subject}</div>
          <div className="truncate text-xs text-ink-3">
            De : {message.from} — {message.date}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {message.attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <button
                key={a.attachmentId}
                onClick={() => onDownload(message.id, a.attachmentId, a.filename, a.mimeType)}
                className="flex items-center gap-1.5 rounded-btn border border-line bg-subtle px-2.5 py-1.5 text-xs text-ink-2"
              >
                <Download size={12} /> {a.filename}
              </button>
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap text-sm text-ink-2">
          {message.bodyText || message.bodyHtml || "(message vide)"}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <button
          onClick={onReply}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-btn border border-line px-3 py-2.5 text-sm font-semibold text-ink-2"
        >
          <Reply size={14} /> Répondre
        </button>
        <button
          onClick={onTrash}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-btn border border-line px-3 py-2.5 text-sm font-semibold text-ink-2"
        >
          <Trash2 size={14} /> Supprimer
        </button>
      </div>
    </div>
  );
}

function MobileComposeModal({
  accountId,
  draftId,
  onClose,
}: {
  accountId: string;
  draftId: string | null;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(draftId);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!draftId) return;
    getMyDraft(accountId, draftId).then((d) => {
      setTo(d.to);
      setSubject(d.subject);
      setBody(d.bodyText);
    });
  }, [accountId, draftId]);

  const handleSend = async () => {
    setSending(true);
    try {
      if (currentDraftId) {
        await saveMyDraft(accountId, { draftId: currentDraftId, to, subject, body });
        await sendMyDraft(accountId, currentDraftId);
      } else {
        await sendMyMessage(accountId, { to, subject, body });
      }
      onClose();
    } finally {
      setSending(false);
    }
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const id = await saveMyDraft(accountId, { draftId: currentDraftId ?? undefined, to, subject, body });
      setCurrentDraftId(id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!currentDraftId) return;
    await deleteMyDraft(accountId, currentDraftId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <h3 className="text-sm font-bold text-ink">
          {currentDraftId ? "Modifier le brouillon" : "Nouveau message"}
        </h3>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-4">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <input
          placeholder="À"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-full rounded-btn border border-line px-3 py-2.5 text-sm outline-none"
        />
        <input
          placeholder="Objet"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full rounded-btn border border-line px-3 py-2.5 text-sm outline-none"
        />
        <textarea
          placeholder="Votre message"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-btn border border-line px-3 py-2.5 text-sm outline-none"
        />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        {currentDraftId && (
          <button onClick={handleDeleteDraft} className="text-left text-xs font-semibold text-red">
            Supprimer le brouillon
          </button>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex-1 rounded-btn border border-line px-4 py-2.5 text-sm text-ink-2 disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Brouillon"}
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !to || !subject}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-btn bg-red px-4 py-2.5 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
          >
            <Send size={14} /> {sending ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileReplyModal({
  accountId,
  message,
  onClose,
}: {
  accountId: string;
  message: MessageDetail;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      await replyToMyMessage(accountId, message.id, { body });
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <h3 className="truncate text-sm font-bold text-ink">Répondre à {message.from}</h3>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-4">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <textarea
          autoFocus
          placeholder="Votre réponse"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-btn border border-line px-3 py-2.5 text-sm outline-none"
        />
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <button onClick={onClose} className="rounded-btn border border-line px-4 py-2.5 text-sm text-ink-2">
          Annuler
        </button>
        <button
          onClick={handleSend}
          disabled={sending || !body}
          className="flex items-center gap-1.5 rounded-btn bg-red px-4 py-2.5 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
        >
          <Send size={14} /> {sending ? "Envoi…" : "Répondre"}
        </button>
      </div>
    </div>
  );
}

function MobileConnectAccountEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-btn bg-subtle text-ink-3">
        <Mail size={22} />
      </div>
      <div>
        <h2 className="text-base font-bold text-ink">Aucun compte mail connecté</h2>
        <p className="mt-1 text-sm text-ink-3">
          Connectez un compte pour voir vos mails ici. C&rsquo;est facultatif : Board LGEF fonctionne
          normalement sans.
        </p>
      </div>
      <a
        href="/api/oauth/google/start"
        className="rounded-btn bg-navy px-4 py-2.5 text-sm font-bold text-white"
      >
        Connecter Gmail
      </a>
    </div>
  );
}
