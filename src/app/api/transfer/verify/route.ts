import { NextResponse } from "next/server";
import { verifyCode } from "@/lib/transfer/core";

/** LGEF Transfer : vérifie le code reçu ; renvoie un jeton d'expéditeur (24 h) et la formule de l'adresse. */
export async function POST(request: Request) {
  const { email, code } = (await request.json().catch(() => ({}))) as { email?: string; code?: string };
  try {
    return NextResponse.json({ ok: true, ...(await verifyCode(email ?? "", code ?? "")) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Vérification impossible." }, { status: 400 });
  }
}
