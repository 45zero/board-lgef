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
import { sanitizePlacement, sanitizeTiming, timedOverlayExprs } from "@/lib/board/textTiming";

// Habillage d'une vidéo : la vidéo d'origine et le calque PNG transparent (déposés dans video-work
// par le téléphone) sont assemblés par FFmpeg — vidéo ramenée à 1080 px de large, calque ajusté à sa
// taille, H.264 + AAC, lecture rapide (faststart). Le résultat est déposé dans video-work et un lien
// signé est renvoyé ; les fichiers d'entrée sont supprimés. Textes minutés (texte du gabarit, titre) :
// couches PNG à part, incrustées de leur début à leur fin avec fondu / glissement.

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

  const { videoPath, overlayPath, animation, preroll, texts } = (await request.json()) as {
    videoPath?: string;
    overlayPath?: string;
    /** Animation du gabarit (WebM VP9 transparent du bucket board-assets), jouée une fois ou en boucle, placée. */
    animation?: { url?: string; mode?: "once" | "loop"; placement?: unknown } | null;
    /** Couches de texte minutées (2 au plus) : PNG plein cadre et minutage. */
    texts?: { path?: string; timing?: unknown }[] | null;
    /** Pré-roll (volet) joué au début : la vidéo démarre à `revealAt` s, sous le volet qui s'ouvre. */
    preroll?: { url?: string; revealAt?: number } | null;
  };
  const own = (p?: string) => !!p && p.startsWith(`${userId}/`) && !p.includes("..");
  const textLayers = (Array.isArray(texts) ? texts : []).slice(0, 2);
  if (!own(videoPath) || !own(overlayPath) || textLayers.some((t) => !own(t.path))) {
    return NextResponse.json({ error: "Fichiers non reconnus." }, { status: 400 });
  }
  const animPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/board-assets/habillages/anim/`;
  const validAnim = (u?: string) => !u || (u.startsWith(animPrefix) && u.endsWith(".webm"));
  if (!validAnim(animation?.url) || !validAnim(preroll?.url)) {
    return NextResponse.json({ error: "Animation non reconnue." }, { status: 400 });
  }

  const service = createServiceClient();
  const dir = await mkdtemp(path.join(tmpdir(), "habillage-"));
  try {
    const [video, overlay, ...textFiles] = await Promise.all([
      service.storage.from(BUCKET).download(videoPath!),
      service.storage.from(BUCKET).download(overlayPath!),
      ...textLayers.map((t) => service.storage.from(BUCKET).download(t.path!)),
    ]);
    if (!video.data || !overlay.data || textFiles.some((t) => !t.data)) throw new Error("Vidéo ou calque introuvable.");
    const input = path.join(dir, `in${path.extname(videoPath!) || ".mp4"}`);
    const layer = path.join(dir, "overlay.png");
    const output = path.join(dir, "out.mp4");
    await writeFile(input, Buffer.from(await video.data.arrayBuffer()));
    await writeFile(layer, Buffer.from(await overlay.data.arrayBuffer()));
    const textPngs = await Promise.all(
      textFiles.map(async (t, i) => {
        const file = path.join(dir, `text${i + 1}.png`);
        await writeFile(file, Buffer.from(await t.data!.arrayBuffer()));
        return file;
      })
    );

    // Vidéo ramenée à 1080 px de large ; animation (décodée par libvpx pour garder la transparence,
    // une fois ou en boucle) puis calque PNG (texte, logo) ajustés à sa taille.
    // Couches, de bas en haut : vidéo (décalée sous le pré-roll), animation du gabarit, calque PNG
    // (texte, logo, titre), pré-roll. Les animations sont décodées par libvpx pour garder l'alpha.
    const anim = animation?.url ? animation : null;
    const pre = preroll?.url ? { url: preroll.url, revealAt: Math.min(30, Math.max(0, Number(preroll.revealAt) || 0)) } : null;
    const loop = anim?.mode === "loop";
    const inputs: string[] = [];
    const chain: string[] = [`[0:v]scale=1080:-2,setsar=1${pre ? `,tpad=start_duration=${pre.revealAt}:start_mode=clone` : ""}[s0]`];
    let cur = "s0";
    let next = 2;
    if (anim) {
      inputs.push(...(loop ? ["-stream_loop", "-1"] : []), "-c:v", "libvpx-vp9", "-i", anim.url!);
      const i = next++;
      // Placement : animation étirée au cadre puis mise à l'échelle, centrée sur (x, y).
      const p = sanitizePlacement(anim.placement);
      chain.push(
        `[${i}:v]format=rgba[a${i}]`,
        `[a${i}][${cur}]scale2ref=w=main_w*${p.scale}:h=main_h*${p.scale}[an${i}][b${i}]`,
        `[b${i}][an${i}]overlay=x=${p.x}*main_w-overlay_w/2:y=${p.y}*main_h-overlay_h/2:${loop ? "shortest=1" : "eof_action=pass"}:format=auto[s${i}]`
      );
      cur = `s${i}`;
    }
    chain.push(`[1:v][${cur}]scale2ref=w=main_w:h=main_h[ov][bp]`, "[bp][ov]overlay=0:0:format=auto[sp]");
    cur = "sp";
    // Textes minutés : image fixe répétée (-loop 1), fondu sur l'alpha, glissement par les
    // expressions x / y, visible de son début à sa fin (enable) ; shortest=1 : s'arrête avec la vidéo.
    for (const [k, t] of textLayers.entries()) {
      inputs.push("-loop", "1", "-framerate", "30", "-i", textPngs[k]);
      const i = next++;
      const e = timedOverlayExprs(sanitizeTiming(t.timing), pre?.revealAt ?? 0);
      chain.push(
        `[${i}:v]format=rgba${e.fade ? `,${e.fade}` : ""}[t${i}]`,
        `[t${i}][${cur}]scale2ref=w=main_w:h=main_h[tl${i}][b${i}]`,
        `[b${i}][tl${i}]overlay=x='${e.x}':y='${e.y}':enable='${e.enable}':shortest=1:format=auto[s${i}]`
      );
      cur = `s${i}`;
    }
    if (pre) {
      inputs.push("-c:v", "libvpx-vp9", "-i", pre.url);
      const i = next++;
      chain.push(`[${i}:v]format=rgba[a${i}]`, `[a${i}][${cur}]scale2ref=w=main_w:h=main_h[an${i}][b${i}]`, `[b${i}][an${i}]overlay=0:0:eof_action=pass:format=auto[s${i}]`);
      cur = `s${i}`;
    }
    chain.push(`[${cur}]format=yuv420p[out]`);
    const filter = chain.join(";");
    const animInput = inputs;
    // Son décalé d'autant que l'image sous le pré-roll.
    const audio = pre && pre.revealAt > 0 ? ["-af", `adelay=${Math.round(pre.revealAt * 1000)}|${Math.round(pre.revealAt * 1000)}`] : [];

    // prettier-ignore
    await run([
      "-y",
      "-i", input,
      "-i", layer,
      ...animInput,
      "-filter_complex", filter,
      "-map", "[out]",
      "-map", "0:a?",
      ...audio,
      "-t", String(MAX_SECONDS + (pre?.revealAt ?? 0)),
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
    // Ménage : résultats jamais récupérés (appli fermée en cours de route) de plus de 24 h.
    const { data: old } = await service.storage.from(BUCKET).list(userId, { limit: 100 });
    const stale = (old ?? []).filter((f) => f.created_at && Date.now() - new Date(f.created_at).getTime() > 86_400_000).map((f) => `${userId}/${f.name}`);
    if (stale.length) await service.storage.from(BUCKET).remove(stale);
    return NextResponse.json({ url: signed.signedUrl, path: resultPath });
  } catch (e) {
    console.error("[video-habillage]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Habillage de la vidéo impossible." }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    // Fichiers d'entrée temporaires : plus utiles une fois l'encodage terminé (ou échoué).
    await service.storage
      .from(BUCKET)
      .remove([videoPath!, overlayPath!, ...textLayers.map((t) => t.path!)])
      .catch(() => undefined);
  }
}
