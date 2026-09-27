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
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  try {
    await supabase.auth.getSession();
  } catch {
    // Supabase injoignable : on laisse passer, la page gère l'absence de session.
  }
  return response;
}

export const config = {
  // Ni fichiers statiques, ni crons, ni pages publiques d'inscription (sans session).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron|inscription|privacy|terms|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
