import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getTransferStorage } from "@/lib/transfer/storage";

export const maxDuration = 60;

/** LGEF Transfer : image ou vidéo d'une pub, servie depuis le Drive du board avec cache (CDN). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: ad } = await createServiceClient().from("transfer_ads").select("media_drive_file_id").eq("id", id).maybeSingle();
  const storage = await getTransferStorage();
  if (!ad || !storage) return NextResponse.json({ error: "Pub introuvable" }, { status: 404 });

  const res = await storage.fetchMedia(ad.media_drive_file_id, request.headers.get("range"));
  if (!res.ok || !res.body) return NextResponse.json({ error: "Fichier indisponible" }, { status: 502 });

  const headers = new Headers({ "Cache-Control": "public, max-age=3600, s-maxage=86400", "Accept-Ranges": "bytes" });
  for (const h of ["content-type", "content-length", "content-range"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(res.body, { status: res.status, headers });
}
