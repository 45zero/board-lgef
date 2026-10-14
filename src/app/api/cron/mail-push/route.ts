import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { listNewPrimaryInbox, type NewInboxMail } from "@/lib/google/gmail";
import { sendPush } from "@/lib/push/sendPush";

export const maxDuration = 60;

/** Au-delà, un seul push récapitulatif au lieu d'un push par mail. */
const MAX_SINGLE = 3;

const senderName = (from: string) => from.replace(/<[^>]*>/g, "").replace(/"/g, "").trim() || from;

/**
 * Push des nouveaux mails (onglet « Principal » de la boîte de réception) — appelé chaque minute par
 * pg_cron (job « mail-push », sql/2026-10-15_mail_push.sql) avec le secret CRON_SECRET. Canal Android
 * « mail », distinct des autres notifications ; un toucher ouvre Mails. Rien pour qui a coupé les push
 * (profiles.notify_push) ou n'a pas l'appli (aucun jeton). Dernier mail signalé par compte : mail_push_state.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const service = createServiceClient();
  const accounts = (await prisma.connectedAccount.findMany({ where: { provider: "google" } })).filter((a) =>
    a.scopes.some((s) => s.includes("gmail"))
  );
  if (!accounts.length) return NextResponse.json({ pushed: 0 });

  const userIds = [...new Set(accounts.map((a) => a.user_id))];
  const [{ data: profiles }, { data: tokens }] = await Promise.all([
    service.from("profiles").select("id, notify_push").in("id", userIds),
    service.from("fcm_tokens").select("user_id").in("user_id", userIds),
  ]);
  const withApp = new Set((tokens ?? []).map((t) => t.user_id));
  const muted = new Set((profiles ?? []).filter((p) => p.notify_push === false).map((p) => p.id));

  // Canal « mail » ; icône de la messagerie du compte (le M de Gmail pour un compte Google).
  const push = (userId: string, title: string, body: string, data: Record<string, string>) =>
    sendPush({ userId, title, body, type: "mail", channel: "mail", icon: "ic_stat_gmail", native: true, data: { ...data, large_icon: "gmail" } });

  let pushed = 0;
  const errors: string[] = [];
  for (const account of accounts) {
    if (!withApp.has(account.user_id) || muted.has(account.user_id)) continue;
    try {
      const [state] = await prisma.$queryRaw<{ last_internal_date: bigint }[]>`
        select last_internal_date from public.mail_push_state where account_id = ${account.id}`;
      // Premier passage : point de départ maintenant (pas de rattrapage des mails déjà là).
      if (!state) {
        await prisma.$executeRaw`
          insert into public.mail_push_state (account_id, user_id, last_internal_date)
          values (${account.id}, ${account.user_id}::uuid, ${BigInt(Date.now())})
          on conflict (account_id) do nothing`;
        continue;
      }
      const fresh: NewInboxMail[] = await listNewPrimaryInbox(account, Number(state.last_internal_date));
      if (!fresh.length) continue;

      const data = { route: "/?app=mails", account_id: account.id };
      if (fresh.length <= MAX_SINGLE) {
        for (const m of fresh) {
          // Objet, puis le début du mail (quelques lignes visibles en dépliant la notification).
          const body = [m.subject, m.snippet.slice(0, 280)].filter(Boolean).join("\n");
          if (await push(account.user_id, senderName(m.from), body, { ...data, message_id: m.id })) pushed++;
        }
      } else {
        const senders = [...new Set(fresh.map((m) => senderName(m.from)))].slice(0, 4).join(", ");
        if (await push(account.user_id, `${fresh.length} nouveaux mails`, senders, data)) pushed++;
      }
      await prisma.$executeRaw`
        update public.mail_push_state
        set last_internal_date = ${BigInt(fresh[fresh.length - 1].internalDate)}, updated_at = now()
        where account_id = ${account.id}`;
    } catch (e) {
      errors.push(`${account.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length) console.error("[mail-push]", errors);
  return NextResponse.json({ pushed, errors: errors.length });
}
