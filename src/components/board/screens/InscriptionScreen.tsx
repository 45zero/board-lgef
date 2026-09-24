"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowLeft, Check, X, Send, Link as LinkIcon, QrCode, Plus, Search, Trash2, Mail } from "lucide-react";
import { useUserRole } from "@/hooks/board/useUserRole";
import {
  listRegistrationEvents,
  getOrCreateCampaign,
  updateCampaign,
  listCampaignRecipients,
  searchClubContacts,
  addRecipientsFromContacts,
  addManualRecipient,
  removeRecipient,
  sendCampaign,
} from "@/app/actions/registration";

type RegistrationEvent = Awaited<ReturnType<typeof listRegistrationEvents>>[number];
type Campaign = Awaited<ReturnType<typeof getOrCreateCampaign>>;
type Recipient = Awaited<ReturnType<typeof listCampaignRecipients>>[number];

function siteOrigin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

function CampaignEditor({ ev, onBack }: { ev: RegistrationEvent; onBack: () => void }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; email: string | null; club: string | null }[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualClub, setManualClub] = useState("");

  const refetch = async (c: Campaign) => {
    setRecipients(await listCampaignRecipients(c.id));
  };

  useEffect(() => {
    (async () => {
      const c = await getOrCreateCampaign(ev.id);
      setCampaign(c);
      setSubject(c.subject || `Invitation — ${ev.title}`);
      setMessage(c.message || "");
      setImageUrl(c.image_url || "");
      setVideoUrl(c.video_url || "");
      await refetch(c);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev.id]);

  if (!campaign) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;

  const save = async () => {
    setSaving(true);
    try {
      await updateCampaign(campaign.id, { subject, message, image_url: imageUrl || null, video_url: videoUrl || null });
    } finally {
      setSaving(false);
    }
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
      await save();
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
        {/* Colonne email */}
        <div className="space-y-3 rounded-panel border border-line bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Contenu du mail</div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Objet"
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Message d'invitation…"
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="Lien d'une image (optionnel)"
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="Lien d'une vidéo (optionnel)"
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />
          <button onClick={save} disabled={saving} className="text-xs font-semibold text-link hover:underline disabled:opacity-50">
            {saving ? "Enregistrement…" : "Enregistrer le contenu"}
          </button>

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
