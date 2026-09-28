import { notFound, redirect } from "next/navigation";
import { resolveRecipientEventId } from "@/app/actions/registration-public";

/**
 * Lien court du bouton WhatsApp : /inscription/{jeton}. Meta encode le paramètre dynamique d'un bouton
 * (un « / » y devient %2F), d'où un seul segment. Accepte aussi l'ancien format « {eventId}%2F{jeton} ».
 */
export default async function RsvpShortLinkPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: raw } = await params;
  const value = decodeURIComponent(raw);

  const [first, second] = value.split("/");
  if (second) redirect(`/inscription/${first}/${second}`);

  const eventId = await resolveRecipientEventId(first);
  if (!eventId) notFound();
  redirect(`/inscription/${eventId}/${first}`);
}
