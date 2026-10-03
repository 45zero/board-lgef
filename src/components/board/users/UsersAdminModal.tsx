"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, Search, X } from "lucide-react";
import { listUsers, setUserManager, updateUser, type AdminUser, type SpecialtyOption, type UserRole, type UsersList } from "@/app/actions/users-admin";
import { unwrap } from "@/lib/board/actionResult";
import { listAccessRequests, type AccessRequest } from "@/app/actions/account-requests";
import { AccessRequestCard } from "@/components/board/users/AccessRequestCard";
import { buildPoles, type Pole } from "@/lib/board/poles";
import { getUserModules } from "@/app/actions/module-access";
import { CONFIGURABLE_MODULES } from "@/lib/board/modules";
import { pickDetails, type ProfileDetails } from "@/lib/board/profile";
import { ProfileDetailsFields } from "@/components/board/profile/ProfileFields";

const input = "w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm outline-none focus:border-navy";
const sectionTitle = "mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-4";
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Une erreur est survenue.");
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ROLE_LABELS: Record<UserRole, string> = {
  user: "Utilisateur",
  technician: "Technicien",
  organizer: "Organisateur",
  comite_directeur: "Comité directeur",
  comite_directeur_bad: "Comité directeur (BAD)",
  super_user: "Super user",
  admin: "Administrateur",
};
const ROLE_ORDER: UserRole[] = ["user", "technician", "organizer", "comite_directeur", "super_user", "admin"];

/** Statut (exclusif) : comment la personne est rémunérée. */
const STATUS_OPTIONS: { slug: string | null; label: string; hint: string }[] = [
  { slug: null, label: "Aucun", hint: "Pas de statut technique" },
  { slug: "tech-salarie", label: "Salarié", hint: "Personnel de la Ligue" },
  { slug: "tech-reseau", label: "Réseau", hint: "Remboursement de frais" },
  { slug: "tech-prestataire", label: "Prestataire", hint: "Sur facture" },
  { slug: "tech-benevole", label: "Bénévole", hint: "Ni frais ni facture" },
];
const STATUS_SLUGS = STATUS_OPTIONS.map((o) => o.slug).filter((s): s is string => !!s);
const PHOTO_SLUG = "tech-photo";
const VIDEO_SLUG = "tech-video";

const STATUS_BADGE: Record<string, string> = {
  "tech-salarie": "Salarié",
  "tech-reseau": "Réseau",
  "tech-prestataire": "Prestataire",
  "tech-benevole": "Bénévole",
  [PHOTO_SLUG]: "Photographe",
  [VIDEO_SLUG]: "Vidéaste",
};

type Filter = "all" | "requests" | "coverage" | "technician" | "organizer" | "comite" | "admin";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "requests", label: "Demandes" },
  { id: "coverage", label: "Couverture match" },
  { id: "technician", label: "Techniciens" },
  { id: "organizer", label: "Organisateurs" },
  { id: "comite", label: "Comité directeur" },
  { id: "admin", label: "Admins" },
];

function matchesFilter(u: AdminUser, f: Filter) {
  switch (f) {
    case "coverage":
      return u.slugs.includes(PHOTO_SLUG) || u.slugs.includes(VIDEO_SLUG);
    case "technician":
      return u.role === "technician";
    case "organizer":
      return u.role === "organizer";
    case "comite":
      return u.role === "comite_directeur" || u.role === "comite_directeur_bad";
    case "admin":
      return u.role === "admin" || u.role === "super_user";
    default:
      return true;
  }
}

const fullName = (u: AdminUser) => `${u.firstName} ${u.lastName}`.trim() || u.email;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------- Fiche d'un utilisateur ---------- */

