"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, FolderPlus, X, Eye, Loader2, Check, Copy, Link2, Mail, HardDrive, Search, ShieldCheck, Upload } from "lucide-react";
import { durationChoices, durationLabel, fileKind, formatBytes, GB, isEmail, type TransferPlanLimits, type UploadTarget } from "@/lib/transfer/shared";
import { uploadFileToTransfer } from "@/lib/transfer/uploadClient";
import { KindIcon, LocalPreviewModal, LocalThumb } from "@/components/transfer/FilePreview";
import { searchTransferDriveFiles, type DriveFileForTransfer } from "@/app/actions/transfers";

// Formulaire d'envoi de LGEF Transfer — page publique (transfer.lgef.fr) et onglet du board.
// Les fichiers partent du navigateur vers le Drive du board (voir src/lib/transfer/uploadClient.ts).
// Sans compte : l'adresse de l'expéditeur est vérifiée par un code e-mail (jeton gardé 24 h).

type Step = "compose" | "verify" | "sending" | "done";
type Item = { key: string; file: File; name: string };
type Session = { member: { email: string; name: string } | null; plan: TransferPlanLimits };

const TOKEN_KEY = "lgef-transfer-sender";

function readSender(): { email: string; token: string; plan: TransferPlanLimits; exp: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "null");
    return v && v.exp > Date.now() ? v : null;
  } catch {
    return null;
  }
}
function writeSender(v: { email: string; token: string; plan: TransferPlanLimits } | null) {
  try {
    if (v) localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...v, exp: Date.now() + 23 * 3600_000 }));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // stockage indisponible (navigation privée) : on redemandera le code
  }
}

const limitText = (p: TransferPlanLimits) =>
  `Formule ${p.name} · ${p.maxSizeBytes === null ? "taille illimitée" : `jusqu'à ${Math.round(p.maxSizeBytes / GB)} Go`} · ${p.maxDays === null ? "durée libre" : `${p.maxDays} jours max.`}`;

