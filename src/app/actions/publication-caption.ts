"use server";

import { createClient } from "@/lib/supabase/server";
import { EVENT_TYPE_TO_ORG, type DbEventType } from "@/lib/board/calendar";
import { ORG_LABELS } from "@/lib/board/tokens";
import { isCaptionWriterConfigured, writeCaption } from "@/lib/social/captionWriter";
import { publicationPreviewImages } from "@/lib/social/publicationImages";

// Proposition de texte pour une publication du centre de publication (voir captionWriter.ts).
// Lu avec la session de la personne : elle ne peut faire rédiger que les publications qu'elle voit.

const NETWORK_LABELS: Record<string, string> = {
  youtube: "YouTube",
  lorraine: "Facebook Lorraine",
  champagne_ardenne: "Facebook Champagne-Ardenne",
  alsace: "Facebook Alsace",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const parisDate = (iso: string, withTime: boolean) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(iso));

function mediaSummary(types: (string | null)[]): string {
  const videos = types.filter((t) => (t ?? "").startsWith("video")).length;
  const photos = types.length - videos;
  const parts = [photos ? `${photos} photo${photos > 1 ? "s" : ""}` : "", videos ? `${videos} vidéo${videos > 1 ? "s" : ""}` : ""].filter(Boolean);
  return parts.length ? parts.join(" et ") : "aucun média (post texte)";
}

/** Publication déjà créée, ou fenêtre « Nouvelle publication » (médias pas encore envoyés). */
export type CaptionSource =
  | { publicationId: string }
  | { draft: { eventId: string | null; title: string; category: DbEventType | null; photos: number; videos: number } };

type Ev = { title: string; description: string | null; start_date: string; end_date: string; location: string | null; event_address: string | null; event_type: DbEventType | null };
const EVENT_COLS = "title, description, start_date, end_date, location, event_address, event_type";

function eventFacts(ev: Ev): string[] {
  const out: string[] = [];
  const sameDay = ev.start_date.slice(0, 10) === ev.end_date?.slice(0, 10);
  out.push(sameDay || !ev.end_date ? `Date : ${parisDate(ev.start_date, true)}` : `Dates : du ${parisDate(ev.start_date, false)} au ${parisDate(ev.end_date, false)}`);
  const place = [ev.location, ev.event_address].filter(Boolean).join(" — ");
  if (place) out.push(`Lieu : ${place}`);
  if (ev.description?.trim()) out.push(`Description de l'événement : ${ev.description.trim().slice(0, 1500)}`);
  return out;
}

/** Aperçus envoyés par le navigateur (brouillon) : JPEG base64 raisonnables seulement. */
function cleanClientImages(images: string[] | undefined): string[] {
  return (images ?? [])
    .map((d) => d.replace(/^data:image\/jpeg;base64,/, ""))
    .filter((d) => /^[A-Za-z0-9+/=]+$/.test(d) && d.length < 400_000)
    .slice(0, 4);
}

export async function proposePublicationCaption(
  source: CaptionSource,
  opts: { current?: string; instruction?: string; networks?: string[]; images?: string[] } = {}
): Promise<{ text: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { text: null, error: "Session expirée : reconnectez-vous." };
  if (!isCaptionWriterConfigured()) return { text: null, error: "Rédaction automatique indisponible pour le moment." };

  const facts: string[] = [];
  let images: string[] = [];

  if ("publicationId" in source) {
    const { data: pub } = await supabase
      .from("media_publications")
      .select(`title, category, file_ids, media, events(${EVENT_COLS})`)
      .eq("id", source.publicationId)
      .maybeSingle();
    if (!pub) return { text: null, error: "Publication introuvable." };
    const ev = (Array.isArray(pub.events) ? pub.events[0] : pub.events) as Ev | null;
    const media = (pub.media ?? []) as { drive_file_id?: string; content_type?: string | null }[];
    const fileIds = (pub.file_ids ?? []) as string[];
    const { data: rows } = fileIds.length
      ? await supabase.from("event_files").select("id, content_type, folder, path, drive_file_id, drive_purged_at").in("id", fileIds)
      : { data: [] };
    const files = fileIds.map((id) => (rows ?? []).find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);

    const type = (ev?.event_type ?? pub.category) as DbEventType | null;
    facts.push(`Titre : ${ev?.title ?? pub.title ?? "Publication"}`);
    if (type) facts.push(`Catégorie : ${ORG_LABELS[EVENT_TYPE_TO_ORG[type]]}`);
    if (ev) facts.push(...eventFacts(ev));
    facts.push(`Média : ${mediaSummary([...files.map((f) => f.content_type), ...media.map((m) => m.content_type ?? null)])}`);
    const folders = [...new Set(files.map((f) => f.folder).filter(Boolean))];
    if (folders.length) facts.push(`Dossiers des médias : ${folders.join(", ")}`);

    images = await publicationPreviewImages([
      ...files
        .filter((f) => !f.drive_purged_at)
        .map((f) => ({ driveFileId: f.drive_file_id, storagePath: f.drive_file_id ? null : f.path, contentType: f.content_type })),
      ...media.filter((m) => m.drive_file_id).map((m) => ({ driveFileId: m.drive_file_id!, storagePath: null, contentType: m.content_type ?? null })),
    ]).catch(() => []);
  } else {
    const d = source.draft;
    const { data: ev } = d.eventId ? await supabase.from("events").select(EVENT_COLS).eq("id", d.eventId).maybeSingle() : { data: null };
    const type = ((ev as Ev | null)?.event_type ?? d.category) as DbEventType | null;
    facts.push(`Titre : ${(ev as Ev | null)?.title ?? (d.title.trim() || "Publication")}`);
    if (type) facts.push(`Catégorie : ${ORG_LABELS[EVENT_TYPE_TO_ORG[type]]}`);
    if (ev) facts.push(...eventFacts(ev as Ev));
    facts.push(`Média : ${mediaSummary([...Array(Math.max(0, d.photos)).fill("image"), ...Array(Math.max(0, d.videos)).fill("video")])}`);
    images = cleanClientImages(opts.images);
  }

  const networks = (opts.networks ?? []).map((n) => NETWORK_LABELS[n]).filter(Boolean);
  if (networks.length) facts.push(`Réseaux visés : ${networks.join(", ")}`);

  try {
    const text = await writeCaption({
      facts,
      images,
      current: (opts.current ?? "").slice(0, 3000),
      instruction: (opts.instruction ?? "").slice(0, 500),
    });
    if (!text) return { text: null, error: "Pas de proposition cette fois : réessayez ou écrivez le texte." };
    return { text, error: null };
  } catch (e) {
    console.error("[publication-caption]", e);
    return { text: null, error: "La rédaction automatique n'a pas répondu : réessayez dans un instant." };
  }
}
