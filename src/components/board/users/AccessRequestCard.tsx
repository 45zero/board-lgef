"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Check, Forward, Video } from "lucide-react";
import {
  approveAccessRequest,
  forwardAccessRequest,
  getAccessReviewScope,
  listManagerOptions,
  rejectAccessRequest,
  type AccessRequest,
} from "@/app/actions/account-requests";
import { unwrap } from "@/lib/board/actionResult";
import { ROLE_LABELS, STATUS_LABELS, accessKindLabel, suggestionFor, type AccessStatus, type GrantableRole } from "@/lib/board/accessRequests";

const input = "w-full rounded-btn border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-navy";
const btnSmall = "flex items-center gap-1 rounded-btn px-2.5 py-1.5 text-xs font-bold disabled:opacity-50";
const fieldTitle = "text-[11px] font-bold uppercase tracking-wide text-ink-4";
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Une erreur est survenue.");

// Chargés une fois pour toutes les cartes affichées.
type ManagerOption = { id: string; name: string };
type Scope = {
  isAdmin: boolean;
  reviewable: string[];
  services: { key: string; label: string; managerId: string | null; managerName: string | null }[];
};
let managerOptions: Promise<ManagerOption[]> | null = null;
let reviewScope: Promise<Scope | null> | null = null;
const loadManagerOptions = () =>
  (managerOptions ??= listManagerOptions()
    .then(unwrap)
    .catch(() => {
      managerOptions = null;
      return [];
    }));
const loadScope = () =>
  (reviewScope ??= getAccessReviewScope()
    .then(unwrap)
    .catch(() => {
      reviewScope = null;
      return null;
    }));

/**
 * Demande de compte en attente : la personne dit qui elle est ; on l'affecte (service de rattachement,
 * rôle, pôles, statut, Couverture match, N+1) puis on accepte, ou on refuse, ou on transmet à un autre
 * service. Tout est prérempli d'après « Vous êtes » et le service demandé.
 */
