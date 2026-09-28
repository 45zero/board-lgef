import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Animation d'habillage déposée par un administrateur (.mov avec couche alpha : ProRes 4444,
// Animation ou PNG) → WebM VP9 transparent, très léger, réutilisé à chaque vidéo publiée, + une image
// clé pour les aperçus. Le HEVC avec alpha (export Apple) n'est pas lu en transparence : refusé.

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "board-assets";
const MAX_SECONDS = 30;
const SIZES = { vertical: { width: 1080, height: 1920 }, horizontal: { width: 1920, height: 1080 } } as const;
const ALPHA_FORMATS = /\b(yuva\w*|argb|rgba\w*|bgra\w*|abgr|gbrap\w*|ya8|ya16\w*)\b/;

function run(args: string[], allowFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-20000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 || allowFailure ? resolve(stderr) : reject(new Error(`FFmpeg (${code}) : ${stderr.split("\n").slice(-6).join(" ")}`))
    );
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (me?.role !== "admin" && me?.role !== "super_user") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const { sourcePath, orientation } = (await request.json()) as { sourcePath?: string; orientation?: keyof typeof SIZES };
  if (!sourcePath?.startsWith("habillages/src/") || sourcePath.includes("..") || !orientation || !(orientation in SIZES)) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const service = createServiceClient();
  const source = service.storage.from(BUCKET).getPublicUrl(sourcePath).data.publicUrl;
  const dir = await mkdtemp(path.join(tmpdir(), "animation-"));
  try {
    // Analyse : format de pixels (couche alpha ?), dimensions, durée.
    const probe = await run(["-hide_banner", "-i", source], true);
    const stream = probe.split("\n").find((l) => /Stream #\d+:\d+.*: Video:/.test(l)) ?? "";
    if (!stream) throw new Error("Aucune piste vidéo dans ce fichier.");
    if (/\bhevc\b/.test(stream) || !ALPHA_FORMATS.test(stream)) {
      throw new Error(
        "Ce fichier n'a pas de couche alpha lisible. Exportez en ProRes 4444 (avec alpha), Animation ou PNG — le « HEVC avec alpha » d'Apple n'est pas pris en charge."
      );
    }
    const dims = stream.match(/, (\d{2,5})x(\d{2,5})/);
    const want = SIZES[orientation];
    if (dims) {
      const [w, h] = [Number(dims[1]), Number(dims[2])];
      if (Math.abs(w / h - want.width / want.height) > 0.02) {
        throw new Error(`L'animation fait ${w} × ${h} px : attendu ${want.width} × ${want.height} px (${orientation === "vertical" ? "9:16" : "16:9"}).`);
      }
    }
    const d = probe.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
    if (duration > MAX_SECONDS) throw new Error(`L'animation dure ${Math.round(duration)} s : ${MAX_SECONDS} s au maximum.`);

    const webm = path.join(dir, "anim.webm");
    const png = path.join(dir, "preview.png");
    // prettier-ignore
    await run([
      "-y", "-i", source,
      "-vf", `scale=${want.width}:${want.height},format=yuva420p`,
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "32",
      "-deadline", "good", "-cpu-used", "5", "-row-mt", "1", "-auto-alt-ref", "0",
      "-an", webm,
    ]);
    // Image clé (au milieu, 1 s au plus) pour les aperçus et les photos.
    const at = Math.min(1, duration / 2 || 0);
    await run(["-y", "-ss", String(at), "-i", source, "-frames:v", "1", "-vf", `scale=${want.width}:${want.height},format=rgba`, png]);

    const id = randomUUID();
    const store = async (file: string, ext: string, contentType: string) => {
      const p = `habillages/anim/${id}.${ext}`;
      const { error } = await service.storage.from(BUCKET).upload(p, await readFile(file), { contentType });
      if (error) throw new Error(error.message);
      return service.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
    };
    const [url, preview] = await Promise.all([store(webm, "webm", "video/webm"), store(png, "png", "image/png")]);
    return NextResponse.json({ url, preview, duration: Math.round(duration * 10) / 10 });
  } catch (e) {
    console.error("[habillage-animation]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Conversion impossible." }, { status: 400 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    // Source : copie temporaire de l'export (l'original reste chez l'administrateur).
    await service.storage.from(BUCKET).remove([sourcePath]).catch(() => undefined);
  }
}
