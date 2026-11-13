import { createServiceClient } from "@/lib/supabase/serviceClient";
import { fail, getFiefActor } from "@/lib/fief/actor";
import { getFiefStorage } from "@/lib/fief/storage";

// Photo de profil d'une membre FIEF, pour les membres et l'équipe. Sans photo : un rond avec ses
// initiales (SVG) — jamais d'image cassée. Cache court : une nouvelle photo apparaît vite.

const COLORS = ["#1B3A73", "#7C3AED", "#0F766E", "#B45309", "#BE185D", "#1D4ED8", "#15803D", "#9F1239"];

function initialsSvg(name: string, seed: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("")
    .replace(/[<>&"']/g, "");
  const color = COLORS[[...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color}"/><text x="50" y="50" dy=".36em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#fff">${initials || "?"}</text></svg>`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Profil inconnu.");
  const actor = await getFiefActor();
  if (!actor || (!actor.member && !actor.manager)) return fail(403, "Réservé aux membres FIEF.");

  const { data: m } = await createServiceClient().from("fief_members").select("first_name, last_name, avatar_path").eq("user_id", id).maybeSingle();
  const headers = { "Cache-Control": "private, max-age=300" };
  if (m?.avatar_path) {
    const storage = await getFiefStorage();
    const upstream = storage ? await storage.fetch(m.avatar_path).catch(() => null) : null;
    if (upstream?.ok && upstream.body) return new Response(upstream.body, { headers: { ...headers, "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg" } });
  }
  return new Response(initialsSvg(m ? `${m.first_name} ${m.last_name}` : "", id), { headers: { ...headers, "Content-Type": "image/svg+xml" } });
}
