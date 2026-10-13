"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { unwrap } from "@/lib/board/actionResult";
import { formatBytes } from "@/lib/transfer/shared";
import { getTransferAnalytics, type TransferAnalytics } from "@/app/actions/transfers";
import { PERIODS } from "@/components/board/transfer/TransferList";

// Onglet « Statistiques » de LGEF Transfer : ouvertures des liens (clics), téléchargements par
// document, personnes distinctes (visiteurs, expéditeurs membres / externes, destinataires).
// Admins : tout le board ou les leurs ; les autres : leurs transferts.

type Metric = "views" | "downloads" | "transfers";
const METRICS: { id: Metric; label: string }[] = [
  { id: "views", label: "Ouvertures des liens" },
  { id: "downloads", label: "Téléchargements" },
  { id: "transfers", label: "Transferts envoyés" },
];

const n = (v: number) => v.toLocaleString("fr-FR");

function bucketLabel(key: string, bucket: TransferAnalytics["bucket"], long = false) {
  if (bucket === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: long ? "long" : "short", year: "numeric" });
  }
  const d = new Date(`${key}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(long ? { year: "numeric" } : {}) });
  return bucket === "week" && long ? `Semaine du ${d}` : d;
}

export function TransferStats({ isAdmin }: { isAdmin: boolean }) {
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [period, setPeriod] = useState("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<TransferAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => (period === "custom" ? { from: from || undefined, to: to || undefined } : PERIODS.find((p) => p.id === period)!.range()), [period, from, to]);

  useEffect(() => {
    let alive = true;
    getTransferAnalytics({ scope, ...range })
      .then((r) => {
        if (!alive) return;
        setData(unwrap(r));
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope, range]);

  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && (
          <div className="flex rounded-btn bg-card p-0.5">
            {(
              [
                ["all", "Tout le board"],
                ["mine", "Les miens"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setLoading(true);
                  setScope(id);
                }}
                className={`rounded-btn px-3 py-1.5 text-xs font-bold ${scope === id ? "bg-navy text-white" : "text-ink-3 hover:bg-hover"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <select
          value={period}
          onChange={(e) => {
            setLoading(true);
            setPeriod(e.target.value);
          }}
          className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none"
          aria-label="Période"
        >
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {period === "custom" && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none" aria-label="Du" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none" aria-label="Au" />
          </>
        )}
        {loading && <Loader2 size={15} className="animate-spin text-ink-4" />}
      </div>

      {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}

      {t && data && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label="Clics sur les liens" value={n(t.views)} hint={`${n(t.uniqueVisitors)} personne${t.uniqueVisitors > 1 ? "s" : ""} distincte${t.uniqueVisitors > 1 ? "s" : ""}`} />
            <Tile label="Téléchargements" value={n(t.downloads)} hint={`par ${n(t.uniqueDownloaders)} personne${t.uniqueDownloaders > 1 ? "s" : ""}`} />
            <Tile label="Transferts envoyés" value={n(t.transfers)} hint={`${n(t.files)} fichiers · ${formatBytes(t.bytes)}`} />
            <Tile label="Expéditeurs" value={n(t.senders)} hint={`${n(t.memberSenders)} membre${t.memberSenders > 1 ? "s" : ""} · ${n(t.externalSenders)} externe${t.externalSenders > 1 ? "s" : ""}`} />
            <Tile label="Destinataires" value={n(t.recipients)} hint="adresses distinctes" />
            <Tile label="Taux de téléchargement" value={t.views ? `${Math.round((t.downloads / t.views) * 100)} %` : "—"} hint="téléchargements / ouvertures" />
            {data.ads && (
              <>
                <Tile label="Affichages des pubs" value={n(data.ads.impressions)} hint="depuis le début" />
                <Tile
                  label="Clics sur les pubs"
                  value={n(data.ads.clicks)}
                  hint={data.ads.impressions ? `${((data.ads.clicks / data.ads.impressions) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % de clic` : "—"}
                />
              </>
            )}
          </div>

          <ActivityChart data={data} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Table
              title="Documents les plus téléchargés"
              empty="Aucun téléchargement sur la période."
              head={["Document", "Téléch.", "Personnes"]}
              rows={data.topFiles.map((f) => ({
                key: f.id,
                cells: [
                  <div key="n" className="min-w-0">
                    <p className="truncate font-semibold text-ink">{f.name}</p>
                    <p className="truncate text-[11px] text-ink-4">
                      {f.transferTitle || "Sans titre"} · {f.sender} · {formatBytes(f.size)}
                    </p>
                  </div>,
                  n(f.downloads),
                  n(f.people),
                ],
              }))}
            />
            <Table
              title="Transferts les plus consultés"
              empty="Aucune ouverture sur la période."
              head={["Transfert", "Clics", "Pers.", "Téléch."]}
              rows={data.topTransfers.map((tr) => ({
                key: tr.id,
                cells: [
                  <a key="n" href={`/t/${tr.code}`} target="_blank" rel="noopener" className="group block min-w-0">
                    <p className="flex items-center gap-1 font-semibold text-ink group-hover:underline">
                      <span className="truncate">{tr.title}</span> <ExternalLink size={11} className="shrink-0 text-ink-4" />
                    </p>
                    <p className="truncate text-[11px] text-ink-4">{tr.sender}</p>
                  </a>,
                  n(tr.views),
                  n(tr.visitors),
                  n(tr.downloads),
                ],
              }))}
            />
          </div>

          <Table
            title="Expéditeurs"
            empty="Aucun transfert sur la période."
            head={["Personne", "Transferts", "Volume", "Téléch. reçus"]}
            rows={data.topSenders.map((s) => ({
              key: s.email,
              cells: [
                <div key="n" className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold text-ink">
                    <span className="truncate">{s.name || s.email}</span>
                    <span className={`shrink-0 rounded-chip px-1.5 text-[10px] font-bold ${s.member ? "bg-good-bg text-good" : "bg-chip-bg text-ink-3"}`}>{s.member ? "Membre" : "Externe"}</span>
                  </p>
                  {s.name && <p className="truncate text-[11px] text-ink-4">{s.email}</p>}
                </div>,
                n(s.transfers),
                formatBytes(s.bytes),
                n(s.downloads),
              ],
            }))}
          />

          <p className="text-[11px] text-ink-4">
            « Personnes » : visiteurs distincts, reconnus par une empreinte anonyme (aucune adresse IP n&rsquo;est conservée). Les aperçus automatiques des messageries et les robots ne sont pas comptés.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">{label}</p>
      <p className="mt-0.5 text-2xl font-extrabold text-ink">{value}</p>
      {hint && <p className="text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

/** Une seule série à la fois (choix de la mesure) : pas de double axe, une seule couleur. */
function ActivityChart({ data }: { data: TransferAnalytics }) {
  const [metric, setMetric] = useState<Metric>("views");
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.series.map((s) => s[metric]));
  // Haut de l'échelle arrondi (1, 2, 5 × 10ⁿ) : graduations lisibles.
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const top = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= max) ?? max;
  const label = METRICS.find((m) => m.id === metric)!.label;
  const unit = data.bucket === "day" ? "par jour" : data.bucket === "week" ? "par semaine" : "par mois";
  const labelEvery = Math.max(1, Math.ceil(data.series.length / 8));

  return (
    <section className="rounded-card border border-line bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-extrabold text-ink">
          {label} <span className="font-normal text-ink-4">{unit}</span>
        </h3>
        <div className="flex rounded-btn bg-subtle p-0.5">
          {METRICS.map((m) => (
            <button key={m.id} onClick={() => setMetric(m.id)} className={`rounded-btn px-2.5 py-1 text-xs font-bold ${metric === m.id ? "bg-card text-ink shadow-card" : "text-ink-3"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative h-48 w-8 shrink-0 text-right text-[10px] text-ink-4" aria-hidden>
          <span className="absolute right-0 top-0 -translate-y-1/2">{n(top)}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2">{n(top / 2)}</span>
          <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48" aria-hidden>
            {[0, 50, 100].map((p) => (
              <div key={p} className="absolute inset-x-0 border-t border-line" style={{ top: `${p}%` }} />
            ))}
          </div>
          <div className="relative flex h-48 items-end gap-[2px]" onMouseLeave={() => setHover(null)} aria-hidden>
            {data.series.map((s, i) => {
              const v = s[metric];
              return (
                <div key={s.key} className="relative flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(i)}>
                  <div className={`w-full rounded-t-[4px] ${hover === i ? "bg-red" : "bg-link"}`} style={{ height: v ? `${Math.max(2, (v / top) * 100)}%` : 0 }} />
                  {hover === i && (
                    <div
                      className={`pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-btn bg-navy px-2.5 py-1.5 text-[11px] text-white shadow-card ${i > data.series.length / 2 ? "right-0" : "left-0"}`}
                    >
                      <p className="font-bold">{bucketLabel(s.key, data.bucket, true)}</p>
                      <p>Ouvertures : {n(s.views)}</p>
                      <p>Téléchargements : {n(s.downloads)}</p>
                      <p>Transferts : {n(s.transfers)}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex gap-[2px] text-[10px] text-ink-4" aria-hidden>
            {data.series.map((s, i) => (
              <span key={s.key} className="min-w-0 flex-1 whitespace-nowrap">
                {i % labelEvery === 0 ? bucketLabel(s.key, data.bucket) : ""}
              </span>
            ))}
          </div>
          {/* Version tableau pour les lecteurs d'écran */}
          <table className="sr-only">
            <caption>
              {label} {unit}
            </caption>
            <tbody>
              {data.series.map((s) => (
                <tr key={s.key}>
                  <th scope="row">{bucketLabel(s.key, data.bucket, true)}</th>
                  <td>{s[metric]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Table({ title, head, rows, empty }: { title: string; head: string[]; rows: { key: string; cells: React.ReactNode[] }[]; empty: string }) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-card">
      <h3 className="border-b border-line bg-head px-4 py-2.5 text-sm font-extrabold text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-ink-4">{empty}</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-4">
              {head.map((h, i) => (
                <th key={h} className={`px-4 py-2 font-semibold ${i === 0 ? "" : "w-24 text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.key}>
                {r.cells.map((c, i) => (
                  <td key={i} className={`px-4 py-2 ${i === 0 ? "" : "text-right tabular-nums text-ink-2"}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
