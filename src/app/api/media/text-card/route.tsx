import { NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { verifySignedParam } from "@/lib/social/mediaUrls";

const WIDTH = 1080;
const HEIGHT = 1350; // 4:5, le format portrait le plus grand accepté par Instagram

function fontSizeFor(text: string) {
  const n = text.length;
  if (n < 80) return 72;
  if (n < 160) return 58;
  if (n < 320) return 46;
  if (n < 600) return 36;
  return 28;
}

/**
 * Visuel généré pour publier un post texte sur Instagram (qui exige toujours un média) : le texte
 * sur fond bleu LGEF, logo en tête. PNG rendu par next/og puis converti en JPEG (seul format
 * accepté par Instagram). URL signée, voir src/lib/social/mediaUrls.ts.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get("t") ?? "";
  if (!verifySignedParam("card", text, searchParams.get("e"), searchParams.get("s"))) {
    return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 403 });
  }

  const origin = new URL(request.url).origin;
  const display = text.length > 900 ? `${text.slice(0, 900)}…` : text;

  const png = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(160deg, #12305F 0%, #0E2A55 60%, #0A1F40 100%)",
          padding: "90px 90px 70px",
          color: "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- rendu satori, pas de next/image ici */}
        <img src={`${origin}/lgef-logo.png`} width={120} height={120} alt="" />
        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          <div style={{ fontSize: fontSizeFor(display), lineHeight: 1.3, fontWeight: 700, whiteSpace: "pre-wrap" }}>{display}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: "#E1141B", fontWeight: 700 }}>
          <div style={{ width: 60, height: 6, background: "#E1141B" }} />
          <div style={{ color: "#ffffff", opacity: 0.85 }}>Ligue Grand Est de Football</div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT }
  );

  const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 92 }).toBuffer();
  return new NextResponse(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Content-Length": String(jpeg.length) } });
}