export function AccessRequestCard({ request, onDone }: { request: AccessRequest; onDone: (message: string) => void }) {
  const suggestion = useMemo(() => suggestionFor(request.kind), [request.kind]);
  // Ancienneté de la demande, figée au montage (badge « n j » à partir de 3 jours).
  const [ageDays] = useState(() => Math.floor((Date.now() - new Date(request.createdAt).getTime()) / 86_400_000));
  const [scope, setScope] = useState<Scope | null>(null);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  useEffect(() => {
    void loadScope().then(setScope);
    void loadManagerOptions().then(setManagers);
  }, []);

  const [serviceKey, setServiceKey] = useState(request.serviceKey ?? "");
  const [role, setRole] = useState<GrantableRole>(suggestion.role);
  const [poles, setPoles] = useState<string[]>(request.serviceKey ? [request.serviceKey] : []);
  const [status, setStatus] = useState<AccessStatus | "">(suggestion.status ?? "");
  const [photo, setPhoto] = useState(suggestion.photo);
  const [video, setVideo] = useState(suggestion.video);
  const [managerId, setManagerId] = useState("");
  const [forwardTo, setForwardTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = `${request.firstName} ${request.lastName}`;
  const isAdmin = !!scope?.isAdmin;
  const services = scope?.services ?? [];
  const reviewable = new Set(scope?.reviewable ?? []);
  const assignable = isAdmin ? services : services.filter((s) => reviewable.has(s.key));
  const requested = services.find((s) => s.key === request.serviceKey);
  const chosen = services.find((s) => s.key === serviceKey);
  const roles: GrantableRole[] = isAdmin ? ["user", "technician", "organizer", "comite_directeur"] : ["user", "technician", "organizer"];

  // Changer de service : le pôle suit (on retire l'ancien s'il avait été posé d'office).
  const changeService = (next: string) => {
    setPoles((prev) => {
      const without = prev.filter((k) => k !== serviceKey);
      return next && !without.includes(next) ? [...without, next] : without;
    });
    setServiceKey(next);
  };
  const togglePole = (key: string) => setPoles((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  const approve = () =>
    act(async () => {
      const res = unwrap(
        await approveAccessRequest(request.id, {
          serviceKey: serviceKey || null,
          role,
          poles,
          status: status || null,
          photo,
          video,
          managerId: managerId || null,
        })
      );
      const where = chosen ? ` (${chosen.label})` : "";
      const who = photo || video ? `${name} ajouté à Couverture match${where}` : `Accès accordé à ${name}${where}`;
      return res.emailed ? `${who} — e-mail envoyé pour choisir son mot de passe.` : `${who} — l'e-mail n'a pas pu partir, prévenez-le.`;
    });
  const forward = (key: string) =>
    act(async () => {
      unwrap(await forwardAccessRequest(request.id, key || null));
      const target = services.find((s) => s.key === key);
      return `Demande de ${name} transmise ${target ? `au service ${target.label}` : "aux administrateurs"}.`;
    });

  const defaultManager = chosen?.managerName
    ? `Responsable du service — ${chosen.managerName}`
    : chosen
      ? "Responsable du service (pas encore désigné)"
      : "Aucun";

  return (
    <div className="space-y-2.5 border-b border-line p-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-ink">{name}</span>
        <div className="flex flex-wrap gap-1">
          <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold text-ink-3">{accessKindLabel(request.kind)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${requested ? "bg-sel-bg text-ink" : "bg-subtle text-ink-4"}`}>
            {requested ? requested.label : "Service non précisé"}
          </span>
          {ageDays >= 3 && <span className="rounded-full bg-bad-bg px-2 py-0.5 text-[10px] font-semibold text-bad">{ageDays} j</span>}
        </div>
      </div>
      <div className="text-xs text-ink-3">
        {request.email}
        {request.phone && <> · {request.phone}</>}
        {request.organization && <> · {request.organization}</>}
      </div>
      {request.reason && <p className="whitespace-pre-line rounded-btn bg-subtle px-2.5 py-2 text-xs text-ink-2">{request.reason}</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className={fieldTitle}>Rattacher au service</span>
          <select value={serviceKey} onChange={(e) => changeService(e.target.value)} className={input}>
            <option value="">{isAdmin ? "Aucun service" : "Choisir…"}</option>
            {assignable.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={fieldTitle}>Rôle</span>
          <select value={role} onChange={(e) => setRole(e.target.value as GrantableRole)} className={input}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className={fieldTitle}>N+1</span>
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className={input}>
            <option value="">{defaultManager}</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1">
        <span className={fieldTitle}>Pôles ouverts</span>
        <div className="flex flex-wrap gap-1.5">
          {assignable.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => togglePole(s.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${poles.includes(s.key) ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className={fieldTitle}>Statut</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as AccessStatus | "")} className={input}>
            <option value="">Aucun</option>
            {(Object.keys(STATUS_LABELS) as AccessStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-1">
          <span className={fieldTitle}>Couverture match</span>
          <div className="flex flex-wrap gap-3 pt-1">
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
              <Camera size={12} /> Photographe
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} />
              <Video size={12} /> Vidéaste
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1.5">
        {forwardTo === null ? (
          <button disabled={busy} onClick={() => setForwardTo(request.serviceKey ?? "")} className={`${btnSmall} text-ink-3 hover:bg-hover`}>
            <Forward size={12} /> Pas pour moi — transmettre
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} className={`${input} !w-auto`}>
              <option value="">Administrateurs</option>
              {services.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                  {s.managerName ? ` — ${s.managerName}` : ""}
                </option>
              ))}
            </select>
            <button disabled={busy || forwardTo === (request.serviceKey ?? "")} onClick={() => void forward(forwardTo)} className={`${btnSmall} bg-navy text-white`}>
              Transmettre
            </button>
            <button onClick={() => setForwardTo(null)} className={`${btnSmall} text-ink-4`}>
              Annuler
            </button>
          </div>
        )}
        <div className="flex gap-1.5">
          <button
            disabled={busy}
            onClick={() => confirm(`Refuser la demande de ${name} ? Un e-mail lui sera envoyé.`) && void act(async () => (unwrap(await rejectAccessRequest(request.id)), `Demande de ${name} refusée.`))}
            className={`${btnSmall} border border-bad text-bad`}
          >
            Refuser
          </button>
          <button disabled={busy || (!isAdmin && !serviceKey)} onClick={() => void approve()} className={`${btnSmall} bg-good text-white`}>
            <Check size={12} /> Accepter
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
