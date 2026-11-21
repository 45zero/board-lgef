"use client";

import { useEffect, useRef, useState } from "react";
import {
  UserPlus,
  Navigation,
  Video,
  Crown,
  X,
  Bell,
  ChevronDown,
  Check,
  Paperclip,
  Image as ImageIcon,
  Download,
  Trash2,
  Upload,
  Share2,
  FolderPlus,
} from "lucide-react";
import { YoutubeIcon, FacebookIcon, InstagramIcon } from "@/components/board/publication/BrandIcons";
import { ExpenseLinesEditor } from "@/components/board/expenses/ExpenseLinesEditor";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { type OrgKey } from "@/lib/board/tokens";
import { StaffEventsMap } from "@/components/board/calendar/StaffEventsMap";
import { useEventTeam } from "@/hooks/board/useEventTeam";
import { useEventComments } from "@/hooks/board/useEventComments";
import { EventChat } from "@/components/board/discussions/EventChat";
import { useEventFiles } from "@/hooks/board/useEventFiles";
import { openEventFile, getEventFileViewUrl, type EventFile } from "@/lib/board/eventFiles";
import { FileViewer } from "@/components/board/FileViewer";
import { FolderBlock, downloadSequentially, folderSummary } from "@/components/board/FolderBlock";
import { groupByFolder, pickedFromDrop, pickedFromInput } from "@/lib/board/folderPick";
import { ensureFilePublication, getMediaPublication, type MediaPublication } from "@/lib/board/mediaPublications";
import dynamic from "next/dynamic";
import { getPublishedForFile, detachFileFromPublications } from "@/app/actions/social";
import { eventPublicationAssignees } from "@/app/actions/publication-assignee";
import { AssigneePicker } from "@/components/board/publication/AssigneePicker";
import { describeFailures, getNetworkEntry, networkLabel, networkUrl, NETWORK_KEYS, type NetworkKey } from "@/lib/social/targets";
import { REMINDER_PRESETS } from "@/hooks/board/useEventModalState";
import { EventCosts } from "@/components/board/calendar/EventCosts";

export function personName(
  p: { first_name: string | null; last_name: string | null; email: string | null } | null
) {
  if (!p) return "—";
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name || p.email || "—";
}

export function personInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_PALETTE = [
  { bg: "#0B1D3C", ink: "#FFFFFF" },
  { bg: "#0F766E", ink: "#FFFFFF" },
  { bg: "#B91C1C", ink: "#FFFFFF" },
  { bg: "#7A3FD9", ink: "#FFFFFF" },
  { bg: "#B45309", ink: "#FFFFFF" },
  { bg: "#334155", ink: "#FFFFFF" },
];

function avatarColorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export interface ParticipantChip {
  id: string;
  name: string;
  role: "responsable" | "membre";
}

/** Un participant : avatar coloré + initiales, couronne si responsable. */
function ParticipantAvatar({ p }: { p: ParticipantChip }) {
  const color = avatarColorFor(p.id);
  return (
    <span
      className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
      style={{ background: color.bg, color: color.ink }}
      title={p.name}
    >
      {personInitials(p.name)}
      {p.role === "responsable" && (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-card ring-1 ring-line">
          <Crown size={9} className="text-amber" />
        </span>
      )}
    </span>
  );
}

/**
 * Bloc "Participants" façon capture (avatars + recherche), branché soit sur
 * useEventTeam (édition, event_team_members réel), soit sur une liste locale
 * (création, event pas encore créé — cf. pendingParticipants de useEventModalState).
 */
