import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { canApproveForService } from "@/lib/board/hierarchy";
import { accessKindLabel } from "@/lib/board/accessRequests";

// Demandes de compte côté serveur : qui peut traiter quoi, compteur de l'accueil, relance au N+2.

type Service = ReturnType<typeof createServiceClient>;

/** Jours sans réponse avant de relancer le N+2 (ou les administrateurs). */
export const ESCALATE_AFTER_DAYS = 7;

/** Services dont `userId` peut traiter les demandes (responsable, au-dessus du responsable, délégataire « comptes »). */
export async function reviewableServices(service: Service, userId: string): Promise<Set<string>> {
  const { data } = await service.from("org_services").select("key");
  const keys = (data ?? []).map((s) => s.key);
  const allowed = await Promise.all(keys.map((k) => canApproveForService(service, "comptes", userId, k)));
  return new Set(keys.filter((_, i) => allowed[i]));
}

/** Nombre de demandes en attente que je peux traiter (Accueil → Mes actions). Sans service : administrateurs. */
export async function countReviewableAccessRequests(service: Service, userId: string, isAdmin: boolean): Promise<number> {
  if (isAdmin) {
    const { count } = await service.from("account_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
    return count ?? 0;
  }
  const { data } = await service.from("account_requests").select("service_key").eq("status", "pending").not("service_key", "is", null);
  if (!data?.length) return 0;
  const mine = await reviewableServices(service, userId);
  return data.filter((r) => r.service_key && mine.has(r.service_key)).length;
}

/**
 * Relance (une fois) les demandes sans réponse depuis ESCALATE_AFTER_DAYS jours : au N+2 du service
 * (N+1 du responsable) s'il existe, sinon aux administrateurs. Appelé chaque matin par le cron
 * daily-digest. Renvoie le nombre de demandes relancées.
 */
export async function escalateAccessRequests(service: Service): Promise<number> {
  const before = new Date(Date.now() - ESCALATE_AFTER_DAYS * 86_400_000).toISOString();
  const { data: stale } = await service
    .from("account_requests")
    .select("id, first_name, last_name, role_requested, service_key, created_at")
    .eq("status", "pending")
    .is("escalated_at", null)
    .lt("created_at", before);
  if (!stale?.length) return 0;

  const { data: admins } = await service.from("profiles").select("id").in("role", ["admin", "super_user"]);
  const adminIds = (admins ?? []).map((a) => a.id);
  let done = 0;
  for (const r of stale) {
    let recipients: string[] = [];
    if (r.service_key) {
      const { data: chain } = await service.rpc("service_chain" as never, { p_service: r.service_key } as never);
      recipients = ((chain ?? []) as { level: number; user_id: string }[]).filter((c) => c.level === 2).map((c) => c.user_id);
    }
    if (!recipients.length) recipients = adminIds;
    if (recipients.length) {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000);
      const { error } = await service.from("notifications").insert(
        recipients.map((id) => ({
          user_id: id,
          type: "account_request" as const,
          title: "Demande de compte en attente",
          message: `${r.first_name} ${r.last_name} (${accessKindLabel(r.role_requested).toLowerCase()}) attend une réponse depuis ${days} jours — Accueil → Mes actions.`,
          data: { kind: "account_request", escalated: true },
        }))
      );
      if (error) {
        console.error("[account-requests.escalate]", error);
        continue;
      }
    }
    await service.from("account_requests").update({ escalated_at: new Date().toISOString() }).eq("id", r.id);
    done++;
  }
  return done;
}
