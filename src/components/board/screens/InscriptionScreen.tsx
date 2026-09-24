"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  ArrowLeft,
  Check,
  X,
  Send,
  Link as LinkIcon,
  QrCode,
  Plus,
  Search,
  Trash2,
  Mail,
  Upload,
  Video,
  FileText,
  MapPin,
  PenLine,
  Type,
  ImageIcon,
  Calendar,
  ArrowUp,
  ArrowDown,
  MousePointerClick,
} from "lucide-react";
import { useUserRole } from "@/hooks/board/useUserRole";
import {
  listRegistrationEvents,
  getOrCreateCampaign,
  updateCampaign,
  addCampaignBlock,
  removeCampaignBlock,
  moveCampaignBlock,
  updateCampaignBlockContent,
  listCampaignRecipients,
  searchClubContacts,
  addRecipientsFromContacts,
  addManualRecipient,
  removeRecipient,
  sendCampaign,
} from "@/app/actions/registration";
import { uploadCampaignBlockAsset } from "@/lib/board/registrationAssets";
import type { EmailBlock } from "@/lib/board/registrationEmail";

type RegistrationEvent = Awaited<ReturnType<typeof listRegistrationEvents>>[number];
type Campaign = Awaited<ReturnType<typeof getOrCreateCampaign>>;
type Recipient = Awaited<ReturnType<typeof listCampaignRecipients>>[number];

function siteOrigin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

const BLOCK_TYPES: { type: EmailBlock["type"]; label: string; icon: typeof Type }[] = [
  { type: "text", label: "Texte", icon: Type },
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "date", label: "Date de l'événement", icon: Calendar },
  { type: "banner", label: "Bannière", icon: ImageIcon },
  { type: "map", label: "Carte / stationnement", icon: MapPin },
  { type: "video", label: "Vidéo", icon: Video },
  { type: "pdf", label: "Document PDF", icon: FileText },
  { type: "signature", label: "Signature", icon: PenLine },
  { type: "buttons", label: "Boutons de réponse", icon: MousePointerClick },
];

function newBlock(type: EmailBlock["type"]): EmailBlock {
  const id = crypto.randomUUID();
  switch (type) {
    case "text":
      return { id, type, content: "" };
    case "image":
      return { id, type, url: "" };
    case "date":
      return { id, type };
    case "banner":
      return { id, type, url: "" };
    case "map":
      return { id, type, label: "", address: "" };
    case "video":
      return { id, type, url: "" };
    case "pdf":
      return { id, type, url: "", filename: "" };
    case "signature":
      return { id, type, name: "", title: "", imageUrl: null };
    case "buttons":
      return { id, type };
  }
}