export function ParticipantsField({
  members,
  canManage,
  onAdd,
  onRemove,
  onSetResponsable,
}: {
  members: ParticipantChip[];
  canManage: boolean;
  onAdd: (profile: ProfileOption) => void;
  onRemove: (member: ParticipantChip) => void;
  onSetResponsable: (member: ParticipantChip) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProfileOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id, first_name, last_name, email")
      .order("first_name")
      .limit(200)
      .then(({ data }) => setOptions((data as ProfileOption[] | null) ?? []));
  }, [canManage]);

  const memberIds = new Set(members.map((m) => m.id));
  const filtered = query.trim()
    ? options.filter((o) => !memberIds.has(o.id) && personName(o).toLowerCase().includes(query.toLowerCase()))
    : [];

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line px-3 py-2">
        {members.map((m) => (
          <span key={m.id} className="group relative flex items-center gap-1.5 rounded-full bg-subtle py-1 pl-1 pr-2">
            <button
              type="button"
              onClick={() => canManage && onSetResponsable(m)}
              disabled={!canManage}
              title={m.role === "responsable" ? "Responsable" : "Définir comme responsable"}
              className="disabled:cursor-default"
            >
              <ParticipantAvatar p={m} />
            </button>
            <span className="text-xs text-ink-2">{m.name}</span>
            {canManage && (
              <button
                type="button"
                onClick={() => onRemove(m)}
                className="text-ink-4 hover:text-red"
                aria-label={`Retirer ${m.name}`}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}

        {canManage && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Ajouter des participants…"
            className="min-w-[140px] flex-1 text-sm outline-none"
          />
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 top-full z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-btn border border-line bg-card p-1 shadow-card">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onAdd(p);
                setQuery("");
                setOpen(false);
              }}
              className="block w-full rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover"
            >
              {personName(p)}
            </button>
          ))}
          {filtered.length === 0 && <div className="px-2 py-1.5 text-xs text-ink-4">Aucun résultat.</div>}
        </div>
      )}
    </div>
  );
}

