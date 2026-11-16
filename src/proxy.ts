import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Rafraîchit la session Supabase en un seul endroit, avant les pages, routes et server actions :
 * sans ça, à l'expiration du jeton (1 h), chaque action tentait son propre rafraîchissement en
 * concurrence avec le navigateur et pouvait échouer (« Non authentifié »).
 *
 * `getSession()` lit le cookie sans appel réseau et ne contacte Supabase que si le jeton a expiré.
 * Il ne sert qu'au rafraîchissement : l'autorisation reste vérifiée par chaque action (getClaims).
 */
export async function proxy(request: NextRequest) {
  // transfer.lgef.fr : la racine affiche la page d'envoi ; seules les pages et API de LGEF Transfer y sont servies.
  if (request.headers.get("host")?.startsWith("transfer.")) {
    const { pathname } = request.nextUrl;
    if (pathname === "/") return NextResponse.rewrite(new URL("/transfer", request.url));
    if (!/^\/(transfer|t\/|api\/transfer\/|privacy|terms)/.test(pathname)) return NextResponse.redirect(new URL("/", request.url));
  }

  // fief.lgef.fr : seules les pages FIEF (/fief/…) y sont servies, sous des adresses courtes (/adhesion → /fief/adhesion).
  const { pathname } = request.nextUrl;
  const fiefHost = request.headers.get("host")?.startsWith("fief.") ?? false;
  const rewriteTo = fiefHost && !isFiefPath(pathname) ? new URL(`/fief${pathname === "/" ? "" : pathname}${request.nextUrl.search}`, request.url) : null;
  const pass = () => (rewriteTo ? NextResponse.rewrite(rewriteTo, { request }) : NextResponse.next({ request }));

  let response = pass();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = pass();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  let accessToken: string | null = null;
  try {
    accessToken = (await supabase.auth.getSession()).data.session?.access_token ?? null;
  } catch {
    // Supabase injoignable : on laisse passer, la page gère l'absence de session.
  }

  // Cloison FIEF (voir sql/2026-11-13_fief_cloison.sql) : un compte FIEF n'ouvre ni le board, ni ses
  // API, ni ses server actions. Le marqueur est lu dans le jeton signé : le modifier l'invalide, et
  // chaque action du board le refuse alors (getClaims / getUser).
  if (accessToken && isFiefToken(accessToken)) {
    if (request.headers.has("next-action")) return new NextResponse("Accès réservé au board.", { status: 403 });
    if (pathname.startsWith("/api/") && !pathname.startsWith("/api/fief/")) return new NextResponse("Accès réservé au board.", { status: 403 });
    if (!fiefHost && !isFiefPath(pathname)) {
      const target = process.env.NEXT_PUBLIC_FIEF_URL ? new URL(process.env.NEXT_PUBLIC_FIEF_URL) : new URL("/fief", request.url);
      return NextResponse.redirect(target);
    }
  }
  return response;
}

const isFiefPath = (p: string) => p === "/fief" || p.startsWith("/fief/") || p.startsWith("/api/fief/");

/** Lit app_metadata.realm dans la charge utile du JWT (sans vérifier la signature : voir plus haut). */
function isFiefToken(token: string) {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return json?.app_metadata?.realm === "fief";
  } catch {
    return false;
  }
}

export const config = {
  // Ni fichiers statiques, ni crons, ni pages publiques (inscription, dépôt de facture : sans session).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron|inscription|facture|tournoi|privacy|terms|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