export function TransferUploader({ mode, onDone }: { mode: "public" | "board"; onDone?: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFileForTransfer[]>([]);
  const [sendMode, setSendMode] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [daysChoice, setDays] = useState<number | null>(7);
  const [archivedChoice, setArchived] = useState(false);
  const [notify, setNotify] = useState(true);
  const [plan, setPlan] = useState<TransferPlanLimits | null>(null);

  const [step, setStep] = useState<Step>("compose");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(0);
  const [current, setCurrent] = useState("");
  const [speed, setSpeed] = useState(0);
  const [result, setResult] = useState<{ link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speedRef = useRef<{ t: number; bytes: number }>({ t: 0, bytes: 0 });

  useEffect(() => {
    void fetch("/api/transfer/session")
      .then((r) => r.json())
      .then((s: Session) => {
        setSession(s);
        if (s.member) {
          setEmail(s.member.email);
          setName(s.member.name);
          setPlan(s.plan);
        } else {
          const stored = readSender();
          if (stored) {
            setEmail(stored.email);
            setPlan(stored.plan);
          } else setPlan(s.plan);
        }
      })
      .catch(() => setError("LGEF Transfer est momentanément indisponible."));
  }, []);

  // Avertit avant de quitter la page pendant un envoi.
  useEffect(() => {
    if (step !== "sending") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [step]);

  // Durée choisie ramenée aux choix de la formule (7 jours, sinon son maximum) ; archivage selon la formule.
  const choices = durationChoices(plan?.maxDays ?? 7);
  const days = choices.includes(daysChoice) ? daysChoice : choices.includes(7) ? 7 : choices[choices.length - 1];
  const archived = archivedChoice && !!plan?.canArchive;

  const totalBytes = useMemo(() => items.reduce((n, i) => n + i.file.size, 0) + driveFiles.reduce((n, f) => n + f.size, 0), [items, driveFiles]);
  const fileCount = items.length + driveFiles.length;
  const overLimit = !!plan && plan.maxSizeBytes !== null && totalBytes > plan.maxSizeBytes;

  const addFiles = useCallback((list: FileList | File[] | null, fromFolder = false) => {
    if (!list) return;
    const next = Array.from(list).map((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return { key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, name: fromFolder && rel ? rel.replace(/\//g, " - ") : file.name };
    });
    setItems((cur) => [...cur, ...next]);
    setError(null);
  }, []);

  const commitRecipients = (raw: string) => {
    const parts = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const valid = parts.filter(isEmail);
    if (valid.length) setRecipients((r) => [...new Set([...r, ...valid])].slice(0, 50));
    setRecipientDraft(parts.filter((p) => !isEmail(p)).join(" "));
  };

  const validate = () => {
    if (!fileCount) return "Ajoutez au moins un fichier.";
    if (!isEmail(email)) return "Indiquez votre adresse e-mail.";
    if (sendMode === "email" && recipientDraft.trim()) return "Une adresse de destinataire est invalide.";
    if (sendMode === "email" && !recipients.length) return "Ajoutez au moins un destinataire.";
    if (overLimit && plan) return `Votre formule « ${plan.name} » permet ${Math.round((plan.maxSizeBytes ?? 0) / GB)} Go par transfert.`;
    return null;
  };

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/transfer/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setStep("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi du code impossible.");
    } finally {
      setBusy(false);
    }
  };

  const send = async (senderToken?: string, verifiedPlan?: TransferPlanLimits) => {
    const p = verifiedPlan ?? plan;
    if (p && p.maxSizeBytes !== null && totalBytes > p.maxSizeBytes) {
      setStep("compose");
      return setError(`Votre formule « ${p.name} » permet ${Math.round(p.maxSizeBytes / GB)} Go par transfert.`);
    }
    if (p && p.maxDays !== null && (days === null || days > p.maxDays)) {
      setStep("compose");
      return setError(`Votre formule « ${p.name} » permet ${p.maxDays} jours au maximum — choisissez une durée plus courte.`);
    }
    setError(null);
    setStep("sending");
    setSent(0);
    setSpeed(0);
    speedRef.current = { t: Date.now(), bytes: 0 };
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/transfer/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          senderEmail: email,
          senderName: name,
          senderToken,
          fromBoard: mode === "board",
          title,
          message,
          recipients: sendMode === "email" ? recipients : [],
          days,
          archived,
          notifyOnDownload: notify,
          files: items.map((i) => ({ name: i.name, mimeType: i.file.type, size: i.file.size })),
          boardFileIds: driveFiles.map((f) => f.id),
        }),
      });
      const created = await res.json();
      if (created.reason === "verify") {
        writeSender(null);
        setStep("compose");
        return void requestCode();
      }
      if (!created.ok) throw new Error(created.error);

      // Les sessions d'envoi arrivent dans l'ordre des fichiers.
      const targets = created.targets as UploadTarget[];
      const scope = { id: created.transferId as string, token: created.uploadToken as string };
      const uploaded: { fileRowId: string; driveFileId: string }[] = [];
      let done = driveFiles.reduce((n, f) => n + f.size, 0);
      for (let i = 0; i < targets.length; i++) {
        const item = items[i];
        setCurrent(item.name);
        const base = done;
        const driveFileId = await uploadFileToTransfer({
          file: item.file,
          target: targets[i],
          scope,
          signal: ctrl.signal,
          onProgress: (inFile) => {
            const total = base + inFile;
            setSent(total);
            const now = Date.now();
            const dt = (now - speedRef.current.t) / 1000;
            if (dt >= 1) {
              setSpeed(Math.max(0, (total - speedRef.current.bytes) / dt));
              speedRef.current = { t: now, bytes: total };
            }
          },
        });
        uploaded.push({ fileRowId: targets[i].fileRowId, driveFileId });
        done += item.file.size;
      }
      setSent(totalBytes);
      setCurrent("Finalisation…");
      const fin = await fetch("/api/transfer/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferId: scope.id, token: scope.token, uploaded }),
      }).then((r) => r.json());
      if (!fin.ok) throw new Error(fin.error);
      setResult({ link: fin.link });
      setStep("done");
      onDone?.();
    } catch (e) {
      setStep("compose");
      setError(ctrl.signal.aborted ? "Envoi annulé." : e instanceof Error ? e.message : "Envoi interrompu, réessayez.");
    } finally {
      abortRef.current = null;
    }
  };

  const submit = () => {
    const problem = validate();
    if (problem) return setError(problem);
    if (session?.member) return void send();
    const stored = readSender();
    if (stored && stored.email === email.trim().toLowerCase()) return void send(stored.token, stored.plan);
    void requestCode();
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/transfer/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const stored = { email: email.trim().toLowerCase(), token: json.senderToken as string, plan: json.plan as TransferPlanLimits };
      writeSender(stored);
      setPlan(stored.plan);
      if (!name && json.memberName) setName(json.memberName);
      setCode("");
      void send(stored.token, stored.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vérification impossible.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setItems([]);
    setDriveFiles([]);
    setRecipients([]);
    setTitle("");
    setMessage("");
    setResult(null);
    setSent(0);
    setStep("compose");
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.link).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ---------- Rendu ---------- */

  if (step === "done" && result) {
    return (
      <Card>
        <div className="space-y-4 p-6 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-good-bg text-good">
            <Check size={32} />
          </span>
          <div>
            <p className="text-lg font-extrabold text-ink">{sendMode === "email" ? "Transfert envoyé !" : "Votre lien est prêt !"}</p>
            <p className="mt-1 text-sm text-ink-3">
              {sendMode === "email" ? `Un e-mail est parti à ${recipients.length} destinataire${recipients.length > 1 ? "s" : ""}. ` : ""}
              Vous serez prévenu au premier téléchargement.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-btn border border-line bg-subtle px-3 py-2">
            <Link2 size={15} className="shrink-0 text-ink-4" />
            <span className="min-w-0 flex-1 truncate text-left text-sm text-ink">{result.link}</span>
            <button type="button" onClick={() => void copy()} className="flex shrink-0 items-center gap-1 rounded-btn bg-navy px-2.5 py-1.5 text-xs font-bold text-white">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copié" : "Copier"}
            </button>
          </div>
          <a href={result.link} target="_blank" rel="noopener" className="flex w-full items-center justify-center gap-2 rounded-btn border border-line-strong py-2.5 text-sm font-bold text-ink hover:bg-hover">
            <Eye size={15} /> Revoir mes fichiers
          </a>
          <button type="button" onClick={reset} className="flex w-full items-center justify-center gap-2 rounded-btn bg-red py-2.5 text-sm font-bold text-white shadow-btn-red hover:bg-red-700">
            <Plus size={15} /> Nouveau transfert
          </button>
        </div>
      </Card>
    );
  }

  if (step === "sending") {
    const pct = totalBytes ? Math.min(100, Math.round((sent / totalBytes) * 100)) : 0;
    const eta = speed > 0 ? Math.max(0, Math.round((totalBytes - sent) / speed)) : null;
    return (
      <Card>
        <div className="space-y-5 p-6 text-center">
          <div className="relative mx-auto h-36 w-36" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progression de l'envoi">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="44" fill="none" stroke="var(--track)" strokeWidth="8" />
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="var(--red)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 276.5} 276.5`}
                className="transition-[stroke-dasharray] duration-500"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-3xl font-extrabold text-ink">{pct}%</span>
          </div>
          <div>
            <p className="font-bold text-ink">Envoi en cours…</p>
            <p className="mt-1 truncate text-xs text-ink-3">{current}</p>
            <p className="mt-1 text-xs text-ink-4">
              {formatBytes(sent)} sur {formatBytes(totalBytes)}
              {speed > 0 && ` · ${formatBytes(speed)}/s`}
              {eta !== null && eta > 0 && ` · ${eta > 90 ? `${Math.round(eta / 60)} min` : `${eta} s`} restantes`}
            </p>
          </div>
          <p className="rounded-btn bg-subtle px-3 py-2 text-xs text-ink-3">Gardez cette page ouverte. En cas de coupure, l&rsquo;envoi reprend tout seul.</p>
          <button type="button" onClick={() => abortRef.current?.abort()} className="text-sm font-semibold text-ink-3 underline hover:text-bad">
            Annuler
          </button>
        </div>
      </Card>
    );
  }

  if (step === "verify") {
    return (
      <Card>
        <div className="space-y-4 p-6">
          <div className="text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sel-bg text-link">
              <ShieldCheck size={24} />
            </span>
            <p className="text-lg font-extrabold text-ink">Vérifiez votre adresse</p>
            <p className="mt-1 text-sm text-ink-3">
              Code envoyé à <b className="text-ink">{email}</b>
            </p>
          </div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && code.length === 6 && void verify()}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="••••••"
            aria-label="Code à 6 chiffres"
            className="w-full rounded-btn border border-line-strong bg-card py-3 text-center text-2xl font-bold tracking-[0.5em] text-ink outline-none focus:border-navy"
          />
          {error && <p className="text-center text-xs text-bad">{error}</p>}
          <button
            type="button"
            onClick={() => void verify()}
            disabled={busy || code.length !== 6}
            className="flex w-full items-center justify-center gap-2 rounded-btn bg-red py-3 text-sm font-bold text-white shadow-btn-red disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Vérifier et envoyer
          </button>
          <div className="flex justify-between text-xs">
            <button type="button" onClick={() => void requestCode()} disabled={busy} className="font-semibold text-link hover:underline">
              Renvoyer le code
            </button>
            <button type="button" onClick={() => setStep("compose")} className="font-semibold text-ink-3 hover:underline">
              Modifier
            </button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
        className={drag ? "ring-4 ring-inset ring-red/40" : ""}
      >
        {/* Fichiers */}
        <div className="border-b border-line p-4">
          {fileCount === 0 ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-card border-2 border-dashed border-line-strong px-4 py-8 text-center hover:bg-hover"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red text-white shadow-btn-red">
                <Plus size={24} />
              </span>
              <span className="text-sm font-bold text-ink">Ajoutez vos fichiers</span>
              <span className="text-xs text-ink-4">Vidéos, photos, documents… ou glissez-les ici</span>
            </button>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {driveFiles.map((f) => (
                <li key={f.id} className="flex items-center gap-2.5 rounded-btn px-1 py-1">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-sel-bg text-link">
                    <HardDrive size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{f.name}</p>
                    <p className="text-[11px] text-ink-4">{formatBytes(f.size)} · Drive du board</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDriveFiles((l) => l.filter((x) => x.id !== f.id))}
                    className="rounded-full p-1.5 text-ink-4 hover:bg-hover hover:text-bad"
                    aria-label={`Retirer ${f.name}`}
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
              {items.map((i) => (
                <li key={i.key} className="flex items-center gap-2.5 rounded-btn px-1 py-1">
                  <button type="button" onClick={() => setPreview(i.file)} className="shrink-0" aria-label={`Aperçu de ${i.name}`}>
                    <LocalThumb file={i.file} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{i.name}</p>
                    <p className="text-[11px] text-ink-4">{formatBytes(i.file.size)}</p>
                  </div>
                  <button type="button" onClick={() => setPreview(i.file)} className="rounded-full p-1.5 text-ink-4 hover:bg-hover hover:text-ink" aria-label={`Aperçu de ${i.name}`} title="Aperçu">
                    <Eye size={15} />
                  </button>
                  <button type="button" onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))} className="rounded-full p-1.5 text-ink-4 hover:bg-hover hover:text-bad" aria-label={`Retirer ${i.name}`}>
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {fileCount > 0 && (
              <button type="button" onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 rounded-btn bg-chip-bg px-2.5 py-1.5 text-xs font-bold text-ink-2 hover:bg-hover">
                <Plus size={13} /> Fichiers
              </button>
            )}
            <button type="button" onClick={() => folderInput.current?.click()} className="flex items-center gap-1.5 rounded-btn bg-chip-bg px-2.5 py-1.5 text-xs font-bold text-ink-2 hover:bg-hover">
              <FolderPlus size={13} /> Dossier
            </button>
            {mode === "board" && (
              <button type="button" onClick={() => setPickerOpen(true)} className="flex items-center gap-1.5 rounded-btn bg-chip-bg px-2.5 py-1.5 text-xs font-bold text-ink-2 hover:bg-hover">
                <HardDrive size={13} /> Drive du board
              </button>
            )}
            {fileCount > 0 && (
              <span className={`ml-auto text-[11px] font-semibold ${overLimit ? "text-bad" : "text-ink-4"}`}>
                {fileCount} fichier{fileCount > 1 ? "s" : ""} · {formatBytes(totalBytes)}
              </span>
            )}
          </div>
          {plan && <p className="mt-2 text-[11px] text-ink-4">{limitText(plan)}</p>}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={(el) => {
              folderInput.current = el;
              el?.setAttribute("webkitdirectory", "");
            }}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files, true);
              e.target.value = "";
            }}
          />
        </div>

        {/* Mode */}
        <div className="flex gap-1 border-b border-line p-2">
          {(
            [
              ["email", Mail, "Envoyer par e-mail"],
              ["link", Link2, "Obtenir un lien"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSendMode(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-btn py-2 text-xs font-bold ${sendMode === id ? "bg-navy text-white" : "text-ink-3 hover:bg-hover"}`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Détails */}
        <div className="space-y-2.5 p-4">
          {sendMode === "email" && (
            <div className="rounded-btn border border-line px-2 py-1.5 focus-within:border-line-strong">
              <div className="flex flex-wrap gap-1">
                {recipients.map((r) => (
                  <span key={r} className="flex items-center gap-1 rounded-chip bg-sel-bg py-0.5 pl-2 pr-1 text-xs font-semibold text-link">
                    {r}
                    <button type="button" onClick={() => setRecipients((l) => l.filter((x) => x !== r))} aria-label={`Retirer ${r}`} className="rounded-full p-0.5 hover:bg-white/50">
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <input
                  value={recipientDraft}
                  onChange={(e) => (/[\s,;]$/.test(e.target.value) ? commitRecipients(e.target.value) : setRecipientDraft(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRecipients(recipientDraft);
                    } else if (e.key === "Backspace" && !recipientDraft && recipients.length) setRecipients((l) => l.slice(0, -1));
                  }}
                  onBlur={() => commitRecipients(recipientDraft)}
                  onPaste={(e) => {
                    e.preventDefault();
                    commitRecipients(`${recipientDraft} ${e.clipboardData.getData("text")}`);
                  }}
                  type="email"
                  placeholder={recipients.length ? "Ajouter…" : "E-mail des destinataires"}
                  aria-label="E-mail des destinataires"
                  className="min-w-[140px] flex-1 bg-transparent px-1 py-1 text-sm text-ink outline-none"
                />
              </div>
            </div>
          )}
          {session?.member ? (
            <p className="rounded-btn bg-subtle px-3 py-2 text-xs text-ink-3">
              Envoyé par <b className="text-ink">{session.member.name || session.member.email}</b>
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="Votre e-mail"
                aria-label="Votre e-mail"
                className="rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
              />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Votre nom (facultatif)"
                aria-label="Votre nom"
                className="rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
              />
            </div>
          )}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Titre (facultatif)"
            aria-label="Titre"
            className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            rows={3}
            placeholder="Message (facultatif)"
            aria-label="Message"
            className="w-full resize-none rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs text-ink-2">
            <label className="flex items-center gap-1.5">
              Disponible
              <select
                value={days === null ? "none" : String(days)}
                onChange={(e) => setDays(e.target.value === "none" ? null : Number(e.target.value))}
                className="rounded-btn border border-line bg-card px-1.5 py-1 text-xs font-semibold text-ink outline-none"
              >
                {choices.map((d) => (
                  <option key={d ?? "none"} value={d === null ? "none" : d}>
                    {durationLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-[var(--red)]" /> Me prévenir au téléchargement
            </label>
            {plan?.canArchive && (
              <label className="flex items-center gap-1.5" title="Les fichiers restent dans le Drive du board après expiration du lien">
                <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="accent-[var(--red)]" /> Archiver dans le Drive
              </label>
            )}
          </div>

          {error && <p className="rounded-btn bg-bad-bg px-3 py-2 text-xs text-bad">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={busy || !session || fileCount === 0}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-btn bg-red py-3 text-sm font-extrabold text-white shadow-btn-red hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {sendMode === "email" ? "Transférer" : "Obtenir un lien"}
          </button>
        </div>
      </div>

      {preview && <LocalPreviewModal file={preview} onClose={() => setPreview(null)} />}
      {pickerOpen && (
        <DrivePicker
          selected={driveFiles}
          onClose={() => setPickerOpen(false)}
          onToggle={(f) => setDriveFiles((l) => (l.some((x) => x.id === f.id) ? l.filter((x) => x.id !== f.id) : [...l, f]))}
        />
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-modal bg-card shadow-card">{children}</div>;
}

/** Choix de fichiers déjà présents dans le Drive du board (board uniquement) : envoyés sans être rechargés. */
function DrivePicker({ selected, onToggle, onClose }: { selected: DriveFileForTransfer[]; onToggle: (f: DriveFileForTransfer) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DriveFileForTransfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      searchTransferDriveFiles(query)
        .then((r) => {
          if (r.ok) {
            setResults(r.data);
            setError(null);
          } else setError(r.error);
        })
        .catch(() => setError("Recherche impossible."));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-t-modal bg-card shadow-card sm:rounded-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Drive du board"
      >
        <div className="flex items-center gap-2 border-b border-line p-3">
          <Search size={15} className="text-ink-4" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Rechercher dans le Drive du board…" className="flex-1 bg-transparent text-sm text-ink outline-none" />
          <button type="button" onClick={onClose} className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white">
            Terminé{selected.length ? ` (${selected.length})` : ""}
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {error && <li className="p-3 text-xs text-bad">{error}</li>}
          {!results && !error && (
            <li className="flex justify-center p-6 text-ink-4">
              <Loader2 size={18} className="animate-spin" />
            </li>
          )}
          {results?.length === 0 && <li className="p-6 text-center text-xs text-ink-4">Aucun fichier.</li>}
          {results?.map((f) => {
            const on = selected.some((x) => x.id === f.id);
            return (
              <li key={f.id}>
                <button type="button" onClick={() => onToggle(f)} className={`flex w-full items-center gap-2.5 rounded-btn px-2 py-2 text-left hover:bg-hover ${on ? "bg-sel-bg" : ""}`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-subtle text-ink-3">
                    <KindIcon kind={fileKind(f.mimeType, f.name)} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{f.name}</span>
                    <span className="block text-[11px] text-ink-4">
                      {formatBytes(f.size)} · {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString("fr-FR") : ""}
                    </span>
                  </span>
                  {on ? <Check size={16} className="text-good" /> : <Plus size={16} className="text-ink-4" />}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line px-3 py-2 text-[11px] text-ink-4">Ces fichiers restent dans le Drive du board : ils sont partagés sans être rechargés.</p>
      </div>
    </div>
  );
}
