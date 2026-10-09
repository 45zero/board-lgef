"use client";

import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useEffect, useRef, useState } from "react";
import { readCache, writeCache } from "@/lib/board/localCache";
import { getCachedMail, loadMail, loadMailList, prefetchMails } from "@/lib/board/mailClient";
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
  Eye,
  Inbox as InboxIcon,
  AlertOctagon,
  FileEdit,
  ChevronLeft,
  ChevronDown,
  Check,
  Kanban,
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
  listMyDrafts,
  getMyDraft,
  saveMyDraft,
  sendMyDraft,
  deleteMyDraft,
} from "@/app/actions/gmail";
import { EmailBody } from "@/components/board/mail/EmailBody";
import { LinkEmailToCardPopover } from "@/components/board/team/TeamEmails";
import { useOpenTeamCard } from "@/components/board/team/TeamCardOpener";
import { SenderAvatar, parseSenderName } from "@/components/board/mail/SenderAvatar";

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

const SWIPE_THRESHOLD = -72;
const LONG_PRESS_MS = 450;

function base64UrlToBlob(base64url: string, mimeType: string) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const byteChars = atob(padded);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// Caches partagés au niveau du module : ils survivent à un changement d'onglet (l'écran peut être
// démonté) ; les listes sont aussi gardées dans le navigateur pour un affichage instantané à la
// prochaine ouverture de l'appli (voir localCache).
const messagesCache = new Map<string, MessageListItem[]>();

