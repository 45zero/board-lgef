import { NextResponse } from "next/server";
import { defaultPlan, resolvePlan } from "@/lib/transfer/core";
import { getTransferMember } from "@/lib/transfer/session";

/** LGEF Transfer : compte du board connecté et sa formule (sinon formule par défaut ; l'expéditeur passera par le code e-mail). */
export async function GET() {
  const member = await getTransferMember();
  if (!member) return NextResponse.json({ member: null, plan: await defaultPlan() });
  const { plan } = await resolvePlan(member.email);
  return NextResponse.json({ member: { email: member.email, name: member.name }, plan });
}
