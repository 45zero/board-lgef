"use server";

import { createClient } from "@/lib/supabase/server";
import { EVENT_TYPE_TO_ORG, type DbEventType } from "@/lib/board/calendar";
import { ORG_LABELS } from "@/lib/board/tokens";
import { isCaptionWriterConfigured, writeCaption } from "@/lib/social/captionWriter";

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

export async function proposePublicationCaption(
  publicationId: string,
  opts: { current?: string; instruction?: string; networks?: string[] } = {}
): Promise<{ text: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { text: null, error: "Session expirée : reconnectez-vous." };
  if (!isCaptionWriterConfigured()) return { text: null, error: "Rédaction automatique indisponible pour le moment." };

  const { data: pub } = await supabase
    .from("media_publications")
    .select("title, category, kind, file_ids, media, events(title, description, start_date, end_date, location, event_address, event_type)")
    .eq("id", publicationId)
    .maybeSingle();
  if (!pub) return { text: null, error: "Publication introuvable." };

  type Ev = { title: string; description: string | null; start_date: string; end_date: string; location: string | null; event_address: string | null; event_type: DbEventType | null };
  const ev = (Array.isArray(pub.events) ? pub.events[0] : pub.events) as Ev | null;
  const media = (pub.media ?? []) as { content_type?: string | null }[];
  const fileIds = (pub.file_ids ?? []) as string[];
  const { data: files } = fileIds.length
    ? await supabase.from("event_files").select("content_type, folder").in("id", fileIds)
    : { data: [] as { content_type: string | null; folder: string | null }[] };

  const type = (ev?.event_type ?? pub.category) as DbEventType | null;
  const facts: string[] = [`Titre : ${ev?.title ?? pub.title ?? "Publication"}`];
  if (type) facts.push(`Catégorie : ${ORG_LABELS[EVENT_TYPE_TO_ORG[type]]}`);
  if (ev) {
    const sameDay = ev.start_date.slice(0, 10) === ev.end_date?.slice(0, 10);
    facts.push(sameDay || !ev.end_date ? `Date : ${parisDate(ev.start_date, true)}` : `Dates : du ${parisDate(ev.start_date, false)} au ${parisDate(ev.end_date, false)}`);
    const place = [ev.location, ev.event_address].filter(Boolean).join(" — ");
    if (place) facts.push(`Lieu : ${place}`);
    if (ev.description?.trim()) facts.push(`Description de l'événement : ${ev.description.trim().slice(0, 1500)}`);
  }
  const types = [...(files ?? []).map((f) => f.content_type), ...media.map((m) => m.content_type ?? null)];
  facts.push(`Média : ${mediaSummary(types)}`);
  const folders = [...new Set((files ?? []).map((f) => f.folder).filter(Boolean))];
  if (folders.length) facts.push(`Dossiers des médias : ${folders.join(", ")}`);
  const networks = (opts.networks ?? []).map((n) => NETWORK_LABELS[n]).filter(Boolean);
  if (networks.length) facts.push(`Réseaux visés : ${networks.join(", ")}`);

  try {
    const text = await writeCaption({
      facts,
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
