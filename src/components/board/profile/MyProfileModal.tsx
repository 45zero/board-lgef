"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, KeyRound, X } from "lucide-react";
import { createAvatarUpload, getMyProfile, setMyAvatar, updateMyProfile } from "@/app/actions/profile";
import { unwrap } from "@/lib/board/actionResult";
import { PROFILE_UPDATED_EVENT, pickDetails, type MyProfile, type ProfileDetails } from "@/lib/board/profile";
import { createClient } from "@/lib/supabase/client";
import { ProfileDetailsFields } from "@/components/board/profile/ProfileFields";

const input = "w-full rounded-btn border border-line bg-card px-2.5 py-2 text-sm outline-none focus:border-navy";
const sectionTitle = "mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-4";
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Une erreur est survenue.");
const notifyProfileUpdated = () => window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));

/** Mot de passe : l'actuel est redemandé avant d'enregistrer le nouveau. */
function PasswordSection({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    setMessage(null);
    if (next.length < 8) return setMessage({ ok: false, text: "Le nouveau mot de passe doit faire au moins 8 caractères." });
    if (next !== confirm) return setMessage({ ok: false, text: "La confirmation ne correspond pas." });
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password: current });
      if (authError) throw new Error("Mot de passe actuel incorrect.");
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw new Error(error.message);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ ok: true, text: "Mot de passe modifié." });
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs font-semibold text-link hover:underline">
        <KeyRound size={12} /> Changer mon mot de passe
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-btn border border-line p-3">
      <div className={sectionTitle}>Mot de passe</div>
      <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Mot de passe actuel" className={input} />
      <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Nouveau mot de passe (8 caractères min.)" className={input} />
      <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirmer le nouveau mot de passe" className={input} />
      {message && <p className={`text-xs font-semibold ${message.ok ? "text-good" : "text-bad"}`}>{message.text}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded-btn px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover">
          Fermer
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !current || !next}
          className="rounded-btn bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-600 disabled:opacity-50"
        >
          {busy ? "…" : "Modifier"}
        </button>
      </div>
    </div>
  );
}

function ProfileForm({ profile, onClose }: { profile: MyProfile; onClose: () => void }) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [details, setDetails] = useState<ProfileDetails>(() => pickDetails(profile));
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const initials = [firstName[0], lastName[0]].filter(Boolean).join("").toUpperCase() || profile.email.slice(0, 2).toUpperCase();

  const uploadAvatar = async (file: File) => {
    setAvatarBusy(true);
    setError(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Photo trop lourde (5 Mo maximum).");
      const target = unwrap(await createAvatarUpload(file.type));
      const { error: uploadError } = await createClient().storage.from("avatars").uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (uploadError) throw new Error(uploadError.message);
      setAvatarUrl(unwrap(await setMyAvatar(target.path)));
      notifyProfileUpdated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      unwrap(await setMyAvatar(null));
      setAvatarUrl(null);
      notifyProfileUpdated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAvatarBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      unwrap(await updateMyProfile({ firstName, lastName, ...details }));
      // Relu : position trouvée (ou non) par Google pour une adresse tapée à la main.
      const fresh = unwrap(await getMyProfile());
      setDetails(pickDetails(fresh));
      setSaved(true);
      notifyProfileUpdated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- photo du bucket Supabase, domaine non déclaré à next/image
              <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red text-lg font-bold text-white">{initials}</div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-navy text-white disabled:opacity-50"
              aria-label="Changer la photo"
            >
              <Camera size={13} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadAvatar(file);
              }}
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-extrabold text-ink">{`${firstName} ${lastName}`.trim() || profile.email}</div>
            <div className="truncate text-xs text-ink-4">{profile.email}</div>
            <div className="mt-1 text-[11px] text-ink-4">
              {avatarBusy ? "Envoi de la photo…" : avatarUrl ? (
                <button onClick={() => void removeAvatar()} className="font-semibold text-ink-3 hover:text-bad hover:underline">
                  Retirer la photo
                </button>
              ) : (
                "Ajoutez une photo : elle apparaît sur vos cartes, frais et événements."
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={sectionTitle}>Prénom</div>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={input} autoComplete="given-name" />
          </div>
          <div>
            <div className={sectionTitle}>Nom</div>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={input} autoComplete="family-name" />
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-btn bg-subtle px-3 py-2 text-xs text-ink-3">
          <span>
            Statut : <b className="text-ink-2">{profile.status ?? "—"}</b>
          </span>
          <span>
            N+1 : <b className="text-ink-2">{profile.managerName ?? "—"}</b>
          </span>
          <span className="w-full text-[11px] text-ink-4">Réglés par un administrateur (Paramètres → Gérer les utilisateurs).</span>
        </div>

        <ProfileDetailsFields value={details} onChange={setDetails} self />

        <PasswordSection email={profile.email} />
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-5 py-3">
        {error && <p className="mr-auto text-sm text-bad">{error}</p>}
        {saved && !busy && (
          <span className="flex items-center gap-1 text-xs font-semibold text-good">
            <Check size={12} /> Enregistré
          </span>
        )}
        <button onClick={onClose} className="rounded-btn px-3 py-2 text-sm font-semibold text-ink-3 hover:bg-hover">
          Fermer
        </button>
        <button onClick={() => void save()} disabled={busy} className="rounded-btn bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-600 disabled:opacity-50">
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </>
  );
}

/** Mon profil : photo, nom, adresse (Google Maps), véhicule de service, mot de passe. */
export function MyProfileModal({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile()
      .then((r) => setProfile(unwrap(r)))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Compte</div>
            <h3 className="mt-1 text-base font-extrabold">Mon profil</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        {error && <div className="m-4 rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>}
        {!profile && !error && <p className="p-8 text-center text-sm text-ink-4">Chargement…</p>}
        {profile && <ProfileForm profile={profile} onClose={onClose} />}
      </div>
    </div>
  );
}
