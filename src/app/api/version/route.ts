import { NextResponse } from "next/server";

// Version du board en ligne (commit du déploiement Vercel). Comparée par VersionWatcher à celle
// chargée dans le navigateur : une appli restée ouverte (Dock, onglet, mobile) sait qu'une nouvelle
// version est sortie et se recharge.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { id: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
