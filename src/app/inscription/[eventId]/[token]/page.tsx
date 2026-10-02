import { notFound, redirect } from "next/navigation";
import { getPublicLinkForEvent, getRegistrationContext, submitRegistrationResponse } from "@/app/actions/registration-public";
import { RsvpCard } from "@/components/registration/RsvpCard";

export default async function RsvpPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string; token: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { eventId, token } = await params;
  const { r } = await searchParams;
  const context = await getRegistrationContext(eventId, token);
  if (!context) {
    // Destinataire retiré de la liste après l'envoi : on bascule sur le lien générique de l'événement
    // (nom, prénom, club à saisir) plutôt que d'afficher une page morte.
    const publicLink = await getPublicLinkForEvent(eventId);
    if (publicLink) redirect(r === "yes" || r === "no" ? `${publicLink}?r=${r}` : publicLink);
    notFound();
  }

  const { recipient, event, cardHtml, clubLimit } = context;
  const initialChoice = r === "yes" || r === "no" ? r : null;

  async function respond(response: "yes" | "no", attendees: number | null) {
    "use server";
    return submitRegistrationResponse(token, response, attendees);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell p-4">
      <RsvpCard
        eventTitle={event.title}
        eventStartDate={event.start_date}
        eventLocation={event.location}
        cardHtml={cardHtml}
        initialChoice={initialChoice}
        alreadyResponded={recipient.response as "yes" | "no" | null}
        clubLimit={clubLimit}
        onSubmit={respond}
      />
    </div>
  );
}
