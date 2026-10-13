"use client";

import { useEffect, useState } from "react";
import { Send, Plus, Layers, Megaphone, ExternalLink } from "lucide-react";
import { unwrap } from "@/lib/board/actionResult";
import { formatBytes, type TransferPlanLimits } from "@/lib/transfer/shared";
import { getTransferContext, getTransferStats, type TransferStats } from "@/app/actions/transfers";
import { TransferUploader } from "@/components/transfer/TransferUploader";
import { TransferList } from "@/components/board/transfer/TransferList";
import { TransferPlansAdmin } from "@/components/board/transfer/TransferPlansAdmin";
import { TransferAdsAdmin } from "@/components/board/transfer/TransferAdsAdmin";

// Module « LGEF Transfer » du board : historique des transferts (filtres), envoi depuis le board
// (fichiers de l'ordinateur ou du Drive du board), et pour les admins formules, attributions et pubs.
// La page publique est /transfer (transfer.lgef.fr).

type Tab = "list" | "new" | "plans" | "ads";

const PUBLIC_URL = (process.env.NEXT_PUBLIC_TRANSFER_URL || "").replace(/\/+$/, "") || "/transfer";

export function TransferScreen() {
  const [tab, setTab] = useState<Tab>("list");
  const [ctx, setCtx] = useState<{ isAdmin: boolean; plan: TransferPlanLimits } | null>(null);
  const [stats, setStats] = useState<TransferStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    getTransferContext()
      .then((r) => {
        const c = unwrap(r);
        setCtx(c);
        if (c.isAdmin) void getTransferStats().then((s) => s.ok && setStats(s.data));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "LGEF Transfer est indisponible."));
  }, [refreshKey]);

  const tabs: { id: Tab; label: string; icon: typeof Send; show: boolean }[] = [
    { id: "list", label: "Transferts", icon: Send, show: true },
    { id: "new", label: "Nouveau transfert", icon: Plus, show: true },
    { id: "plans", label: "Formules", icon: Layers, show: !!ctx?.isAdmin },
    { id: "ads", label: "Publicités", icon: Megaphone, show: !!ctx?.isAdmin },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 rounded-btn px-3.5 py-2 text-sm font-semibold ${tab === t.id ? "bg-navy text-white" : "bg-card text-ink-2 hover:bg-hover"}`}
            >
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        <a href={PUBLIC_URL} target="_blank" rel="noopener" className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-link hover:underline">
          Page publique <ExternalLink size={12} />
        </a>
      </div>

      {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}

      {tab === "list" && (
        <>
          {stats && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Tile label="Transferts actifs" value={String(stats.active)} />
              <Tile label="Volume en ligne" value={formatBytes(stats.activeBytes)} />
              <Tile label="Envoyés (30 j)" value={String(stats.last30)} />
              <Tile label="Téléchargements (30 j)" value={String(stats.downloads30)} />
            </div>
          )}
          {ctx && <TransferList isAdmin={ctx.isAdmin} plan={ctx.plan} refreshKey={refreshKey} />}
        </>
      )}

      {/* Toujours monté : un envoi en cours continue si l'on passe sur un autre onglet. */}
      <div className={tab === "new" ? "mx-auto max-w-[460px]" : "hidden"}>
        <TransferUploader mode="board" onDone={() => setRefreshKey((k) => k + 1)} />
      </div>

      {tab === "plans" && ctx?.isAdmin && <TransferPlansAdmin />}
      {tab === "ads" && ctx?.isAdmin && <TransferAdsAdmin />}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold text-ink">{value}</p>
    </div>
  );
}
