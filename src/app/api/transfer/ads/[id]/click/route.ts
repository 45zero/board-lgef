import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { transferBaseUrl } from "@/lib/transfer/core";

/** LGEF Transfer : clic sur une pub — compté, puis redirection vers le lien de l'annonceur. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = createServiceClient();
  const { data: ad } = await s.from("transfer_ads").select("link_url").eq("id", id).maybeSingle();
  if (!ad?.link_url) return NextResponse.redirect(`${transferBaseUrl()}/transfer`, 302);
  await s.rpc("transfer_ad_hit", { p_ad: id, p_click: true });
  return NextResponse.redirect(ad.link_url, 302);
}