function ImageUploadBox({
  url,
  onUpload,
  onClear,
}: {
  url: string | null;
  onUpload: (file: File) => Promise<void>;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  return (
    <div>
      {url ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- lien Drive externe, pas un asset statique */}
          <img src={url} alt="" className="h-28 w-full rounded-btn border border-line object-cover" />
          <button
            onClick={onClear}
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-btn border border-dashed border-line text-xs font-semibold text-ink-3 hover:bg-hover disabled:opacity-50"
        >
          <Upload size={14} /> {uploading ? "Envoi…" : "Importer une image"}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setUploading(true);
          try {
            await onUpload(file);
          } finally {
            setUploading(false);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}

function BlockEditor({
  block,
  campaignId,
  index,
  total,
  onMove,
  onRemove,
  onPatch,
  onRefetch,
}: {
  block: EmailBlock;
  campaignId: string;
  index: number;
  total: number;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onRefetch: () => void;
}) {
  const info = BLOCK_TYPES.find((b) => b.type === block.type)!;
  const Icon = info.icon;
  const [text, setText] = useState(block.type === "text" ? block.content : "");
  const [busy, setBusy] = useState(false);

  const uploadAsset = async (kind: "image" | "banner" | "video" | "pdf" | "signature", file: File) => {
    setBusy(true);
    try {
      await uploadCampaignBlockAsset(campaignId, block.id, kind, file);
      onRefetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-panel border border-line bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-bold text-ink-3">
          <Icon size={13} /> {info.label}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove("up")} disabled={index === 0} className="text-ink-4 hover:text-ink disabled:opacity-30">
            <ArrowUp size={13} />
          </button>
          <button
            onClick={() => onMove("down")}
            disabled={index === total - 1}
            className="text-ink-4 hover:text-ink disabled:opacity-30"
          >
            <ArrowDown size={13} />
          </button>
          <button onClick={onRemove} className="ml-1 text-ink-4 hover:text-red">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {block.type === "text" && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onPatch({ content: text })}
          rows={3}
          placeholder="Votre texte…"
          className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
        />
      )}

      {block.type === "date" && <p className="text-xs italic text-ink-4">Affiche automatiquement la date/heure de l&rsquo;événement, en gras.</p>}

      {(block.type === "image" || block.type === "banner") && (
        <ImageUploadBox
          url={block.url || null}
          onUpload={(file) => uploadAsset(block.type as "image" | "banner", file)}
          onClear={() => onPatch({ url: "" })}
        />
      )}

      {block.type === "map" && (
        <div className="space-y-2">
          <input
            defaultValue={block.label}
            onBlur={(e) => onPatch({ label: e.target.value })}
            placeholder="Ex. Parking 3"
            className="w-full rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none"
          />
          <input
            defaultValue={block.address}
            onBlur={(e) => onPatch({ address: e.target.value })}
            placeholder="Adresse (pour la carte)"
            className="w-full rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none"
          />
        </div>
      )}

      {block.type === "video" &&
        (block.url ? (
          <div className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs text-ink-2">
              <Video size={13} /> Vidéo importée
            </span>
            <button onClick={() => onPatch({ url: "" })} className="text-ink-4 hover:text-red">
              <X size={12} />
            </button>
          </div>
        ) : (
          <label className="flex h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-btn border border-dashed border-line text-xs font-semibold text-ink-3 hover:bg-hover">
            <Upload size={14} /> {busy ? "Envoi…" : "Importer une vidéo"}
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadAsset("video", e.target.files[0])}
            />
          </label>
        ))}

      {block.type === "pdf" &&
        (block.url ? (
          <div className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
            <span className="flex items-center gap-1.5 truncate text-xs text-ink-2">
              <FileText size={13} /> {block.filename || "Document"}
            </span>
            <button onClick={() => onPatch({ url: "", filename: "" })} className="text-ink-4 hover:text-red">
              <X size={12} />
            </button>
          </div>
        ) : (
          <label className="flex h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-btn border border-dashed border-line text-xs font-semibold text-ink-3 hover:bg-hover">
            <Upload size={14} /> {busy ? "Envoi…" : "Importer un PDF"}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadAsset("pdf", e.target.files[0])}
            />
          </label>
        ))}

      {block.type === "signature" && (
        <div className="space-y-2">
          <input
            defaultValue={block.name}
            onBlur={(e) => onPatch({ name: e.target.value })}
            placeholder="Nom (ex. Jean Dupont)"
            className="w-full rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none"
          />
          <input
            defaultValue={block.title}
            onBlur={(e) => onPatch({ title: e.target.value })}
            placeholder="Fonction (ex. Président de la LGEF)"
            className="w-full rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none"
          />
          <ImageUploadBox
            url={block.imageUrl}
            onUpload={(file) => uploadAsset("signature", file)}
            onClear={() => onPatch({ imageUrl: null })}
          />
        </div>
      )}

      {block.type === "buttons" && (
        <p className="text-xs italic text-ink-4">« ✓ Je participe » / « Je n&rsquo;y participerai pas ».</p>
      )}
    </div>
  );
}