/** Sélecteur de rappels compact (pill + menu multi-select) — même liste de préréglages pour la création et l'édition. */
export function RemindersField({
  offsets,
  onAdd,
  onRemove,
}: {
  offsets: string[];
  onAdd: (offset: string) => void;
  onRemove: (offset: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    offsets.length === 0
      ? "Rappel"
      : offsets.length === 1
        ? `Rappel · ${REMINDER_PRESETS.find((p) => p.value === offsets[0])?.label ?? offsets[0]}`
        : `Rappels (${offsets.length})`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2 outline-none hover:bg-hover"
      >
        <span className="flex items-center gap-1.5 truncate">
          <Bell size={13} className="shrink-0 text-ink-4" />
          {label}
        </span>
        <ChevronDown size={12} className="shrink-0 text-ink-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-btn border border-line bg-card p-1 shadow-card">
          {REMINDER_PRESETS.map((p) => {
            const active = offsets.includes(p.value);
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => (active ? onRemove(p.value) : onAdd(p.value))}
                className={`flex w-full items-center justify-between rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover ${
                  active ? "font-semibold text-ink" : "text-ink-2"
                }`}
              >
                {p.label}
                {active && <Check size={13} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Discussion de l'événement : conversation façon Messenger (réponses, réactions, photos et
 * fichiers, vocaux, mentions @ notifiées) — la même que dans la bulle « Discussions ».
 */
export function DiscussionTab({ hook }: { hook: ReturnType<typeof useEventComments> }) {
  return (
    <div className="-mx-1 flex h-[min(62dvh,600px)] flex-col overflow-hidden rounded-btn border border-line bg-card">
      <EventChat source={{ kind: "event", id: hook.eventId }} />
    </div>
  );
}

interface ProfileOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export function EquipeTab({ hook }: { hook: ReturnType<typeof useEventTeam> }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProfileOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!pickerOpen) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id, first_name, last_name, email")
      .order("first_name")
      .limit(200)
      .then(({ data }) => setOptions((data as ProfileOption[] | null) ?? []));
  }, [pickerOpen]);

  const filtered = options.filter((o) => personName(o).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-3">
      {hook.team.map((m) => (
        <div key={m.id} className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
          <div className="text-sm text-ink-2">
            {personName(m.profiles)}
            {m.role === "responsable" && <span className="ml-1 text-xs text-ink-4">(responsable)</span>}
          </div>
          {hook.canManageMembers && (
            <button onClick={() => hook.removeMember(m)} className="text-xs font-semibold text-red hover:underline">
              Retirer
            </button>
          )}
        </div>
      ))}

      {hook.canManageMembers && (
        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-btn border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-hover"
          >
            <UserPlus size={13} /> Ajouter
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded-btn border border-line bg-card p-2 shadow-card">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher…"
                className="mb-2 w-full rounded-btn border border-line px-2 py-1.5 text-sm outline-none"
              />
              <div className="max-h-56 overflow-y-auto">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={async () => {
                      await hook.addMember(p.id, "membre");
                      setPickerOpen(false);
                      setQuery("");
                    }}
                    className="block w-full rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover"
                  >
                    {personName(p)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Onglet Frais de la fiche événement : mes lignes (avec justificatifs lus par Claude) et ma déclaration. */
export function FraisTab({ eventId, onDeclared }: { eventId?: string; onDeclared?: () => void }) {
  if (!eventId) return <p className="text-sm text-ink-4">Enregistrez l&rsquo;événement pour saisir des frais.</p>;
  return <ExpenseLinesEditor target={{ eventId }} onChanged={onDeclared} />;
}

/** Onglet Gestion frais : coût des intervenants, pour leur N+1 et les administrateurs. */
export function GestionFraisTab({ eventId }: { eventId: string | null }) {
  const note = (text: string) => (
    <div className="rounded-panel border border-dashed border-line bg-card/60 p-6 text-sm text-ink-3">{text}</div>
  );
  if (!eventId) return note("Enregistrez l\u2019événement pour voir le coût des intervenants.");
  return <EventCosts eventId={eventId} empty={note("Aucun coût d\u2019intervenant à gérer pour vous sur cet événement.")} />;
}

/** Onglet Carte : l'événement sur la carte du Grand Est, avec les techniciens et leurs temps de route. */
export function CarteTab({
  location,
  event,
}: {
  location: string;
  event?: { id: string; title: string; org: OrgKey; start: string } | null;
}) {
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location)}`;
  return (
    <div className="space-y-3">
      {event && location ? (
        <StaffEventsMap events={[{ ...event, location }]} focusEventId={event.id} className="h-[420px]" />
      ) : (
        <div className="flex h-[160px] items-center justify-center rounded-panel border border-dashed border-line bg-subtle text-sm text-ink-4">
          {event ? "Renseignez un lieu pour afficher la carte." : "Enregistrez l'événement pour afficher la carte."}
        </div>
      )}
      <div className="text-sm text-ink-2">{location || "Aucune adresse renseignée."}</div>
      {location && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-hover"
        >
          <Navigation size={13} /> Itinéraire
        </a>
      )}
    </div>
  );
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const FACEBOOK_REGIONS: { key: "lorraine" | "champagne_ardenne" | "alsace"; label: string }[] = [
  { key: "lorraine", label: "Lorraine" },
  { key: "champagne_ardenne", label: "Champagne-Ardenne" },
  { key: "alsace", label: "Alsace" },
];

// Compositeur du centre de publication, chargé à la demande (l'écran du centre importe ce fichier).
const PublicationComposer = dynamic(() => import("@/components/board/screens/PublicationScreen").then((m) => m.Composer), { ssr: false });

/** « 26/09/2026 à 21:10 » — date et heure d'un ajout ou d'une publication. */
function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Partage le lien public d'une publication : feuille de partage native (mobile), sinon copie du lien. */
async function shareLink(url: string, title: string) {
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return;
    }
  } catch {
    return; // partage annulé par l'utilisateur
  }
  await navigator.clipboard.writeText(url);
  alert("Lien de la publication copié.");
}

/**
 * Réseaux où le média est publié : cliquer sur le logo (ou la ligne) ouvre la publication sur le
 * réseau, l'icône de partage donne directement son lien.
 */
function PublishBadges({ file }: { file: EventFile }) {
  const info = file.publish_info;
  const rows = NETWORK_KEYS.map((key) => ({ key, entry: getNetworkEntry(info, key) })).filter((r) => r.entry?.published);
  if (rows.length === 0) return null;

  const byName = (by?: { first_name: string | null; last_name: string | null } | null) =>
    [by?.first_name, by?.last_name].filter(Boolean).join(" ") || "—";

  return (
    <div className="mt-1 space-y-0.5">
      {rows.map(({ key, entry }) => {
        const url = networkUrl(key, entry);
        const color = key === "youtube" ? "text-red" : key === "instagram" ? "text-ink-2" : "text-link";
        const label =
          key === "youtube" ? "YouTube" : key === "instagram" ? "Instagram · @lgefofficiel" : `Facebook · ${FACEBOOK_REGIONS.find((r) => r.key === key)?.label ?? ""}`;
        const Logo = key === "youtube" ? YoutubeIcon : key === "instagram" ? InstagramIcon : FacebookIcon;
        return (
          <div key={key} className={`flex items-center gap-1.5 text-[11px] font-semibold ${color}`}>
            <a
              href={url ?? undefined}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={url ? "Ouvrir la publication" : "Lien pas encore disponible — rafraîchissez les stats"}
              className={`flex min-w-0 items-center gap-1.5 ${url ? "hover:underline" : "cursor-default"}`}
            >
              <Logo size={key === "youtube" ? 13 : 12} />
              <span className="truncate">
                {label} · publié par {byName(entry!.by)} le {formatDateTime(entry!.at)}
              </span>
            </a>
            {url && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void shareLink(url, file.filename);
                }}
                title="Lien de partage"
                className="shrink-0 rounded-full p-0.5 text-ink-4 hover:bg-hover hover:text-ink"
              >
                <Share2 size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Confirmation de suppression d'une pièce jointe. Si le média est en ligne, propose (coché par
 * défaut) de le supprimer aussi des réseaux ; il disparaît dans tous les cas du centre de
 * publication (cascade en base).
 */
function DeleteFileDialog({
  file,
  networks,
  onClose,
  onConfirm,
}: {
  file: EventFile;
  networks: NetworkKey[];
  onClose: () => void;
  onConfirm: (fromNetworks: boolean) => Promise<void>;
}) {
  const [fromNetworks, setFromNetworks] = useState(true);
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-modal border border-line bg-card p-5 shadow-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-ink">Supprimer « {file.filename} » ?</h3>
        <p className="text-xs text-ink-3">
          Le fichier sera retiré de l&rsquo;événement et du centre de publication.
        </p>
        {networks.length > 0 && (
          <div className="space-y-2 rounded-btn border border-line p-3">
            <p className="text-xs font-semibold text-ink-2">Ce média est en ligne sur :</p>
            <ul className="space-y-0.5 text-xs text-ink-3">
              {networks.map((k) => (
                <li key={k}>• {networkLabel(k)}</li>
              ))}
            </ul>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
              <input type="checkbox" checked={fromNetworks} onChange={(e) => setFromNetworks(e.target.checked)} />
              Supprimer aussi des réseaux (irréversible)
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm text-ink-2">
            Annuler
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(networks.length > 0 && fromNetworks);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-btn bg-red px-4 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-50"
          >
            {busy ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttachmentRow({
  file,
  canManage,
  canPublish,
  onRemove,
  onPublishClick,
  assignment,
}: {
  file: EventFile;
  canManage: boolean;
  canPublish: boolean;
  onRemove: () => void;
  onPublishClick: () => void;
  /** Publication pas encore publiée de la vidéo et sa personne attribuée (« À publier par »). */
  assignment?: { pubId: string; assignedTo: string | null };
}) {
  const isVideo = (file.content_type ?? "").startsWith("video");
  const isImage = (file.content_type ?? "").startsWith("image");
  const isDrive = file.storage_provider === "drive";
  const uploader = personName(file.uploaded_by_profile);

  const [viewing, setViewing] = useState(false);
  const open = (download: boolean) => (download ? openEventFile(file, true) : setViewing(true));

  return (
    <div className="rounded-btn border border-line px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => open(false)} className="flex min-w-0 items-start gap-2 text-left">
          {isVideo ? (
            <Video size={15} className="mt-0.5 shrink-0 text-ink-4" />
          ) : isImage ? (
            <ImageIcon size={15} className="mt-0.5 shrink-0 text-ink-4" />
          ) : (
            <Paperclip size={15} className="mt-0.5 shrink-0 text-ink-4" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{file.filename}</span>
            <span className="block text-[11px] text-ink-4">
              {formatFileSize(file.size_bytes)} · ajouté par {uploader} le {formatDateTime(file.created_at)}
              {file.drive_purged_at ? (
                <span className="ml-1.5 rounded-full bg-subtle px-1.5 py-0.5 font-semibold text-ink-3" title="Retiré du Drive 7 jours après sa publication : il reste en ligne sur les réseaux">
                  Retiré du Drive · en ligne sur les réseaux
                </span>
              ) : (
                isDrive && <span className="ml-1.5 rounded-full bg-subtle px-1.5 py-0.5 font-semibold text-ink-3">Drive</span>
              )}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {isVideo && canPublish && (
            <button type="button" onClick={onPublishClick} className="text-ink-4 hover:text-navy" title="Publier">
              <Upload size={13} />
            </button>
          )}
          <button type="button" onClick={() => open(true)} className="text-ink-4 hover:text-ink" title="Télécharger">
            <Download size={13} />
          </button>
          {canManage && (
            <button type="button" onClick={onRemove} className="text-ink-4 hover:text-red" title="Supprimer">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {/* Hors du bouton d'ouverture : liens et bouton de partage ne peuvent pas être imbriqués dans un <button>. */}
      <div className="pl-[23px]">
        {isVideo && assignment && (canPublish || canManage) && (
          <AssigneePicker pubId={assignment.pubId} value={assignment.assignedTo} className="mt-1" />
        )}
        <PublishBadges file={file} />
      </div>
      {viewing && (
        <FileViewer
          name={file.filename}
          contentType={file.content_type}
          getUrl={(downloadAs) => getEventFileViewUrl(file, downloadAs)}
          onClose={() => setViewing(false)}
        />
      )}
    </div>
  );
}

const isMediaFile = (f: EventFile) => /^(image|video)\//.test(f.content_type ?? "");

/**
 * Pièces jointes de l'événement — documents (joints seulement) et médias (photos/vidéos, mis en file
 * « À publier » par un trigger sur event_files) — + publication YouTube/Facebook. Disponible après
 * création de l'événement.
 */
export function AttachmentsField({
  eventId,
  canManage,
  canUpload = canManage,
  canPublish,
}: {
  eventId: string;
  eventTitle: string;
  canManage: boolean;
  /** Peut ajouter des fichiers (prestataires, équipe) ; ne retire que les siens. */
  canUpload?: boolean;
  canPublish: boolean;
}) {
  const { user } = useAuth();
  const hook = useEventFiles(eventId, canManage, canUpload);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // Dossier visé par « + » sur un dossier : les fichiers choisis y sont rangés.
  const targetFolder = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const canAdd = canManage || canUpload;
  const { folders, loose } = groupByFolder(hook.files, (f) => f.folder);
  // Publier un média : même compositeur que le centre de publication (réseaux, publier ou programmer).
  const [composerPub, setComposerPub] = useState<MediaPublication | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openComposer = async (file: EventFile) => {
    setOpeningId(file.id);
    try {
      const pub = await getMediaPublication(await ensureFilePublication(file));
      if (!pub) throw new Error("Publication introuvable.");
      setComposerPub(pub);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Impossible d'ouvrir la publication.");
    } finally {
      setOpeningId(null);
    }
  };
  const [removing, setRemoving] = useState<{ file: EventFile; networks: NetworkKey[] } | null>(null);
  // « À publier par » des vidéos : publication pas encore publiée de chaque fichier (rechargée à chaque ajout / retrait).
  const [assignments, setAssignments] = useState<Map<string, { pubId: string; assignedTo: string | null }>>(new Map());
  const fileCount = hook.files.length;
  useEffect(() => {
    let cancelled = false;
    void eventPublicationAssignees(eventId)
      .then((res) => {
        if (cancelled || !res.ok) return;
        const next = new Map<string, { pubId: string; assignedTo: string | null }>();
        for (const p of res.data) for (const id of p.fileIds) next.set(id, { pubId: p.pubId, assignedTo: p.assignedTo });
        setAssignments(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [eventId, fileCount]);

  const askRemove = async (file: EventFile) => {
    const published = await getPublishedForFile(file.id).catch(() => []);
    setRemoving({ file, networks: [...new Set(published.flatMap((p) => p.networks))] });
  };

  return (
    <div
      onDragOver={(e) => {
        if (!canAdd || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!canAdd || (!e.dataTransfer.items?.length && !e.dataTransfer.files.length)) return;
        e.preventDefault();
        setDragOver(false);
        void pickedFromDrop(e.dataTransfer).then((picked) => picked.length && hook.addFiles(picked));
      }}
      className={`space-y-2 rounded-btn ${dragOver ? "bg-sel-bg outline-dashed outline-2 outline-offset-4 outline-navy/40" : ""}`}
    >
      {hook.files.length === 0 && !hook.loading && (
        <p className="text-xs italic text-ink-4">Aucune pièce jointe pour l&rsquo;instant.</p>
      )}
      {/* Dossiers déposés : une ligne chacun, qu'on ouvre. Les photos/vidéos qu'ils contiennent partent
          quand même une par une dans « À publier » (déclencheur sur event_files). */}
      {folders.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-4">
            Dossiers · {folders.length}
            <span className="ml-1 font-normal normal-case tracking-normal">— photos et vidéos envoyées une par une au centre de publication</span>
          </p>
          {folders.map((g) => (
            <FolderBlock
              key={g.name}
              name={g.name}
              count={g.files.length}
              summary={folderSummary(g.files.map((f) => f.content_type))}
              onAdd={
                canAdd
                  ? () => {
                      targetFolder.current = g.name;
                      inputRef.current?.click();
                    }
                  : undefined
              }
              onDownloadAll={() => downloadSequentially(g.files.filter((f) => !f.drive_purged_at), (f) => openEventFile(f, true))}
            >
              {g.files.map((f) => (
                <AttachmentRow
                  key={f.id}
                  file={f}
                  canManage={canManage || (canUpload && f.uploaded_by === user?.id)}
                  canPublish={canPublish}
                  onRemove={() => askRemove(f)}
                  onPublishClick={() => openingId !== f.id && void openComposer(f)}
                  assignment={assignments.get(f.id)}
                />
              ))}
            </FolderBlock>
          ))}
        </div>
      )}
      {/* Documents : joints à l'événement seulement. Médias : rejoignent aussi « À publier » du centre. */}
      {[
        { title: "Documents", files: loose.filter((f) => !isMediaFile(f)), hint: null },
        { title: "Médias", files: loose.filter(isMediaFile), hint: "envoyés au centre de publication" },
      ]
        .filter((g) => g.files.length > 0)
        .map((g) => (
          <div key={g.title} className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-4">
              {g.title} · {g.files.length}
              {g.hint && <span className="ml-1 font-normal normal-case tracking-normal">— {g.hint}</span>}
            </p>
            {g.files.map((f) => (
              <AttachmentRow
                key={f.id}
                file={f}
                canManage={canManage || (canUpload && f.uploaded_by === user?.id)}
                canPublish={canPublish}
                onRemove={() => askRemove(f)}
                onPublishClick={() => openingId !== f.id && void openComposer(f)}
                assignment={assignments.get(f.id)}
              />
            ))}
          </div>
        ))}

      {canAdd && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              // Envoi en tâche de fond : progression en bas à droite, on peut fermer l'événement.
              const folder = targetFolder.current;
              targetFolder.current = null;
              if (e.target.files?.length) hook.addFiles(pickedFromInput(e.target.files).map((p) => ({ ...p, folder })));
              e.target.value = "";
            }}
          />
          <input
            ref={(el) => {
              folderInputRef.current = el;
              el?.setAttribute("webkitdirectory", "");
            }}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) hook.addFiles(pickedFromInput(e.target.files));
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                targetFolder.current = null;
                inputRef.current?.click();
              }}
              className="flex items-center gap-1.5 rounded-btn border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-hover"
            >
              <Paperclip size={13} /> Ajouter un document, une photo ou une vidéo
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-btn border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-hover"
            >
              <FolderPlus size={13} /> Ajouter un dossier
            </button>
            <span className="text-[10px] text-ink-4">ou glissez-déposez fichiers et dossiers ici</span>
          </div>
          {hook.uploading && (
            <p className="text-[11px] text-ink-4">
              Envoi en cours en arrière-plan (voir en bas à droite) — vous pouvez fermer l&rsquo;événement et continuer à travailler.
            </p>
          )}
        </>
      )}

      {removing && (
        <DeleteFileDialog
          file={removing.file}
          networks={removing.networks}
          onClose={() => setRemoving(null)}
          onConfirm={async (fromNetworks) => {
            const results = await detachFileFromPublications(removing.file.id, fromNetworks);
            const failures = describeFailures(results);
            if (failures) alert(`Certaines publications n'ont pas pu être supprimées des réseaux :\n\n${failures}`);
            await hook.removeFile(removing.file);
            setRemoving(null);
          }}
        />
      )}

      {composerPub && <PublicationComposer pub={composerPub} onClose={() => setComposerPub(null)} onDone={() => setComposerPub(null)} />}
    </div>
  );
}
