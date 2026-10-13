import { NextResponse } from "next/server";
import { sendVerificationCode } from "@/lib/transfer/core";

/** LGEF Transfer : envoie un code à 6 chiffres pour vérifier l'adresse de l'expéditeur (page publique). */
export async function POST(request: Request) {
  const { email } = (await request.json().catch(() => ({}))) as { email?: string };
  try {
    await sendVerificationCode(email ?? "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Envoi du code impossible." }, { status: 400 });
  }
}