function UserEditor({
  user,
  users,
  specialties,
  me,
  onSaved,
  onBack,
}: {
  user: AdminUser;
  /** Tous les comptes : choix du N+1. */
  users: AdminUser[];
  specialties: SpecialtyOption[];
  me: { id: string; isAdmin: boolean };
  onSaved: () => void;
  onBack: () => void;
}) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [role, setRole] = useState<UserRole>(user.role);
  const [slugs, setSlugs] = useState<string[]>(user.slugs);
  const [details, setDetails] = useState<ProfileDetails>(() => pickDetails(user));
  // Position trouvée à l'enregistrement (adresse tapée sans suggestion) : relue dans la liste.
  const shownDetails = {
    ...details,
    homeCoordinates: details.homeCoordinates ?? (details.homeAddress.trim() === user.homeAddress.trim() ? user.homeCoordinates : null),
  };
  const [managerId, setManagerId] = useState<string>(user.managerId ?? "");
  const [managerState, setManagerState] = useState<"idle" | "saving" | "saved">("idle");
  // Le N+1 s'enregistre dès qu'il est choisi (pas besoin du bouton « Enregistrer »).
  const changeManager = async (next: string) => {
    const previous = managerId;
    setManagerId(next);
    setManagerState("saving");
    setError(null);
    try {
      unwrap(await setUserManager(user.id, next || null));
      setManagerState("saved");
      onSaved();
    } catch (e) {
      setManagerId(previous);
      setManagerState("idle");
      setError(errorMessage(e));
    }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Modules visibles d'après les règles d'accès (état enregistré ; relu après chaque enregistrement).
  const [modules, setModules] = useState<string[] | null>(null);
  const loadModules = useCallback(() => getUserModules(user.id).then((r) => setModules(r.ok ? r.data : null)), [user.id]);
  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const status = STATUS_SLUGS.find((s) => slugs.includes(s)) ?? null;
  const setStatus = (slug: string | null) => setSlugs((prev) => [...prev.filter((s) => !STATUS_SLUGS.includes(s)), ...(slug ? [slug] : [])]);
  const toggle = (slug: string) => setSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const isSelf = user.id === me.id;
  const roleLocked = isSelf || (!me.isAdmin && (user.role === "admin" || user.role === "super_user"));
  const roleOptions = ROLE_ORDER.filter((r) => me.isAdmin || (r !== "admin" && r !== "super_user") || r === user.role);
  if (!roleOptions.includes(user.role)) roleOptions.push(user.role);

  const poles = buildPoles(specialties);
  const hasPole = (p: Pole) => p.slugs.some((slug) => slugs.includes(slug));
  const togglePole = (p: Pole) =>
    setSlugs((prev) => (hasPole(p) ? prev.filter((slug) => !p.slugs.includes(slug)) : [...prev.filter((slug) => !p.slugs.includes(slug)), ...p.slugs]));
  const ged = specialties.find((s) => s.slug === "access-ged");

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      unwrap(await updateUser(user.id, { firstName, lastName, role, slugs, details }));
      setSaved(true);
      onSaved();
      void loadModules();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const checkbox = (s: SpecialtyOption, label = s.label.replace(/^Technicien — /, "")) => (
    <label key={s.slug} className="flex items-center gap-2 text-sm text-ink-2">
      <input type="checkbox" checked={slugs.includes(s.slug)} onChange={() => toggle(s.slug)} />
      {label}
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <button onClick={onBack} className="rounded-btn p-1 text-ink-3 hover:bg-hover md:hidden" aria-label="Retour à la liste">
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0">
          <div className="truncate text-base font-extrabold text-ink">{fullName(user)}</div>
          <div className="truncate text-xs text-ink-4">{user.email}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={sectionTitle}>Prénom</div>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={input} />
        </div>
        <div>
          <div className={sectionTitle}>Nom</div>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={input} />
        </div>
      </div>

      <div>
        <div className={sectionTitle}>Rôle</div>
        <select value={role} disabled={roleLocked} onChange={(e) => setRole(e.target.value as UserRole)} className={`${input} disabled:opacity-60`}>
          {roleOptions.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {isSelf && <p className="mt-1 text-[11px] text-ink-4">Vous ne pouvez pas modifier votre propre rôle.</p>}
      </div>

      <div>
        <div className={sectionTitle}>Statut</div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => setStatus(o.slug)}
              className={`rounded-btn border-2 px-2.5 py-1.5 text-left ${status === o.slug ? "border-navy bg-sel-bg" : "border-line hover:bg-hover"}`}
            >
              <div className="text-sm font-bold text-ink">{o.label}</div>
              <div className="text-[11px] text-ink-4">{o.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={sectionTitle}>N+1 (responsable)</div>
        <select value={managerId} disabled={managerState === "saving"} onChange={(e) => void changeManager(e.target.value)} className={`${input} disabled:opacity-60`}>
          <option value="">Aucun</option>
          {users
            .filter((u) => u.id !== user.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {fullName(u)}
              </option>
            ))}
        </select>
        <p className="mt-1 text-[11px] text-ink-4">
          {managerState === "saving" ? "Enregistrement…" : managerState === "saved" ? "✓ N+1 enregistré. " : "Enregistré dès qu'il est choisi. "}
          Valide ses frais (et bientôt ses pointages et factures) ; voit ses interventions et leur coût dans Effectif.
        </p>
      </div>

      <ProfileDetailsFields value={shownDetails} onChange={setDetails} self={false} />

      <div>
        <div className={sectionTitle}>Couverture match</div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={slugs.includes(PHOTO_SLUG)} onChange={() => toggle(PHOTO_SLUG)} />
            Photographe <span className="text-xs text-ink-4">— reçoit les matchs à photographier, « Je prends »</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={slugs.includes(VIDEO_SLUG)} onChange={() => toggle(VIDEO_SLUG)} />
            Vidéaste <span className="text-xs text-ink-4">— proposé pour les captations vidéo</span>
          </label>
        </div>
      </div>

      {ged && (
        <div>
          <div className={sectionTitle}>Accès</div>
          {checkbox(ged, "Accès comptabilité (GED)")}
        </div>
      )}

      {poles.length > 0 && (
        <div>
          <div className={sectionTitle}>Pôles</div>
          <p className="mb-2 text-xs text-ink-4">Types d&apos;événements que la personne peut créer, voir et gérer dans le calendrier.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {poles.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={hasPole(p)} onChange={() => togglePole(p)} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className={sectionTitle}>Modules visibles</div>
        <p className="mb-2 text-xs text-ink-4">Calculé d&apos;après l&apos;accès de chaque module (Paramètres → Accès aux modules).</p>
        {modules === null ? (
          <span className="text-xs text-ink-4">…</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {CONFIGURABLE_MODULES.map((m) => (
              <span
                key={m.id}
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${modules.includes(m.id) ? "bg-good-bg text-good" : "bg-subtle text-ink-4 line-through"}`}
              >
                {m.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        {saved && !busy && <span className="flex items-center gap-1 text-xs font-semibold text-good"><Check size={12} /> Enregistré</span>}
        <button onClick={() => void save()} disabled={busy} className="flex items-center gap-1.5 rounded-btn bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-600 disabled:opacity-50">
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

/* ---------- Fenêtre ---------- */

/** Paramètres → Utilisateurs : demandes d'accès, rôle, statut, N+1, adresse, véhicule, réseau photo et pôles de chaque compte. */
export function UsersAdminModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<UsersList | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([listUsers(), listAccessRequests()])
        .then(([users, reqs]) => {
          setData(unwrap(users));
          setRequests(unwrap(reqs));
        })
        .catch((e) => setError(errorMessage(e))),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return (data?.users ?? [])
      .filter((u) => matchesFilter(u, filter))
      .filter((u) => !q || normalize(`${u.firstName} ${u.lastName} ${u.email}`).includes(q));
  }, [data, query, filter]);
  const selected = data?.users.find((u) => u.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Paramètres</div>
            <h3 className="mt-1 text-base font-extrabold">Utilisateurs</h3>
            {data && (
              <div className="mt-0.5 text-xs text-white/80">
                {data.users.length} comptes{requests.length > 0 && ` · ${requests.length} demande${requests.length > 1 ? "s" : ""} d'accès`}
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-btn border border-line bg-card px-2.5 py-1.5">
            <Search size={13} className="text-ink-4" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou e-mail…" className="w-full bg-transparent text-sm outline-none" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
                {f.id === "requests" && requests.length > 0 && <span className="ml-1 rounded-full bg-red px-1.5 text-[10px] font-bold text-white">{requests.length}</span>}
              </Chip>
            ))}
          </div>
        </div>

        {error && <div className="mx-4 mt-3 rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>}
        {notice && <div className="mx-4 mt-3 rounded-btn bg-sel-bg px-3 py-2 text-sm font-semibold text-ink">{notice}</div>}

        {filter === "requests" ? (
          <div className="flex-1 overflow-y-auto p-4">
            {requests.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-4">Aucune demande d&apos;accès en attente.</p>
            ) : (
              <div className="mx-auto max-w-xl overflow-hidden rounded-btn border border-line">
                {requests.map((r) => (
                  <AccessRequestCard
                    key={r.id}
                    request={r}
                    onDone={(message) => {
                      setNotice(message);
                      void load();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className={`min-h-0 w-full overflow-y-auto border-r border-line md:w-[340px] md:shrink-0 ${selected ? "hidden md:block" : ""}`}>
              {!data && !error && <p className="p-6 text-center text-sm text-ink-4">Chargement…</p>}
              {data && visible.length === 0 && <p className="p-6 text-center text-sm text-ink-4">Aucun compte.</p>}
              {visible.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedId(u.id)}
                  className={`block w-full border-b border-line px-4 py-2.5 text-left hover:bg-hover ${u.id === selectedId ? "bg-sel-bg" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-bold text-ink">{fullName(u)}</span>
                    <span className="shrink-0 text-[10px] font-semibold text-ink-4">{ROLE_LABELS[u.role] ?? u.role}</span>
                  </div>
                  <div className="truncate text-[11px] text-ink-4">{u.email}</div>
                  {(u.slugs.some((s) => STATUS_BADGE[s]) || (u.slugs.includes("tech-reseau") && !u.homeAddress)) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {u.slugs
                        .filter((s) => STATUS_BADGE[s])
                        .map((s) => (
                          <span key={s} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${s === PHOTO_SLUG || s === VIDEO_SLUG ? "bg-good-bg text-good" : "bg-subtle text-ink-3"}`}>
                            {STATUS_BADGE[s]}
                          </span>
                        ))}
                      {u.slugs.includes("tech-reseau") && !u.homeAddress && (
                        <span className="rounded-full bg-bad-bg px-1.5 py-0.5 text-[10px] font-semibold text-bad">Adresse manquante</span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
            <div className={`min-h-0 flex-1 overflow-y-auto p-5 ${selected ? "" : "hidden md:block"}`}>
              {selected && data ? (
                <UserEditor
                  key={selected.id}
                  user={selected}
                  users={data.users}
                  specialties={data.specialties}
                  me={data.me}
                  onSaved={() => void load()}
                  onBack={() => setSelectedId(null)}
                />
              ) : (
                <p className="p-6 text-center text-sm text-ink-4">Sélectionnez un compte pour modifier son rôle, son statut, son adresse et son véhicule.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
