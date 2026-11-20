import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import sharp from "sharp";
import { verifySignedParam } from "@/lib/social/mediaUrls";

// Image de couverture d'une vidéo publiée sur Instagram (cover_url du Reel) et Facebook (thumb) :
// sans elle, Meta prend la toute première image — noire dès que la vidéo commence par un fondu, et
// identique d'une vidéo à l'autre quand elle s'ouvre sur l'habillage (pré-roll / visuel commun).
// L'image est donc prise dans le corps de la vidéo : à partir du tiers de sa durée (3 s au moins),
// FFmpeg lit quelques secondes (2 images/s) et on garde une image ni noire ni unie ; à défaut, la
// plus lumineuse et contrastée. URL signée (voir src/lib/social/mediaUrls.ts).

export const runtime = "nodejs";
export const maxDuration = 60;

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 40_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg (${code}) : ${stderr.split("\n").slice(-4).join(" ")}`));
    });
  });
}

/** Durée de la vidéo en secondes, lue dans l'en-tête affiché par FFmpeg (pas de ffprobe embarqué). */
function probeDuration(videoUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg.path, ["-hide_banner", "-i", videoUrl], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    const done = () => {
      clearTimeout(timer);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null);
    };
    child.on("error", done);
    child.on("close", done);
  });
}

/** Début de la lecture : passé l'intro commune, au tiers de la vidéo (3 s au moins, 1 s avant la fin au plus). */
function coverStart(duration: number | null): number {
  if (!duration) return 3;
  return Math.max(0.3, Math.min(Math.max(3, duration / 3), duration - 1));
}

async function frames(dir: string) {
  return (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort().map((f) => path.join(dir, f));
}

/**
 * Image retenue : dès la première image assez claire et détaillée (pas un écran noir ou uni), la
 * meilleure de la seconde qui suit (fin d'un fondu d'ouverture) ; sinon la meilleure de toutes.
 */
async function pickFrame(files: string[]): Promise<Buffer> {
  let best: { file: string; score: number } | null = null;
  let firstGood = -1;
  for (const [i, file] of files.entries()) {
    if (firstGood >= 0 && i > firstGood + 2) break;
    const { channels } = await sharp(file).stats();
    const rgb = channels.slice(0, 3);
    const mean = rgb.reduce((s, c) => s + c.mean, 0) / rgb.length;
    const stdev = rgb.reduce((s, c) => s + c.stdev, 0) / rgb.length;
    const good = mean >= 45 && stdev >= 30;
    if (good && firstGood < 0) {
      firstGood = i;
      best = null;
    }
    if (firstGood >= 0 && !good) continue;
    const score = mean * stdev;
    if (!best || score > best.score) best = { file, score };
  }
  if (!best) throw new Error("Aucune image extraite de la vidéo.");
  return readFile(best.file);
}

async function extractCover(videoUrl: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "cover-"));
  try {
    const scale = "scale='min(1080,iw)':-2";
    // Quelques secondes dans le corps de la vidéo, après l'intro commune.
    const start = coverStart(await probeDuration(videoUrl));
    await run(["-hide_banner", "-loglevel", "error", "-ss", start.toFixed(2), "-t", "6", "-i", videoUrl, "-vf", `fps=2,${scale}`, "-frames:v", "12", "-q:v", "3", path.join(dir, "f%02d.jpg")]).catch(() => undefined);
    let files = await frames(dir);
    if (files.length === 0) {
      // Vidéo très courte : l'image la plus représentative de toute la vidéo.
      await run(["-hide_banner", "-loglevel", "error", "-i", videoUrl, "-vf", `thumbnail,${scale}`, "-frames:v", "1", "-q:v", "3", path.join(dir, "t01.jpg")]);
      files = await frames(dir);
    }
    const frame = await pickFrame(files);
    return await sharp(frame).jpeg({ quality: 88 }).toBuffer();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Instagram puis Facebook demandent la même couverture : gardée en mémoire de l'instance.
const MAX_CACHED = 30;
const cache = new Map<string, Promise<Buffer>>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("u") ?? "";
  if (!verifySignedParam("cover", source, searchParams.get("e"), searchParams.get("s"))) {
    return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 403 });
  }

  let pending = cache.get(source);
  if (!pending) {
    pending = extractCover(source);
    cache.set(source, pending);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    pending.catch(() => cache.delete(source));
  }
  try {
    const jpeg = await pending;
    return new NextResponse(new Uint8Array(jpeg), {
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(jpeg.length), "Cache-Control": "private, max-age=1800" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couverture impossible" }, { status: 502 });
  }
}
