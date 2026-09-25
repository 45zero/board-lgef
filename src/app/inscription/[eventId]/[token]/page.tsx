import { notFound } from "next/navigation";
import { getRegistrationContext, submitRegistrationResponse } from "@/app/actions/registration-public";
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
  if (!context) notFound();

  const { recipient, event, cardHtml } = context;
  const initialChoice = r === "yes" || r === "no" ? r : null;

  async function respond(response: "yes" | "no") {
    "use server";
    await submitRegistrationResponse(token, response);
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
        onSubmit={respond}
      />
    </div>
  );
}