function CampaignEditor({ ev, onBack }: { ev: RegistrationEvent; onBack: () => void }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; email: string | null; club: string | null }[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualClub, setManualClub] = useState("");

  const refetch = async (c: Campaign) => {
    setRecipients(await listCampaignRecipients(c.id));
  };

  const refetchCampaign = async () => {
    const c = await getOrCreateCampaign(ev.id);
    setCampaign(c);
  };

  useEffect(() => {
    (async () => {
      const c = await getOrCreateCampaign(ev.id);
      setCampaign(c);
      setSubject(c.subject || `Invitation — ${ev.title}`);
      await refetch(c);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev.id]);

  if (!campaign) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;

  const blocks = ((campaign.blocks as unknown as EmailBlock[]) ?? []);

  const saveSubject = async () => {
    setSaving(true);
    try {
      await updateCampaign(campaign.id, { subject });
    } finally {
      setSaving(false);
    }
  };

  const addBlock = async (type: EmailBlock["type"]) => {
    setAddMenuOpen(false);
    await addCampaignBlock(campaign.id, newBlock(type));
    await refetchCampaign();
  };

  const runSearch = async () => {
    if (!query.trim()) return setResults([]);
    setResults(await searchClubContacts(query.trim()));
  };

  const addContact = async (c: { id: string; name: string; email: string | null; club: string | null }) => {
    if (!c.email) return;
    await addRecipientsFromContacts(campaign.id, [{ id: c.id, name: c.name, email: c.email, club: c.club }]);
    await refetch(campaign);
    setResults((prev) => prev.filter((r) => r.id !== c.id));
  };

  const addManual = async () => {
    if (!manualName.trim() || !manualEmail.trim()) return;
    await addManualRecipient(campaign.id, { name: manualName.trim(), email: manualEmail.trim(), club: manualClub.trim() });
    await refetch(campaign);
    setManualName("");
    setManualEmail("");
    setManualClub("");
  };

  const send = async () => {
    if (!confirm(`Envoyer l'invitation par email à ${recipients.filter((r) => !r.sent_at).length} destinataire(s) ?`)) return;
    setSending(true);
    setSendResult(null);
    try {
      await saveSubject();
      const { sent } = await sendCampaign(campaign.id);
      setSendResult(`${sent} email(s) envoyé(s).`);
      await refetch(campaign);
    } catch (e) {
      setSendResult(e instanceof Error ? e.message : "Échec de l'envoi.");
    } finally {
      setSending(false);
    }
  };

  const publicUrl = `${siteOrigin()}/inscription/${ev.id}/public/${campaign.public_token}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(publicUrl)}`;

  const yesCount = recipients.filter((r) => r.response === "yes").length;
  const noCount = recipients.filter((r) => r.response === "no").length;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <button onClick={onBack} className="flex w-fit items-center gap-1.5 text-xs font-semibold text-ink-3 hover:text-ink">
        <ArrowLeft size={13} /> Retour aux événements
      </button>

      <div>
        <h2 className="text-lg font-extrabold text-ink">{ev.title}</h2>
        <p className="text-xs text-ink-4">{format(new Date(ev.start_date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Colonne email — bâti à la carte, dans l'ordre choisi */}
        <div className="space-y-3 rounded-panel border border-line bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Contenu du mail</div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={saveSubject}
            placeholder="Objet"
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
          {saving && <p className="text-[10px] text-ink-4">Enregistrement…</p>}

          <div className="space-y-2">
            {blocks.length === 0 && (
              <p className="rounded-btn border border-dashed border-line p-4 text-center text-xs italic text-ink-4">
                Ajoute des blocs ci-dessous — texte, image, date, bannière, carte, vidéo… dans l&rsquo;ordre que tu veux.
              </p>
            )}
            {blocks.map((b, i) => (
              <BlockEditor
                key={b.id}
                block={b}
                campaignId={campaign.id}
                index={i}
                total={blocks.length}
                onMove={async (direction) => {
                  await moveCampaignBlock(campaign.id, b.id, direction);
                  await refetchCampaign();
                }}
                onRemove={async () => {
                  await removeCampaignBlock(campaign.id, b.id);
                  await refetchCampaign();
                }}
                onPatch={async (patch) => {
                  await updateCampaignBlockContent(campaign.id, b.id, patch);
                  await refetchCampaign();
                }}
                onRefetch={refetchCampaign}
              />
            ))}
          </div>

          <div className="relative">
            <button
              onClick={() => setAddMenuOpen((o) => !o)}
              className="flex w-full items-center justify-center gap-1.5 rounded-btn border border-dashed border-line py-2 text-xs font-semibold text-ink-3 hover:bg-hover"
            >
              <Plus size={13} /> Ajouter un bloc
            </button>
            {addMenuOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-btn border border-line bg-card p-1 shadow-card">
                {BLOCK_TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.type}
                      onClick={() => addBlock(t.type)}
                      className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-xs font-semibold text-ink-2 hover:bg-hover"
                    >
                      <Icon size={13} /> {t.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-line pt-3">
            <button
              onClick={send}
              disabled={sending || recipients.filter((r) => !r.sent_at).length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-btn bg-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              <Send size={14} /> {sending ? "Envoi…" : `Envoyer aux clubs (${recipients.filter((r) => !r.sent_at).length})`}
            </button>
            {sendResult && <p className="mt-2 text-xs font-semibold text-ink-2">{sendResult}</p>}
          </div>
        </div>

        {/* Colonne lien générique */}
        <div className="space-y-3 rounded-panel border border-line bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Lien / QR code générique</div>
          <p className="text-xs text-ink-4">
            À copier-coller ou afficher en QR code — n&rsquo;importe qui peut répondre en s&rsquo;identifiant lui-même.
          </p>
          <div className="flex items-center gap-2 rounded-btn border border-line px-3 py-2">
            <LinkIcon size={13} className="shrink-0 text-ink-4" />
            <input readOnly value={publicUrl} className="w-full truncate text-xs text-ink-3 outline-none" />
            <button
              onClick={() => navigator.clipboard.writeText(publicUrl)}
              className="shrink-0 text-xs font-semibold text-link hover:underline"
            >
              Copier
            </button>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-btn border border-dashed border-line p-4">
            <QrCode size={14} className="text-ink-4" />
            {/* eslint-disable-next-line @next/next/no-img-element -- image externe générée à la volée, pas un asset statique */}
            <img src={qrSrc} alt="QR code d'inscription" className="h-[140px] w-[140px]" />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 rounded-btn bg-subtle p-3 text-center">
            <div>
              <div className="text-lg font-extrabold text-good">{yesCount}</div>
              <div className="text-[10px] text-ink-4">Participent</div>
            </div>
            <div>
              <div className="text-lg font-extrabold text-ink-3">{noCount}</div>
              <div className="text-[10px] text-ink-4">Ne participent pas</div>
            </div>
          </div>
        </div>
      </div>

      {/* Destinataires */}
      <div className="rounded-panel border border-line bg-card p-4">
        <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Destinataires</div>

        <div className="mb-3 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-btn border border-line px-3 py-2">
            <Search size={13} className="text-ink-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Rechercher un club dans l'annuaire…"
              className="w-full text-sm outline-none"
            />
          </div>
          <button onClick={runSearch} className="rounded-btn border border-line px-3 py-2 text-xs font-semibold text-ink-2">
            Chercher
          </button>
        </div>
        {results.length > 0 && (
          <div className="mb-3 max-h-40 space-y-1 overflow-y-auto rounded-btn border border-line p-2">
            {results.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-btn px-2 py-1.5 hover:bg-hover">
                <span className="text-xs text-ink-2">
                  {r.name} {r.club ? `· ${r.club}` : ""} · {r.email}
                </span>
                <button onClick={() => addContact(r)} className="text-xs font-semibold text-link hover:underline">
                  Ajouter
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Nom" className="rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none" />
          <input value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="Email" className="rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none" />
          <input value={manualClub} onChange={(e) => setManualClub(e.target.value)} placeholder="Club (optionnel)" className="rounded-btn border border-line px-2.5 py-1.5 text-xs outline-none" />
          <button onClick={addManual} className="flex items-center gap-1 rounded-btn border border-dashed border-line px-2.5 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover">
            <Plus size={12} /> Ajouter manuellement
          </button>
        </div>

        <div className="divide-y divide-line rounded-btn border border-line">
          {recipients.length === 0 && <p className="p-3 text-xs italic text-ink-4">Aucun destinataire pour l&rsquo;instant.</p>}
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2">
              <Mail size={13} className="shrink-0 text-ink-4" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                {r.name} {r.club ? `· ${r.club}` : ""} · {r.email}
              </span>
              {r.response === "yes" && (
                <span className="flex items-center gap-1 rounded-full bg-good-bg px-2 py-0.5 text-[10px] font-bold text-good">
                  <Check size={10} /> Participe
                </span>
              )}
              {r.response === "no" && (
                <span className="flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[10px] font-bold text-ink-3">
                  <X size={10} /> Ne participe pas
                </span>
              )}
              {!r.response && r.sent_at && <span className="text-[10px] text-ink-4">Envoyé, sans réponse</span>}
              {!r.sent_at && <span className="text-[10px] text-ink-4">Pas encore envoyé</span>}
              <button
                onClick={async () => {
                  await removeRecipient(r.id);
                  await refetch(campaign);
                }}
                className="shrink-0 text-ink-4 hover:text-red"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function InscriptionScreen() {
  const role = useUserRole();
  const [events, setEvents] = useState<RegistrationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RegistrationEvent | null>(null);

  const canAccess = role.isAdmin || role.isSuperUser || role.isTechSalarie;

  useEffect(() => {
    if (!canAccess) return;
    listRegistrationEvents().then((evs) => {
      setEvents(evs);
      setLoading(false);
    });
  }, [canAccess]);

  if (role.loading) return null;
  if (!canAccess) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-ink-4">
        Réservé au réseau salarié et aux administrateurs.
      </div>
    );
  }

  if (selected) return <CampaignEditor ev={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h2 className="text-lg font-extrabold text-ink">Inscriptions</h2>
      <p className="text-xs text-ink-4">
        Événements du calendrier avec les inscriptions activées — active « Inscriptions » depuis la modal d&rsquo;un
        événement pour qu&rsquo;il apparaisse ici.
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-panel border border-line bg-card">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-4">Chargement…</div>
        ) : events.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-4">
            Aucun événement avec inscriptions activées.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {events.map((ev) => (
              <button
                key={ev.id}
                onClick={() => setSelected(ev)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{ev.title}</span>
                  <span className="block text-xs text-ink-4">
                    {format(new Date(ev.start_date), "d MMMM yyyy", { locale: fr })}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    ev.campaignStatus === "sent" ? "bg-good-bg text-good" : "bg-subtle text-ink-3"
                  }`}
                >
                  {ev.campaignStatus === "sent" ? "Envoyée" : "Brouillon"}
                </span>
                {ev.totalRecipients > 0 && (
                  <span className="shrink-0 text-xs text-ink-4">
                    {ev.yesCount} oui · {ev.noCount} non
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
