"use server";

import { toResult, unwrap } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getTransferMember } from "@/lib/transfer/session";
import { transferAccessFor } from "@/lib/transfer/access";
import { transferLink } from "@/lib/transfer/core";
import { addTeamCardComment } from "@/app/actions/team";
import { attachTeamFilesFromTransfer } from "@/app/actions/team-attachments";

// Transferts LGEF Transfer joints aux cartes de l'Espace Team (sql/2026-10-19_transfer_forwards_cards.sql).
// Joindre copie les fichiers dans la carte (ils restent après l'expiration du lien) et laisse un
// commentaire, qui prévient le créateur et les assignés de la carte. Droits : voir le transfert
// (expéditeur, admin, destinataire, ou on me l'a fait suivre) et pouvoir modifier la carte.

export type TeamCardTransferFile = { id: string; name: string; mimeType: string; size: number };

const toFiles = (raw: unknown): TeamCardTransferFile[] =>
  Array.isArray(raw)
    ? raw.flatMap((f) =>
        f && typeof f === "object" && typeof f.id === "string" && typeof f.name === "string"
          ? [{ id: f.id, name: f.name, mimeType: typeof f.mimeType === "string" ? f.mimeType : "application/octet-stream", size: typeof f.size === "number" ? f.size : 0 }]
          : []
      )
    : [];

export type TeamCardTransfer = {
  id: string;
  transferId: string | null;
  code: string;
  link: string;
  title: string;
  sender: string;
  fileCount: number;
  totalBytes: number;
  filesCopied: number;
  /** Copies dans la carte (aperçu et téléchargement via les pièces jointes de la carte). */
  files: TeamCardTransferFile[];
  linkedBy: string | null;
  linkedAt: string;
  /** État actuel du lien (null : transfert supprimé). */
  live: { active: boolean; expiresAt: string | null } | null;
};

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return { supabase, userId };
}

async function member() {
  const m = await getTransferMember();
  if (!m) throw new Error("Non authentifié");
  return m;
}

/**
 * Joint un transfert à une carte. copyFiles : copie les fichiers dans les pièces jointes de la carte.
 * Renvoie les fichiers non copiés ; alreadyLinked si le transfert y était déjà.
 */
export const linkTransferToTeamCard = async (cardId: string, transferId: string, opts: { copyFiles: boolean }) =>
  toResult(async (): Promise<{ alreadyLinked: boolean; copied: number; failed: string[] }> => {
    const { supabase, userId } = await session();
    const { t } = await transferAccessFor(await member(), transferId);
    const { error } = await supabase.from("team_card_transfers").insert({
      card_id: cardId,
      transfer_id: t.id,
      linked_by: userId,
      code: t.code,
      title: t.title,
      sender_email: t.sender_email,
      sender_name: t.sender_name,
      file_count: t.file_count,
      total_bytes: t.total_bytes,
    });
    if (error?.code === "23505") return { alreadyLinked: true, copied: 0, failed: [] };
    if (error) throw new Error(error.code === "42501" ? "Vous ne pouvez pas modifier cette carte." : error.message);
    const { copied: files, failed } = opts.copyFiles ? unwrap(await attachTeamFilesFromTransfer(cardId, transferId)) : { copied: [], failed: [] };
    const copied = files.length;
    if (copied) await createServiceClient().from("team_card_transfers").update({ files_copied: copied, files }).eq("card_id", cardId).eq("transfer_id", transferId);
    const what = t.title ? `« ${t.title} »` : `${t.file_count} fichier${t.file_count > 1 ? "s" : ""}`;
    const from = t.sender_name || t.sender_email;
    const copiedNote = copied ? ` — ${copied} fichier${copied > 1 ? "s" : ""} copié${copied > 1 ? "s" : ""} dans les pièces jointes` : "";
    // Trace dans la discussion de la carte (et notification des assignés), sans bloquer la liaison.
    await addTeamCardComment(cardId, `Transfert LGEF Transfer joint : ${what}, envoyé par ${from}${copiedNote}.`).catch(() => undefined);
    return { alreadyLinked: false, copied, failed };
  });

export const listTeamCardTransfers = async (cardId: string) =>
  toResult(async (): Promise<TeamCardTransfer[]> => {
    const { supabase } = await session();
    const { data, error } = await supabase.from("team_card_transfers").select("*").eq("card_id", cardId).order("linked_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((r) => r.transfer_id).filter((x): x is string => !!x);
    // État du lien lu en service : la carte est visible, le transfert ne l'est pas forcément sous RLS.
    const { data: live } = ids.length ? await createServiceClient().from("transfers").select("id, status, expires_at").in("id", ids) : { data: [] };
    const byId = new Map((live ?? []).map((t) => [t.id, t]));
    return (data ?? []).map((r) => {
      const t = r.transfer_id ? byId.get(r.transfer_id) : undefined;
      return {
        id: r.id,
        transferId: r.transfer_id,
        code: r.code,
        link: transferLink(r.code),
        title: r.title,
        sender: r.sender_name || r.sender_email,
        fileCount: r.file_count,
        totalBytes: r.total_bytes,
        filesCopied: r.files_copied,
        files: toFiles(r.files),
        linkedBy: r.linked_by,
        linkedAt: r.linked_at,
        live: t ? { active: t.status === "ready" && (!t.expires_at || new Date(t.expires_at).getTime() > Date.now()), expiresAt: t.expires_at } : null,
      };
    });
  });

/** Transfert joint sans copie : copie ses fichiers dans la carte maintenant (lien encore actif). */
export const copyTeamCardTransferFiles = async (id: string) =>
  toResult(async (): Promise<{ copied: number; failed: string[] }> => {
    const { supabase } = await session();
    const { data: row } = await supabase.from("team_card_transfers").select("card_id, transfer_id, files").eq("id", id).maybeSingle();
    if (!row) throw new Error("Transfert introuvable sur cette carte.");
    if (!row.transfer_id) throw new Error("Le transfert a été supprimé : ses fichiers ne peuvent plus être copiés.");
    const { copied, failed } = unwrap(await attachTeamFilesFromTransfer(row.card_id, row.transfer_id));
    const files = [...toFiles(row.files), ...copied];
    if (copied.length) await createServiceClient().from("team_card_transfers").update({ files_copied: files.length, files }).eq("id", id);
    return { copied: copied.length, failed };
  });

/** Délie le transfert de la carte (les fichiers copiés restent dans la carte). */
export const unlinkTeamCardTransfer = async (id: string) =>
  toResult(async () => {
    const { supabase } = await session();
    const { data, error } = await supabase.from("team_card_transfers").delete().eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Vous ne pouvez pas délier ce transfert.");
  });
