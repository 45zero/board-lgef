"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, Mail, MinusCircle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  deleteExpenseMailRule,
  getExpenseMailSettings,
  runMyExpenseMailRules,
  saveExpenseMailRule,
  type MailImport,
  type MailRule,
  type MailRuleInput,
} from "@/app/actions/expense-mail";
import { Toggle } from "@/components/board/Toggle";
import { formatEuros } from "@/components/board/expenses/ExpenseStatus";

type Settings = Awaited<ReturnType<typeof getExpenseMailSettings>>;

const input = "w-full min-w-0 rounded-btn border border-line bg-card px-2.5 py-1.5 text-sm outline-none focus:border-link";
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** « Nom <adresse> » → « Nom ». */
const senderName = (from: string | null) => (from ?? "").replace(/<[^>]*>/, "").replace(/"/g, "").trim() || from || "—";

/** Formulaire d'une règle (création ou modification). */
function RuleForm({
  accounts,
  rule,
  onCancel,
  onSaved,
}: {
  accounts: Settings["accounts"];
  rule: MailRule | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<MailRuleInput>({
    accountId: rule?.account_id ?? accounts[0]?.id ?? "",
    label: rule?.label ?? "",
    fromFilter: rule?.from_filter ?? "",
    subjectFilter: rule?.subject_filter ?? "",
    matchEvents: rule?.match_events ?? false,
    enabled: rule?.enabled ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (p: Partial<MailRuleInput>) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await saveExpenseMailRule(rule?.id ?? null, form);
    setBusy(false);
    if (res.error) return setError(res.error);
    onSaved();
  };

  return (
    <div className="space-y-3 rounded-btn border border-link/40 bg-subtle p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-ink-3">
          Nom de la règle
          <input value={form.label} onChange={(e) => patch({ label: e.target.value })} placeholder="ex. Factures SNCF" className={`${input} mt-1`} />
        </label>
        <label className="block text-xs font-semibold text-ink-3">
          Boîte Gmail lue
          <select value={form.accountId} onChange={(e) => patch({ accountId: e.target.value })} className={`${input} mt-1`}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-ink-3">
          Expéditeur (adresse ou domaine)
          <input value={form.fromFilter} onChange={(e) => patch({ fromFilter: e.target.value })} placeholder="ex. factures@sncf.fr ou free.fr" className={`${input} mt-1`} />
        </label>
        <label className="block text-xs font-semibold text-ink-3">
          Le sujet contient
          <input value={form.subjectFilter} onChange={(e) => patch({ subjectFilter: e.target.value })} placeholder="ex. facture" className={`${input} mt-1`} />
        </label>
      </div>
      <label className="flex items-start gap-3 text-sm text-ink-2">
        <Toggle on={form.matchEvents} onClick={() => patch({ matchEvents: !form.matchEvents })} />
        <span>
          Rattacher à un événement quand c&rsquo;est évident
          <span className="block text-xs text-ink-4">Sinon, la facture est rangée dans les frais hors événement du mois de sa date.</span>
        </span>
      </label>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-btn border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-hover">
          Annuler
        </button>
        <button onClick={save} disabled={busy} className="rounded-btn bg-navy px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
          {busy ? "…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

function ImportRow({ i }: { i: MailImport }) {
  const icon =
    i.status === "imported" ? (
      <Check size={14} className="text-good" />
    ) : i.status === "ignored" ? (
      <MinusCircle size={14} className="text-ink-4" />
    ) : (
      <AlertCircle size={14} className="text-bad" />
    );
  return (
    <div className="flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{i.mail_subject || "(sans objet)"}</div>
        <div className="truncate text-[11px] text-ink-4">
          {senderName(i.mail_from)}
          {i.attachment_name && ` · ${i.attachment_name}`}
          {i.detail && i.status !== "imported" && ` · ${i.detail}`}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {i.status === "imported" && i.total != null && <div className="text-sm font-bold text-ink">{formatEuros(Number(i.total))}</div>}
        <div className="text-[10px] text-ink-4">{fmtDateTime(i.created_at)}</div>
      </div>
    </div>
  );
}

/**
 * Frais → Paramètres : factures reçues par e-mail. Chaque règle lit une boîte Gmail connectée ; les
 * pièces jointes des mails qui correspondent sont lues par Claude et ajoutées aux frais comme un
 * justificatif déposé à la main (vérification toutes les 15 minutes).
 */
export function ExpenseMailSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MailRule | "new" | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getExpenseMailSettings()
        .then((s) => {
          setSettings(s);
          setLoadError(null);
        })
        .catch(() => setLoadError("Chargement impossible.")),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);

  const saved = () => {
    setEditing(null);
    void load();
  };

  const toggle = async (rule: MailRule) => {
    const res = await saveExpenseMailRule(rule.id, {
      accountId: rule.account_id,
      label: rule.label,
      fromFilter: rule.from_filter,
      subjectFilter: rule.subject_filter,
      matchEvents: rule.match_events,
      enabled: !rule.enabled,
    });
    if (res.error) alert(res.error);
    void load();
  };

  const remove = async (rule: MailRule) => {
    if (!confirm(`Supprimer la règle « ${rule.label || rule.from_filter || rule.subject_filter} » ? Les frais déjà importés restent.`)) return;
    const res = await deleteExpenseMailRule(rule.id);
    if (res.error) alert(res.error);
    void load();
  };

  const runNow = async () => {
    setRunning(true);
    setRunResult(null);
    const res = await runMyExpenseMailRules();
    setRunning(false);
    setRunResult(
      res.error
        ? res.error
        : res.imported
          ? `${res.imported} facture${res.imported > 1 ? "s" : ""} ajoutée${res.imported > 1 ? "s" : ""} à vos frais (${formatEuros(res.total)}).`
          : "Aucune nouvelle facture."
    );
    void load();
  };

  if (loadError && !settings) return <p className="p-6 text-sm text-bad">{loadError}</p>;
  if (!settings) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;
  const { accounts, rules, imports } = settings;
  const activeCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="rounded-panel border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Mail size={17} className="text-navy" />
              <h3 className="text-sm font-extrabold text-ink">Factures reçues par e-mail</h3>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              Les factures (PDF ou photo en pièce jointe) des mails qui correspondent à une règle sont lues par Claude et ajoutées à vos frais, dans le mois
              de leur date, comme si vous les aviez déposées vous-même. Vérification toutes les 15 minutes ; seuls les mails reçus après la création de la
              règle sont pris. Vous les déclarez ensuite comme d&rsquo;habitude.
            </p>
          </div>
          {activeCount > 0 && (
            <button
              onClick={runNow}
              disabled={running}
              className="flex shrink-0 items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-hover disabled:opacity-50"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Vérifier maintenant
            </button>
          )}
        </div>
        {runResult && <p className="mt-3 rounded-btn bg-subtle px-3 py-2 text-xs text-ink-2">{runResult}</p>}

        {accounts.length === 0 ? (
          <p className="mt-4 rounded-btn border border-dashed border-line p-4 text-center text-sm text-ink-4">
            Connectez d&rsquo;abord votre boîte Gmail dans Paramètres → Comptes Google.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {rules.map((r) =>
              editing !== "new" && editing?.id === r.id ? (
                <RuleForm key={r.id} accounts={accounts} rule={r} onCancel={() => setEditing(null)} onSaved={saved} />
              ) : (
                <div key={r.id} className="flex items-start gap-3 rounded-btn border border-line p-3">
                  <Toggle on={r.enabled} onClick={() => void toggle(r)} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-bold ${r.enabled ? "text-ink" : "text-ink-4"}`}>{r.label || r.from_filter || r.subject_filter}</div>
                    <div className="mt-0.5 text-[11px] text-ink-3">
                      {r.from_filter && (
                        <>
                          De : <strong>{r.from_filter}</strong>
                        </>
                      )}
                      {r.from_filter && r.subject_filter && " · "}
                      {r.subject_filter && (
                        <>
                          Sujet : <strong>{r.subject_filter}</strong>
                        </>
                      )}
                      {r.match_events && " · rattachée aux événements"}
                    </div>
                    <div className="truncate text-[11px] text-ink-4">
                      {r.accountEmail ?? "Boîte déconnectée"}
                      {r.last_checked_at && ` · vérifiée ${fmtDateTime(r.last_checked_at)}`}
                    </div>
                    {r.last_error && <div className="mt-0.5 text-[11px] text-bad">{r.last_error}</div>}
                  </div>
                  <button onClick={() => setEditing(r)} title="Modifier" className="shrink-0 rounded-md p-1.5 text-ink-3 hover:bg-hover">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => void remove(r)} title="Supprimer" className="shrink-0 rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-bad">
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            )}
            {editing === "new" ? (
              <RuleForm accounts={accounts} rule={null} onCancel={() => setEditing(null)} onSaved={saved} />
            ) : (
              <button
                onClick={() => setEditing("new")}
                className="flex w-full items-center justify-center gap-1.5 rounded-btn border border-dashed border-line px-3 py-2.5 text-sm font-semibold text-link hover:bg-hover"
              >
                <Plus size={15} /> Ajouter une règle
              </button>
            )}
          </div>
        )}
      </section>

      {imports.length > 0 && (
        <section className="overflow-hidden rounded-panel border border-line bg-card">
          <div className="bg-subtle px-4 py-2 text-[11px] font-bold text-ink-3">Dernières factures traitées</div>
          {imports.map((i) => (
            <ImportRow key={i.id} i={i} />
          ))}
        </section>
      )}
    </div>
  );
}
