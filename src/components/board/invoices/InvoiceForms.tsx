"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, FileUp, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createStandaloneInvoice, getPrestataireCompany, prepareStandaloneUpload, savePrestataireCompany } from "@/app/actions/staff";
import type { PrestataireCompany } from "@/lib/board/staff";

// Formulaires des factures de prestataires : facture sans intervention (forfait, matériel, traiteur…)
// et fiche société (raison sociale, SIRET, IBAN, domaines e-mail d'où arrivent ses factures).

const input = "w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm outline-none focus:border-line-strong";
const fieldLabel = "mb-1 block text-[11px] font-semibold text-ink-3";
const parseAmount = (v: string) => (v.trim() ? Number(v.replace(",", ".").replace(/\s|€/g, "")) : null);
const today = () => new Date().toISOString().slice(0, 10);

function Modal({ title, kicker, onClose, children, footer }: { title: string; kicker: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">{kicker}</div>
            <h3 className="mt-1 truncate text-base font-extrabold">{title}</h3>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1 text-white/80 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">{children}</div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

/**
 * Facture sans intervention. `people` (N+1, compta) : choisir pour quel prestataire on la saisit ;
 * sans `people`, c'est la mienne. Un doublon probable est signalé et se confirme d'un second clic.
 */
export function StandaloneInvoiceModal({ people, onClose, onSaved }: { people?: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [personId, setPersonId] = useState(people?.[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today);
  const [ttc, setTtc] = useState("");
  const [ht, setHt] = useState("");
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ file: File; forUserId: string | null; path: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const amountTtc = parseAmount(ttc);
    const amountHt = parseAmount(ht);
    if (people && !personId) return setError("Choisissez le prestataire.");
    if (!label.trim()) return setError("Indiquez l'objet de la facture.");
    if (!file) return setError("Joignez le fichier de la facture.");
    if (amountTtc === null || !Number.isFinite(amountTtc)) return setError("Indiquez le montant TTC.");
    if (amountHt !== null && !Number.isFinite(amountHt)) return setError("Montant HT invalide.");
    setBusy(true);
    setError(null);
    const forUserId = people ? personId : null;
    try {
      // Fichier envoyé une seule fois, même si l'on confirme un doublon ensuite.
      let path = uploaded && uploaded.file === file && uploaded.forUserId === forUserId ? uploaded.path : null;
      if (!path) {
        const prep = await prepareStandaloneUpload(forUserId, file.name, file.type, file.size);
        if (!prep.ok) throw new Error(prep.error);
        const { error: upErr } = await createClient().storage.from("invoices").uploadToSignedUrl(prep.data.path, prep.data.uploadToken, file, { contentType: file.type });
        if (upErr) throw new Error(upErr.message);
        path = prep.data.path;
        setUploaded({ file, forUserId, path });
      }
      const res = await createStandaloneInvoice({ forUserId, path, label, invoiceNumber: number, invoiceDate: date, amountTtc, amountHt, comment, force: !!duplicate });
      if (!res.ok) {
        if (res.error.startsWith("DOUBLON")) return setDuplicate(res.error.replace(/^DOUBLON : /, ""));
        throw new Error(res.error);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible, réessayez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      kicker="Facture hors intervention"
      title={people ? "Saisir une facture de prestataire" : "Déposer une facture"}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm font-semibold text-ink-2 hover:bg-hover">
            Annuler
          </button>
          <button onClick={() => void submit()} disabled={busy} className="flex items-center gap-1.5 rounded-btn bg-red px-4 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />} {duplicate ? "Enregistrer quand même" : "Déposer"}
          </button>
        </>
      }
    >
      <p className="text-xs text-ink-3">Pour une facture qui ne correspond à aucun événement du calendrier : forfait, matériel, prestation de traiteur… Elle part ensuite en validation.</p>
      {people && (
        <label className="block">
          <span className={fieldLabel}>Prestataire</span>
          <select value={personId} onChange={(e) => setPersonId(e.target.value)} className={input}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className={fieldLabel}>Objet</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. Buffet séminaire des arbitres" className={input} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={fieldLabel}>N° de facture</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="ex. F2026-118" className={input} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Date de la facture</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Montant TTC (€)</span>
          <input value={ttc} onChange={(e) => setTtc(e.target.value)} inputMode="decimal" className={`${input} text-right`} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Montant HT (€, facultatif)</span>
          <input value={ht} onChange={(e) => setHt(e.target.value)} inputMode="decimal" className={`${input} text-right`} />
        </label>
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-btn border-2 border-dashed border-line-strong px-3 py-3 text-sm font-semibold text-ink-2 hover:bg-hover"
      >
        {file ? <Check size={16} className="text-good" /> : <FileUp size={16} />} {file ? file.name : "Choisir le fichier de la facture (PDF ou photo)"}
      </button>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Commentaire (facultatif)" className={input} />
      {duplicate && (
        <p className="rounded-btn bg-warn-bg px-3 py-2 text-xs font-semibold text-warn">
          Doublon possible : {duplicate} Vérifiez avant de l&rsquo;enregistrer quand même.
        </p>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
    </Modal>
  );
}

/** Fiche société d'un prestataire (`userId` vide : la mienne). */
export function CompanyModal({ userId, name, onClose }: { userId: string | null; name: string; onClose: () => void }) {
  const [company, setCompany] = useState<PrestataireCompany | null>(null);
  const [domains, setDomains] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getPrestataireCompany(userId).then((res) => {
      if (!res.ok) return setError(res.error);
      setCompany(res.data);
      setDomains(res.data.mailDomains.join(", "));
    });
  }, [userId]);

  const set = (k: keyof Omit<PrestataireCompany, "mailDomains">) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setCompany((c) => (c ? { ...c, [k]: e.target.value } : c));

  const save = async () => {
    if (!company) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await savePrestataireCompany(userId, { ...company, mailDomains: domains.split(/[,;\s]+/).filter(Boolean) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(true);
  };

  return (
    <Modal
      kicker="Fiche société"
      title={name}
      onClose={onClose}
      footer={
        <>
          {saved && (
            <span className="mr-auto flex items-center gap-1 text-xs font-semibold text-good">
              <Check size={13} /> Enregistrée
            </span>
          )}
          <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm font-semibold text-ink-2 hover:bg-hover">
            Fermer
          </button>
          <button onClick={() => void save()} disabled={busy || !company} className="flex items-center gap-1.5 rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />} Enregistrer
          </button>
        </>
      }
    >
      {!company ? (
        error ? <p className="text-xs text-bad">{error}</p> : <div className="text-sm text-ink-4">Chargement…</div>
      ) : (
        <>
          <label className="block">
            <span className={fieldLabel}>Raison sociale</span>
            <input value={company.companyName} onChange={set("companyName")} className={input} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={fieldLabel}>SIRET (14 chiffres)</span>
              <input value={company.siret} onChange={set("siret")} inputMode="numeric" className={input} />
            </label>
            <label className="block">
              <span className={fieldLabel}>N° de TVA</span>
              <input value={company.vatNumber} onChange={set("vatNumber")} className={input} />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabel}>IBAN</span>
            <input value={company.iban} onChange={set("iban")} className={`${input} font-mono`} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Adresse de facturation</span>
            <textarea value={company.billingAddress} onChange={set("billingAddress")} rows={2} className={`${input} resize-none`} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Ses factures arrivent par e-mail depuis (domaines, séparés par des virgules)</span>
            <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="ex. traiteurmarie.com" className={input} />
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
        </>
      )}
    </Modal>
  );
}
