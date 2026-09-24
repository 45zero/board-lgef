import { notFound } from "next/navigation";
import { getPublicCampaignContext, submitPublicResponse } from "@/app/actions/registration-public";
import { PublicRsvpForm } from "@/components/registration/PublicRsvpForm";

export default async function PublicRsvpPage({
  params,
}: {
  params: Promise<{ eventId: string; publicToken: string }>;
}) {
  const { eventId, publicToken } = await params;
  const context = await getPublicCampaignContext(eventId, publicToken);
  if (!context) notFound();

  const { campaign, event } = context;

  async function respond(data: { name: string; club: string; email: string; response: "yes" | "no" }) {
    "use server";
    await submitPublicResponse(campaign.id, data);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell p-4">
      <PublicRsvpForm
        eventTitle={event.title}
        eventStartDate={event.start_date}
        eventLocation={event.location}
        onSubmit={respond}
      />
    </div>
  );
}