export function MobileMailsScreen({
  menuOpen = false,
  onMenuClose,
  onContextChange,
}: {
  menuOpen?: boolean;
  onMenuClose?: () => void;
  /** Libellé « Dossier · compte » affiché sous le titre de l'en-tête. */
  onContextChange?: (label: string) => void;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(() => readCache<Account[]>("mail:accounts") ?? null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(() => readCache<Account[]>("mail:accounts")?.[0]?.id ?? null);
  const [folder, setFolder] = useState<string>("INBOX");
  // Libellés du compte affiché au démarrage : lus du cache, rafraîchis dès que le compte est connu.
  const [labels, setLabels] = useState<LabelItem[]>(() => {
    const first = readCache<Account[]>("mail:accounts")?.[0]?.id;
    return (first && readCache<LabelItem[]>(`mail:labels:${first}`)) || [];
  });

  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [forwarding, setForwarding] = useState<MessageDetail | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getMyConnectedAccounts().then((accs) => {
      setAccounts(accs);
      writeCache("mail:accounts", accs);
      setActiveAccountId((current) => (current && accs.some((a) => a.id === current) ? current : (accs[0]?.id ?? null)));
    });
  }, []);

  useEffect(() => {
    if (!activeAccountId) return;
    listMyLabels(activeAccountId).then((l) => {
      setLabels(l);
      writeCache(`mail:labels:${activeAccountId}`, l);
    });
  }, [activeAccountId]);

  // Dossier et compte affichés dans l'en-tête (les onglets étant repliés dans le menu du logo).
  useEffect(() => {
    const folderName = SYSTEM_FOLDERS.find((f) => f.id === folder)?.name ?? labels.find((l) => l.id === folder)?.name ?? "Mails";
    const account = accounts?.find((a) => a.id === activeAccountId);
    onContextChange?.(account ? `${folderName} · ${account.label || account.email}` : folderName);
  }, [folder, labels, accounts, activeAccountId, onContextChange]);


  const refresh = () => {
    if (!activeAccountId) return;
    setSelected(null);
    if (folder === "DRAFTS") {
      setLoading(true);
      listMyDrafts(activeAccountId)
        .then((res) => setDrafts(res.drafts))
        .finally(() => setLoading(false));
      return;
    }
    const cacheKey = `${activeAccountId}:${folder}`;
    const cached = messagesCache.get(cacheKey) ?? readCache<MessageListItem[]>(`mail:list:${cacheKey}`);
    if (cached) {
      setMessages(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const systemFolder = SYSTEM_FOLDERS.find((f) => f.id === folder);
    const labelIds: string[] = systemFolder ? [...systemFolder.labelIds] : [folder];
    loadMailList(activeAccountId, { labelIds })
      .then((res) => {
        messagesCache.set(cacheKey, res.messages);
        writeCache(`mail:list:${cacheKey}`, res.messages);
        setMessages(res.messages);
        prefetchMails(activeAccountId, res.messages.map((m) => m.id));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dep-change needs a loading flag reset before the request resolves
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, folder]);

  // En direct : nouveau mail (compteur Gmail vérifié toutes les 30 s) → la liste se met à jour
  // sans fermer le mail ouvert ni afficher de chargement.
  useLiveRefresh(["mails"], () => {
    if (!activeAccountId || folder === "DRAFTS") return;
    const cacheKey = `${activeAccountId}:${folder}`;
    const systemFolder = SYSTEM_FOLDERS.find((f) => f.id === folder);
    loadMailList(activeAccountId, { labelIds: systemFolder ? [...systemFolder.labelIds] : [folder] })
      .then((res) => {
        messagesCache.set(cacheKey, res.messages);
        writeCache(`mail:list:${cacheKey}`, res.messages);
        setMessages(res.messages);
      })
      .catch(() => undefined);
  });

  const openMessage = async (id: string) => {
    if (!activeAccountId) return;
    const cached = getCachedMail(activeAccountId, id);
    if (cached) {
      // Déjà préchargé : ouverture instantanée, sans aller-retour réseau.
      setSelected(cached);
      setSelectedLoading(false);
      return;
    }
    // Ouverture immédiate avec ce que la liste connaît déjà (expéditeur, objet, aperçu), corps ensuite.
    const item = messages.find((m) => m.id === id);
    if (item) {
      setSelected({
        id: item.id,
        threadId: "",
        from: item.from,
        to: "",
        cc: "",
        subject: item.subject,
        date: item.date,
        messageIdHeader: "",
        referencesHeader: "",
        bodyText: item.snippet,
        bodyHtml: "",
        labelIds: [],
        attachments: [],
      });
      setSelectedLoading(true);
    }
    try {
      const detail = await loadMail(activeAccountId, id);
      setSelected((current) => (current && current.id !== id ? current : detail));
    } finally {
      setSelectedLoading(false);
    }
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
    setForwarding(await loadMail(activeAccountId, id));
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

  /** Ouvre l'aperçu natif du navigateur (image/PDF) plutôt que de forcer un téléchargement. */
  const handlePreview = async (messageId: string, attachmentId: string, mimeType: string) => {
    if (!activeAccountId) return;
    const { data } = await getMyAttachment(activeAccountId, messageId, attachmentId);
    const blob = base64UrlToBlob(data, mimeType);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const enterSelectMode = (id: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectMode(false);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkArchive = async () => {
    if (!activeAccountId) return;
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => archiveMyMessage(activeAccountId, id)));
    exitSelectMode();
    refresh();
  };

  const handleBulkTrash = async () => {
    if (!activeAccountId) return;
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => trashMyMessage(activeAccountId, id)));
    exitSelectMode();
    refresh();
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
      {/* Comptes, dossiers et libellés : repliés par défaut pour que les mails soient tout en haut,
          ouverts en touchant le logo de l'en-tête (voir MobileShell). */}
      {menuOpen && (
        <>
          <div className="absolute inset-0 z-30 bg-black/30" onClick={onMenuClose} />
          <div className="absolute inset-x-0 top-0 z-40 max-h-[75%] overflow-y-auto rounded-b-modal border-b border-line bg-card pb-3 shadow-modal">
            <div className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Comptes</div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-1.5">
              {accounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => {
                    setActiveAccountId(acc.id);
                    onMenuClose?.();
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    activeAccountId === acc.id ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-2"
                  }`}
                >
                  {acc.label || acc.email}
                </button>
              ))}
              <a
                href="/api/oauth/google/start"
                className="flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-ink-3"
              >
                <Plus size={12} /> Compte
              </a>
            </div>

            <div className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Dossiers</div>
            <div className="px-2">
              {SYSTEM_FOLDERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setFolder(f.id);
                    onMenuClose?.();
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-btn px-3 py-2.5 text-left text-sm font-semibold ${
                    folder === f.id ? "bg-sel-bg text-link" : "text-ink-2 active:bg-hover"
                  }`}
                >
                  <f.icon size={15} /> {f.name}
                </button>
              ))}
            </div>

            {labels.length > 0 && (
              <>
                <div className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Libellés</div>
                <div className="flex flex-wrap gap-1.5 px-4">
                  {labels.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => {
                        setFolder(l.id);
                        onMenuClose?.();
                      }}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${folder === l.id ? "bg-navy text-white" : "bg-subtle text-ink-2"}`}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="px-4 pt-3">
              <button
                onClick={() => {
                  refresh();
                  onMenuClose?.();
                }}
                className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-3"
              >
                <RefreshCw size={12} /> Actualiser
              </button>
            </div>
          </div>
        </>
      )}

      <div className="flex-1 overflow-y-auto pb-16">
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
            <SwipeableMailRow
              key={m.id}
              selectMode={selectMode}
              selected={selectedIds.has(m.id)}
              onTap={() => (selectMode ? toggleSelected(m.id) : openMessage(m.id))}
              onLongPress={() => enterSelectMode(m.id)}
              onArchive={() => handleArchive(m.id)}
              avatar={<SenderAvatar name={m.from} size={38} />}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm ${m.unread ? "font-bold text-ink" : "font-medium text-ink-2"}`}>
                  {parseSenderName(m.from)}
                </span>
                {m.hasAttachments && <Paperclip size={12} className="shrink-0 text-ink-4" />}
              </div>
              <div className="truncate text-sm text-ink-2">{m.subject}</div>
              <div className="truncate text-xs text-ink-4">{m.snippet}</div>
            </SwipeableMailRow>
          ))}
      </div>

      {selectMode ? (
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between border-t border-line bg-card px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-modal">
          <button onClick={exitSelectMode} className="text-sm font-semibold text-ink-3">
            Annuler
          </button>
          <div className="text-sm font-semibold text-ink-2">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleBulkArchive}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2"
              aria-label="Archiver la sélection"
            >
              <Archive size={16} />
            </button>
            <button
              onClick={handleBulkTrash}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2"
              aria-label="Supprimer la sélection"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ) : (
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
      )}

      {selected && (
        <MobileMessageDetail
          accountId={activeAccountId}
          message={selected}
          loading={selectedLoading}
          onClose={() => setSelected(null)}
          onReply={() => setReplying(true)}
          onForward={() => handleForward(selected.id)}
          onArchive={() => handleArchive(selected.id)}
          onTrash={() => handleTrash(selected.id)}
          onDownload={handleDownload}
          onPreview={handlePreview}
        />
      )}

      {composing && activeAccountId && (
        <MobileComposeModal
          accountId={activeAccountId}
          accountEmail={accounts.find((a) => a.id === activeAccountId)?.email ?? ""}
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

      {forwarding && activeAccountId && (
        <MobileForwardModal
          accountId={activeAccountId}
          message={forwarding}
          onClose={() => setForwarding(null)}
        />
      )}
    </div>
  );
}

