import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { isPublisher } from "@/lib/board/publishers";

// Habillage d'une vidéo : la vidéo d'origine et le calque PNG transparent (déposés dans video-work
// par le téléphone) sont assemblés par FFmpeg — vidéo ramenée à 1080 px de large, calque ajusté à sa
// taille, H.264 + AAC, lecture rapide (faststart). Le résultat est déposé dans video-work et un lien
// signé est renvoyé ; les fichiers d'entrée sont supprimés.

export const runtime = "nodejs";
// Plan Hobby avec Fluid compute : jusqu'à 300 s. Vidéos limitées à 90 s (encodage mesuré ~1,5 fois la durée sur un processeur).
export const maxDuration = 300;

const BUCKET = "video-work";
const MAX_SECONDS = 90;

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg (${code}) : ${stderr.split("\n").slice(-6).join(" ")}`))));
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!(await isPublisher(supabase, userId))) return NextResponse.json({ error: "Vous n'êtes pas habilité à publier." }, { status: 403 });

  const { videoPath, overlayPath, animation } = (await request.json()) as {
    videoPath?: string;
    overlayPath?: string;
    /** Animation du gabarit (WebM VP9 transparent du bucket board-assets), jouée une fois ou en boucle. */
    animation?: { url?: string; mode?: "once" | "loop" } | null;
  };
  const own = (p?: string) => !!p && p.startsWith(`${userId}/`) && !p.includes("..");
  if (!own(videoPath) || !own(overlayPath)) return NextResponse.json({ error: "Fichiers non reconnus." }, { status: 400 });
  const animPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/board-assets/habillages/anim/`;
  if (animation?.url && (!animation.url.startsWith(animPrefix) || !animation.url.endsWith(".webm"))) {
    return NextResponse.json({ error: "Animation non reconnue." }, { status: 400 });
  }

  const service = createServiceClient();
  const dir = await mkdtemp(path.join(tmpdir(), "habillage-"));
  try {
    const [video, overlay] = await Promise.all([
      service.storage.from(BUCKET).download(videoPath!),
      service.storage.from(BUCKET).download(overlayPath!),
    ]);
    if (!video.data || !overlay.data) throw new Error("Vidéo ou calque introuvable.");
    const input = path.join(dir, `in${path.extname(videoPath!) || ".mp4"}`);
    const layer = path.join(dir, "overlay.png");
    const output = path.join(dir, "out.mp4");
    await writeFile(input, Buffer.from(await video.data.arrayBuffer()));
    await writeFile(layer, Buffer.from(await overlay.data.arrayBuffer()));

    // Vidéo ramenée à 1080 px de large ; animation (décodée par libvpx pour garder la transparence,
    // une fois ou en boucle) puis calque PNG (texte, logo) ajustés à sa taille.
    const anim = animation?.url ? animation : null;
    const loop = anim?.mode === "loop";
    const filter = anim
      ? "[0:v]scale=1080:-2,setsar=1[base];" +
        "[2:v]format=rgba[a1];[a1][base]scale2ref=w=main_w:h=main_h[an][b1];" +
        `[b1][an]overlay=0:0:${loop ? "shortest=1" : "eof_action=pass"}:format=auto[v1];` +
        "[1:v][v1]scale2ref=w=main_w:h=main_h[ov][b2];[b2][ov]overlay=0:0:format=auto,format=yuv420p[out]"
      : "[0:v]scale=1080:-2,setsar=1[base];[1:v][base]scale2ref=w=main_w:h=main_h[ov][ref];[ref][ov]overlay=0:0:format=auto,format=yuv420p[out]";
    const animInput = anim ? [...(loop ? ["-stream_loop", "-1"] : []), "-c:v", "libvpx-vp9", "-i", anim.url!] : [];

    // prettier-ignore
    await run([
      "-y",
      "-i", input,
      "-i", layer,
      ...animInput,
      "-filter_complex", filter,
      "-map", "[out]",
      "-map", "0:a?",
      "-t", String(MAX_SECONDS),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      output,
    ]);

    const resultPath = `${userId}/${randomUUID()}-habille.mp4`;
    const { error: upErr } = await service.storage.from(BUCKET).upload(resultPath, await readFile(output), { contentType: "video/mp4" });
    if (upErr) throw new Error(upErr.message);
    const { data: signed } = await service.storage.from(BUCKET).createSignedUrl(resultPath, 3600);
    if (!signed) throw new Error("Lien du résultat indisponible.");
    return NextResponse.json({ url: signed.signedUrl, path: resultPath });
  } catch (e) {
    console.error("[video-habillage]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Habillage de la vidéo impossible." }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    // Fichiers d'entrée temporaires : plus utiles une fois l'encodage terminé (ou échoué).
    await service.storage.from(BUCKET).remove([videoPath!, overlayPath!]).catch(() => undefined);
  }
}
