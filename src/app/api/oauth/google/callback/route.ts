import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens, fetchGoogleUserInfo, GOOGLE_SCOPES } from "@/lib/google/oauth";
import { upsertGoogleAccount } from "@/lib/google/accounts";

const STATE_COOKIE = "google_oauth_state";
const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL!;

function redirectWithError(message: string) {
  const url = new URL("/", siteUrl());
  url.searchParams.set("google_error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectWithError("state_mismatch");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", siteUrl()));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token) throw new Error("Pas d'access_token reçu de Google");

    const info = await fetchGoogleUserInfo(tokens.access_token);
    if (!info.id || !info.email) throw new Error("Impossible de lire l'identité du compte Google");

    await upsertGoogleAccount({
      userId: user.id,
      providerAccountId: info.id,
      email: info.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date,
      scopes: tokens.scope?.split(" ") ?? GOOGLE_SCOPES,
    });

    const url = new URL("/", siteUrl());
    url.searchParams.set("google_connected", info.email);
    return NextResponse.redirect(url);
  } catch (err) {
    console.error("[oauth/google/callback]", err);
    return redirectWithError("exchange_failed");
  }
}
