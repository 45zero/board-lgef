import { notFound, redirect } from "next/navigation";
import { resolveRecipientEventId } from "@/app/actions/registration-public";

/**
 * Lien court du bouton WhatsApp : /inscription/{jeton}. Meta encode le paramètre dynamique d'un bouton
 * (un « / » y devient %2F), d'où un seul segment. Accepte aussi l'ancien format « {eventId}%2F{jeton} »
 * et un préfixe « {{1}} » resté littéral dans l'URL du modèle.
 */
export default async function RsvpShortLinkPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: raw } = await params;
  // Le modèle Meta a gardé « {{1}} » en texte dans l'URL de base : le lien arrive en /inscription/{{1}}{jeton}.
  const value = decodeURIComponent(raw).replace(/^\{\{1\}\}/, "");

  const [first, second] = value.split("/");
  if (second) redirect(`/inscription/${first}/${second}`);

  const eventId = await resolveRecipientEventId(first);
  if (!eventId) notFound();
  redirect(`/inscription/${eventId}/${first}`);
}
