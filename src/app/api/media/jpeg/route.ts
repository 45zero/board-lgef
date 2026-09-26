import { NextResponse } from "next/server";
import sharp from "sharp";
import { verifySignedParam } from "@/lib/social/mediaUrls";

/** Relais de conversion image → JPEG pour Instagram (PNG, WebP… refusés par l'API). URL signée, voir src/lib/social/mediaUrls.ts. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("u") ?? "";
  if (!verifySignedParam("jpeg", source, searchParams.get("e"), searchParams.get("s"))) {
    return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 403 });
  }

  const res = await fetch(source);
  if (!res.ok) return NextResponse.json({ error: "Image source introuvable" }, { status: 502 });

  try {
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .rotate()
      .flatten({ background: "#ffffff" }) // transparence PNG → fond blanc
      .jpeg({ quality: 90 })
      .toBuffer();
    return new NextResponse(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Content-Length": String(jpeg.length) } });
  } catch {
    return NextResponse.json({ error: "Format d'image non pris en charge" }, { status: 415 });
  }
}
