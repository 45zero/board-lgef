import { NextResponse } from "next/server";
import { expireDueTransfers } from "@/lib/transfer/core";

export const maxDuration = 300;

/**
 * LGEF Transfer — tâche quotidienne (pg_cron « transfers-expire », sql/2026-10-13_lgef_transfer.sql) :
 * liens expirés coupés, fichiers envoyés mis à la corbeille du Drive (sauf transferts archivés), envois
 * abandonnés depuis 2 jours nettoyés.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  return NextResponse.json(await expireDueTransfers());
}