/** Ligne swipeable — glisser vers la gauche archive (comme Outlook), appui long entre en mode sélection. */
function SwipeableMailRow({
  selectMode,
  selected,
  onTap,
  onLongPress,
  onArchive,
  avatar,
  children,
}: {
  selectMode: boolean;
  selected: boolean;
  onTap: () => void;
  onLongPress: () => void;
  onArchive: () => void;
  avatar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const moved = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Capture le pointeur pour que le swipe reste fiable même si le doigt dérive
  // légèrement hors de la ligne (sans ça, le drag "décroche" en usage réel).
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    dragging.current = true;
    moved.current = false;
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointerId déjà relâché — sans conséquence
    }
    if (!selectMode) {
      longPressTimer.current = setTimeout(() => {
        if (!moved.current) {
          onLongPress();
          dragging.current = false;
          setDragX(0);
          setIsDragging(false);
        }
      }, LONG_PRESS_MS);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const deltaX = e.clientX - startX.current;
    const deltaY = e.clientY - startY.current;
    // Tout déplacement notable (vertical inclus) annule le tap — un scroll de la
    // liste ne suivait que l'axe X avant, donc un scroll vertical pur ouvrait le mail.
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      moved.current = true;
      clearLongPress();
    }
    // Le swipe pour archiver ne s'engage qu'une fois le seuil "moved" franchi et
    // le geste clairement horizontal — sinon le jitter d'un simple tap (1-2px)
    // faisait apparaître un flash du fond "Archiver".
    if (!selectMode && moved.current && deltaX < 0 && Math.abs(deltaX) > Math.abs(deltaY)) {
      setDragX(Math.max(deltaX, -110));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    clearLongPress();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // déjà relâché — sans conséquence
    }
    if (dragging.current && !moved.current) {
      onTap();
    } else if (!selectMode && dragX < SWIPE_THRESHOLD) {
      onArchive();
    }
    setIsDragging(false);
    setDragX(0);
    dragging.current = false;
  };

  return (
    <div className="relative overflow-hidden border-b border-line">
      <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-center bg-good text-white">
        <Archive size={18} />
      </div>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ transform: `translateX(${dragX}px)`, touchAction: "pan-y" }}
        className={`relative flex items-center gap-3 bg-card px-4 py-3 active:bg-hover ${
          isDragging ? "" : "transition-transform duration-200"
        } ${selected ? "bg-sel-bg" : ""}`}
      >
        {selectMode && (
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
              selected ? "border-navy bg-navy text-white" : "border-line-strong"
            }`}
          >
            {selected && <Check size={12} />}
          </span>
        )}
        {avatar}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function MobileMessageDetail({
  accountId,
  message,
  loading = false,
  onClose,
  onReply,
  onForward,
  onArchive,
  onTrash,
  onDownload,
  onPreview,
}: {
  accountId: string | null;
  message: MessageDetail;
  /** Corps en cours de chargement : l'aperçu de la liste est affiché en attendant. */
  loading?: boolean;
  onClose: () => void;
  onReply: () => void;
  onForward: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onDownload: (messageId: string, attachmentId: string, filename: string, mimeType: string) => void;
  onPreview: (messageId: string, attachmentId: string, mimeType: string) => void;
}) {
  const [linking, setLinking] = useState(false);
  const [linkNotice, setLinkNotice] = useState<{ message: string; card: { id: string; title: string } | null } | null>(null);
  const { open: openTeamCard } = useOpenTeamCard();
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3">
          <ChevronLeft size={20} />
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{message.subject}</div>
        {accountId && (
          <div className="relative">
            <button
              onClick={() => setLinking((v) => !v)}
              className="flex h-8 items-center gap-1 rounded-full px-2 text-[11px] font-semibold text-ink-3"
              aria-label="Lier à une carte de l'Espace Team"
            >
              <Kanban size={16} /> Carte
            </button>
            <LinkEmailToCardPopover
              open={linking}
              onClose={() => setLinking(false)}
              accountId={accountId}
              messageId={message.id}
              hasAttachments={message.attachments.length > 0}
              onDone={(text, card) => setLinkNotice({ message: text, card })}
            />
          </div>
        )}
      </div>
      {linkNotice && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-subtle px-4 py-2 text-xs text-ink-2">
          <span className="min-w-0 flex-1">{linkNotice.message}</span>
          {linkNotice.card && (
            <button onClick={() => openTeamCard(linkNotice.card!.id)} className="shrink-0 font-semibold text-link">
              Ouvrir
            </button>
          )}
          <button onClick={() => setLinkNotice(null)} aria-label="Fermer" className="shrink-0 text-ink-4">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-start gap-2.5">
          <SenderAvatar name={message.from} size={38} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-ink">{parseSenderName(message.from)}</div>
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0 flex-1 truncate text-xs text-ink-3">
                À {message.to}
                {message.cc ? ` · Cc ${message.cc}` : ""}
              </div>
              <span className="shrink-0 text-[11px] text-ink-4">{message.date}</span>
            </div>
          </div>
        </div>

        {message.attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <div
                key={a.attachmentId}
                className="flex items-center gap-1 rounded-btn border border-line bg-subtle pl-2.5 pr-1 py-1 text-xs text-ink-2"
              >
                <button
                  onClick={() => onPreview(message.id, a.attachmentId, a.mimeType)}
                  className="max-w-[140px] truncate"
                  title="Aperçu"
                >
                  {a.filename}
                </button>
                <button
                  onClick={() => onPreview(message.id, a.attachmentId, a.mimeType)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-btn text-ink-3"
                  aria-label="Aperçu"
                  title="Aperçu"
                >
                  <Eye size={12} />
                </button>
                <button
                  onClick={() => onDownload(message.id, a.attachmentId, a.filename, a.mimeType)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-btn text-ink-3"
                  aria-label="Télécharger"
                  title="Télécharger"
                >
                  <Download size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {loading && <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Chargement du message…</div>}
        <EmailBody bodyText={message.bodyText} bodyHtml={message.bodyHtml} />
      </div>

      <div className="flex shrink-0 items-center justify-around border-t border-line py-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
        <button onClick={onReply} className="flex flex-col items-center gap-1 px-2 text-ink-2">
          <Reply size={18} />
          <span className="text-[10px] font-semibold">Répondre</span>
        </button>
        <button onClick={onForward} className="flex flex-col items-center gap-1 px-2 text-ink-2">
          <Forward size={18} />
          <span className="text-[10px] font-semibold">Transférer</span>
        </button>
        <button onClick={onArchive} className="flex flex-col items-center gap-1 px-2 text-ink-2">
          <Archive size={18} />
          <span className="text-[10px] font-semibold">Archiver</span>
        </button>
        <button onClick={onTrash} className="flex flex-col items-center gap-1 px-2 text-ink-2">
          <Trash2 size={18} />
          <span className="text-[10px] font-semibold">Supprimer</span>
        </button>
      </div>
    </div>
  );
}

function MobileComposeModal({
  accountId,
  accountEmail,
  draftId,
  onClose,
}: {
  accountId: string;
  accountEmail: string;
  draftId: string | null;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [ccOpen, setCcOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(draftId);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!draftId) return;
    getMyDraft(accountId, draftId).then((d) => {
      setTo(d.to);
      setCc(d.cc);
      if (d.cc) setCcOpen(true);
      setSubject(d.subject);
      setBody(d.bodyText);
    });
  }, [accountId, draftId]);

  const handleSend = async () => {
    setSending(true);
    try {
      if (currentDraftId) {
        await saveMyDraft(accountId, { draftId: currentDraftId, to, cc, bcc, subject, body });
        await sendMyDraft(accountId, currentDraftId);
      } else {
        await sendMyMessage(accountId, { to, cc, bcc, subject, body });
      }
      onClose();
    } finally {
      setSending(false);
    }
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const id = await saveMyDraft(accountId, { draftId: currentDraftId ?? undefined, to, cc, bcc, subject, body });
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
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-4">
          <X size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-ink">
            {currentDraftId ? "Modifier le brouillon" : "Nouveau message"}
          </h3>
          {accountEmail && <div className="truncate text-xs text-ink-4">{accountEmail}</div>}
        </div>
        <button
          onClick={handleSend}
          disabled={sending || !to || !subject}
          className="flex h-8 w-8 items-center justify-center rounded-full text-navy disabled:opacity-40"
          aria-label="Envoyer"
        >
          <Send size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center border-b border-line py-2.5">
          <input
            placeholder="À"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full text-sm outline-none"
          />
          <button
            onClick={() => setCcOpen((o) => !o)}
            className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center text-ink-4"
            aria-label="Afficher Cc/Cci"
          >
            <ChevronDown size={16} className={ccOpen ? "rotate-180" : ""} />
          </button>
        </div>
        {ccOpen && (
          <>
            <input
              placeholder="Cc"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="w-full border-b border-line py-2.5 text-sm outline-none"
            />
            <input
              placeholder="Cci"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              className="w-full border-b border-line py-2.5 text-sm outline-none"
            />
          </>
        )}
        <input
          placeholder="Objet"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full border-b border-line py-2.5 text-sm outline-none"
        />
        <textarea
          placeholder="Votre message"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="mt-3 w-full text-sm outline-none"
        />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        {currentDraftId && (
          <button onClick={handleDeleteDraft} className="text-left text-xs font-semibold text-red">
            Supprimer le brouillon
          </button>
        )}
        <button
          onClick={handleSaveDraft}
          disabled={saving || sending}
          className="w-full rounded-btn border border-line px-4 py-2.5 text-sm text-ink-2 disabled:opacity-60"
        >
          {saving ? "Enregistrement…" : "Enregistrer comme brouillon"}
        </button>
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

function MobileForwardModal({
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
    <div className="fixed inset-0 z-50 flex flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <h3 className="truncate text-sm font-bold text-ink">Transférer « {message.subject} »</h3>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-4">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <input
          autoFocus
          placeholder="À"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-full rounded-btn border border-line px-3 py-2.5 text-sm outline-none"
        />
        <textarea
          placeholder="Ajouter un message (optionnel)"
          rows={8}
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
          disabled={sending || !to}
          className="flex items-center gap-1.5 rounded-btn bg-red px-4 py-2.5 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
        >
          <Forward size={14} /> {sending ? "Envoi…" : "Transférer"}
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
