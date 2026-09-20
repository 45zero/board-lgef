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
  Forward,
  Archive,
  Paperclip,
  Download,
  Inbox as InboxIcon,
  AlertOctagon,
  FileEdit,
  Tag,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import {
  listMyMessages,
  getMyMessage,
  sendMyMessage,
  replyToMyMessage,
  forwardMyMessage,
  archiveMyMessage,
  trashMyMessage,
  getMyAttachment,
  listMyLabels,
  createMyLabel,
  deleteMyLabel,
  listMyDrafts,
  getMyDraft,
  saveMyDraft,
  sendMyDraft,
  deleteMyDraft,
} from "@/app/actions/gmail";
import { EmailBody } from "@/components/board/mail/EmailBody";

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

export function MailsScreen() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string>("INBOX");
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [addingLabel, setAddingLabel] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");

  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [forwarding, setForwarding] = useState<MessageDetail | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("google_connected");
    const error = params.get("google_error");
    if (connected) return `Compte Google connecté : ${connected}`;
    if (error) return "La connexion Google a échoué — réessayez.";
    return null;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("google_connected") && !params.has("google_error")) return;
    params.delete("google_connected");
    params.delete("google_error");
    const clean = params.toString();
    window.history.replaceState({}, "", clean ? `?${clean}` : window.location.pathname);
  }, []);

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
    listMyMessages(activeAccountId, { labelIds, query: activeQuery.trim() || undefined })
      .then((res) => setMessages(res.messages))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dep-change needs a loading flag reset before the request resolves
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, folder, activeQuery]);

  const runSearch = () => setActiveQuery(searchInput);
  const clearSearch = () => {
    setSearchInput("");
    setActiveQuery("");
  };

  const folderLabel =
    SYSTEM_FOLDERS.find((f) => f.id === folder)?.name ?? labels.find((l) => l.id === folder)?.name ?? "Messages";
  const unreadCount = messages.filter((m) => m.unread).length;

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
    setSelected((s) => (s?.id === id ? null : s));
    refresh();
  };

  const handleArchive = async (id: string) => {
    if (!activeAccountId) return;
    await archiveMyMessage(activeAccountId, id);
    setSelected((s) => (s?.id === id ? null : s));
    refresh();
  };

  const handleForward = async (id: string) => {
    if (!activeAccountId) return;
    const detail = await getMyMessage(activeAccountId, id);
    setForwarding(detail);
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

  const handleCreateLabel = async () => {
    if (!activeAccountId || !newLabelName.trim()) return;
    const label = await createMyLabel(activeAccountId, newLabelName.trim());
    setLabels((prev) => [...prev, label]);
    setNewLabelName("");
    setAddingLabel(false);
  };

  const handleDeleteLabel = async (labelId: string) => {
    if (!activeAccountId) return;
    await deleteMyLabel(activeAccountId, labelId);
    setLabels((prev) => prev.filter((l) => l.id !== labelId));
    if (folder === labelId) setFolder("INBOX");
  };

  if (accounts === null) {
    return (
      <div className="flex h-full items-center justify-center rounded-panel border border-line bg-card/60 font-mono text-xs uppercase tracking-[0.1em] text-ink-4">
        Chargement…
      </div>
    );
  }

  if (accounts.length === 0) {
    return <ConnectAccountEmptyState />;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {banner && (
        <div className="flex items-center justify-between rounded-btn border border-line bg-card px-4 py-2 text-sm text-ink-2">
          {banner}
          <button onClick={() => setBanner(null)} className="text-ink-4 hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] tracking-[0.12em] text-ink-4 uppercase">
            Mails · Messagerie
          </div>
          <h1 className="mt-1 text-2xl font-extrabold text-ink">{folderLabel}</h1>
          <p className="mt-1 text-sm text-ink-3">
            {unreadCount} message{unreadCount === 1 ? "" : "s"} non lu{unreadCount === 1 ? "" : "s"} ·{" "}
            {messages.length} conversation{messages.length === 1 ? "" : "s"} · {labels.length} dossier
            {labels.length === 1 ? "" : "s"} partagé{labels.length === 1 ? "" : "s"}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex min-w-[220px] items-center gap-2 rounded-btn border border-line bg-card px-3 py-2">
            <Search size={14} className="shrink-0 text-ink-4" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Rechercher un message..."
              className="w-full bg-transparent text-sm outline-none"
            />
            {activeQuery && (
              <button onClick={clearSearch} className="text-ink-4 hover:text-ink">
                <X size={13} />
              </button>
            )}
          </div>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-btn border border-line text-ink-3 hover:bg-hover"
            aria-label="Filtres"
            title="Filtres (à venir)"
          >
            <SlidersHorizontal size={15} />
          </button>
          <button
            onClick={() => {
              setEditingDraftId(null);
              setComposing(true);
            }}
            className="flex items-center gap-1.5 rounded-btn bg-navy px-3.5 py-2 text-sm font-bold text-white hover:bg-navy-600"
          >
            <Plus size={15} /> Nouveau message
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => setActiveAccountId(acc.id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                activeAccountId === acc.id
                  ? "border-navy bg-navy text-white"
                  : "border-line bg-card text-ink-2 hover:bg-hover"
              }`}
            >
              {acc.label || acc.email}
            </button>
          ))}
          <a
            href="/api/oauth/google/start"
            className="flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover"
          >
            <Plus size={12} /> Ajouter un compte
          </a>
        </div>

        <button
          onClick={refresh}
          className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-3 hover:bg-hover"
          aria-label="Actualiser"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="grid flex-1 grid-cols-[180px_340px_1fr] gap-4 overflow-hidden">
        <div className="flex flex-col gap-1 overflow-y-auto rounded-panel border border-line bg-card p-2">
          {SYSTEM_FOLDERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFolder(f.id)}
              className={`flex items-center gap-2 rounded-btn px-3 py-2 text-left text-sm font-semibold ${
                folder === f.id ? "bg-navy text-white" : "text-ink-2 hover:bg-hover"
              }`}
            >
              <f.icon size={14} /> {f.name}
            </button>
          ))}

          <div className="mt-3 flex items-center justify-between px-3 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
            Libellés
            <button onClick={() => setAddingLabel(true)} className="text-ink-3 hover:text-ink">
              <Plus size={12} />
            </button>
          </div>

          {addingLabel && (
            <div className="flex items-center gap-1 px-2">
              <input
                autoFocus
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateLabel()}
                placeholder="Nom du libellé"
                className="w-full rounded-btn border border-line px-2 py-1 text-xs outline-none"
              />
            </div>
          )}

          {labels.map((l) => (
            <div
              key={l.id}
              className={`group flex items-center justify-between gap-1 rounded-btn px-3 py-2 text-sm ${
                folder === l.id ? "bg-navy text-white" : "text-ink-2 hover:bg-hover"
              }`}
            >
              <button onClick={() => setFolder(l.id)} className="flex flex-1 items-center gap-2 truncate text-left">
                <Tag size={13} /> <span className="truncate">{l.name}</span>
              </button>
              <button
                onClick={() => handleDeleteLabel(l.id)}
                className="hidden text-ink-4 hover:text-red group-hover:block"
                aria-label="Supprimer le libellé"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="overflow-y-auto rounded-panel border border-line bg-card">
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
                className="block w-full border-b border-line px-4 py-3 text-left hover:bg-hover"
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
              <div
                key={m.id}
                className={`group flex items-center gap-1 border-b border-line pr-1.5 hover:bg-hover ${
                  selected?.id === m.id ? "bg-sel-bg" : ""
                }`}
              >
                <button onClick={() => openMessage(m.id)} className="min-w-0 flex-1 px-4 py-3 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${m.unread ? "font-bold text-ink" : "font-medium text-ink-2"}`}>
                      {m.from}
                    </span>
                    {m.hasAttachments && <Paperclip size={12} className="shrink-0 text-ink-4" />}
                  </div>
                  <div className="truncate text-sm text-ink-2">{m.subject}</div>
                  <div className="truncate text-xs text-ink-4">{m.snippet}</div>
                </button>
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    onClick={() => handleArchive(m.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3 hover:bg-subtle"
                    aria-label="Archiver"
                    title="Archiver"
                  >
                    <Archive size={13} />
                  </button>
                  <button
                    onClick={() => handleForward(m.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3 hover:bg-subtle"
                    aria-label="Transférer"
                    title="Transférer"
                  >
                    <Forward size={13} />
                  </button>
                  <button
                    onClick={() => handleTrash(m.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3 hover:bg-subtle hover:text-red"
                    aria-label="Supprimer"
                    title="Supprimer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
        </div>

        <div className="overflow-y-auto rounded-panel border border-line bg-card p-6">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-4">
              Sélectionnez un message.
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-bold text-ink">{selected.subject}</h2>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => setReplying(true)}
                    className="flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover"
                  >
                    <Reply size={13} /> Répondre
                  </button>
                  <button
                    onClick={() => setForwarding(selected)}
                    className="flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover"
                  >
                    <Forward size={13} /> Transférer
                  </button>
                  <button
                    onClick={() => handleArchive(selected.id)}
                    className="flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover"
                  >
                    <Archive size={13} /> Archiver
                  </button>
                  <button
                    onClick={() => handleTrash(selected.id)}
                    className="flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover"
                  >
                    <Trash2 size={13} /> Supprimer
                  </button>
                </div>
              </div>
              <div className="mt-1 text-xs text-ink-3">
                De : {selected.from} — {selected.date}
              </div>

              {selected.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selected.attachments.map((a) => (
                    <button
                      key={a.attachmentId}
                      onClick={() => handleDownload(selected.id, a.attachmentId, a.filename, a.mimeType)}
                      className="flex items-center gap-1.5 rounded-btn border border-line bg-subtle px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover"
                    >
                      <Download size={12} /> {a.filename}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-4">
                <EmailBody bodyText={selected.bodyText} bodyHtml={selected.bodyHtml} />
              </div>
            </div>
          )}
        </div>
      </div>

      {composing && activeAccountId && (
        <ComposeModal
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
        <ReplyModal
          accountId={activeAccountId}
          message={selected}
          onClose={() => setReplying(false)}
        />
      )}

      {forwarding && activeAccountId && (
        <ForwardModal
          accountId={activeAccountId}
          message={forwarding}
          onClose={() => setForwarding(null)}
        />
      )}
    </div>
  );
}

function ComposeModal({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-modal border border-line bg-card p-6 shadow-modal">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">{currentDraftId ? "Modifier le brouillon" : "Nouveau message"}</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <input
            placeholder="À"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
          <input
            placeholder="Objet"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
          <textarea
            placeholder="Votre message"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div>
            {currentDraftId && (
              <button onClick={handleDeleteDraft} className="text-xs font-semibold text-red hover:underline">
                Supprimer le brouillon
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={handleSaveDraft} disabled={saving} className="rounded-btn border border-line px-4 py-2 text-sm text-ink-2 disabled:opacity-60">
              {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !to || !subject}
              className="flex items-center gap-1.5 rounded-btn bg-red px-4 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
            >
              <Send size={14} /> {sending ? "Envoi…" : "Envoyer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReplyModal({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-modal border border-line bg-card p-6 shadow-modal">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">Répondre à {message.from}</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <textarea
          autoFocus
          placeholder="Votre réponse"
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm text-ink-2">
            Annuler
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !body}
            className="flex items-center gap-1.5 rounded-btn bg-red px-4 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
          >
            <Send size={14} /> {sending ? "Envoi…" : "Répondre"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ForwardModal({
  accountId,
  message,
  onClose,
}: {
  accountId: string;
  message: MessageDetail;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      await forwardMyMessage(accountId, message.id, { to, body });
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-modal border border-line bg-card p-6 shadow-modal">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">Transférer « {message.subject} »</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <input
            autoFocus
            placeholder="À"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
          <textarea
            placeholder="Ajouter un message (optionnel)"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm text-ink-2">
            Annuler
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !to}
            className="flex items-center gap-1.5 rounded-btn bg-red px-4 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
          >
            <Forward size={14} /> {sending ? "Envoi…" : "Transférer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectAccountEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-panel border border-dashed border-line bg-card/60 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-btn bg-subtle text-ink-3">
        <Mail size={22} />
      </div>
      <div>
        <h2 className="text-base font-bold text-ink">Aucun compte mail connecté</h2>
        <p className="mt-1 max-w-md text-sm text-ink-3">
          Connectez un compte pour voir vos mails ici. C&rsquo;est facultatif : Board LGEF fonctionne
          normalement sans. La connexion Outlook (environnement FFF) arrivera dès l&rsquo;ouverture du
          portail Azure par la FFF — en attendant, vous pouvez tester avec un compte Gmail.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <a
          href="/api/oauth/google/start"
          className="flex items-center gap-1.5 rounded-btn bg-navy px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-600"
        >
          Connecter Gmail
        </a>
        <button
          disabled
          className="rounded-btn border border-line px-4 py-2.5 text-sm font-semibold text-ink-4 opacity-60"
          title="En attente de l'ouverture du portail Azure par la FFF"
        >
          Connecter Outlook (bientôt)
        </button>
      </div>
    </div>
  );
}
