import { NextResponse } from "next/server";
import { getEventPositions, getStaffLocations, getTravelToEvent } from "@/app/actions/map";

/**
 * Carte du Grand Est appelée en `fetch` plutôt qu'en Server Action : Next.js exécute les Server
 * Actions d'une page l'une après l'autre, et la carte attendait derrière les trajets et couvertures
 * de chaque demande de captation (jusqu'à une minute). Les droits restent vérifiés dans actions/map.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as
      | { op: "positions"; ids: string[] }
      | { op: "staff" }
      | { op: "travel"; eventId: string; userIds?: string[] };
    switch (body.op) {
      case "positions":
        return NextResponse.json(await getEventPositions(Array.isArray(body.ids) ? body.ids : []));
      case "staff":
        return NextResponse.json(await getStaffLocations());
      case "travel":
        return NextResponse.json(await getTravelToEvent(body.eventId, body.userIds));
      default:
        return NextResponse.json({ error: "Opération inconnue" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: message === "Non authentifié" ? 401 : 500 });
  }
}
