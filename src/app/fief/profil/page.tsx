"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, LogOut, Mail, MapPin, Phone, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { FiefButton, FiefLabel, fiefInput, type FiefMe } from "@/components/fief/ui";
import { MemberGate, ThemeChoice } from "@/components/fief/shell";
import { Avatar, bumpAvatarVersion } from "@/components/fief/feed";
import { PushToggle } from "@/components/fief/notifications";

// Profil de la membre : photo (recadrée au carré, Drive du board via /api/fief/avatar), fiche (identité et
// club gérés par l'équipe FIEF), présentation, téléphone et sa visibilité, apparence (clair / sombre / auto),
// notifications, déconnexion. Écriture de la fiche en direct (RLS + garde fief_members_guard).

/** Recadre au carré (centre) et réduit à 512 px. */
async function squareJpeg(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Photo illisible."))), "image/jpeg", 0.88));
}

export default function FiefProfilePage() {
  return <MemberGate>{(me) => <Profile me={me} />}</MemberGate>;
}

function Profile({ me }: { me: FiefMe }) {
  const { logout } = useAuth();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [showPhone, setShowPhone] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [photo, setPhoto] = useState<{ busy: boolean; error: string | null; key: number }>({ busy: false, error: null, key: 0 });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("fief_member_functions")
      .select("slug, label")
      .then(({ data }) => setLabels(Object.fromEntries((data ?? []).map((f) => [f.slug, f.label]))));
    supabase
      .from("fief_members")
      .select("bio, show_phone")
      .eq("user_id", me.userId)
      .maybeSingle()
      .then(({ data }) => {
        setBio(data?.bio ?? "");
        setShowPhone(data?.show_phone ?? false);
      });
  }, [me.userId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved("saving");
    const { error } = await createClient()
      .from("fief_members")
      .update({ bio: bio.trim().slice(0, 500) || null, phone: phone.trim() || null, show_phone: showPhone })
      .eq("user_id", me.userId);
    setSaved(error ? "error" : "ok");
  };

  const changePhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhoto((p) => ({ ...p, busy: true, error: null }));
    try {
      const blob = await squareJpeg(file);
      const form = new FormData();
      form.append("file", new File([blob], "profil.jpg", { type: "image/jpeg" }));
      const res = await fetch("/api/fief/avatar", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Envoi impossible.");
      bumpAvatarVersion();
      setPhoto((p) => ({ busy: false, error: null, key: p.key + 1 }));
    } catch (err) {
      setPhoto((p) => ({ ...p, busy: false, error: err instanceof Error ? err.message : "Envoi impossible." }));
    }
  };
  const removePhoto = async () => {
    setPhoto((p) => ({ ...p, busy: true, error: null }));
    await fetch("/api/fief/avatar", { method: "DELETE" }).catch(() => null);
    bumpAvatarVersion();
    setPhoto((p) => ({ busy: false, error: null, key: p.key + 1 }));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-3xl border border-f-border bg-f-surface p-5">
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative" key={photo.key}>
            <Avatar author={{ id: me.userId, team: false, name: `${me.firstName} ${me.lastName}` }} size={96} ring />
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={photo.busy}
              aria-label="Changer la photo"
              className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border-2 border-f-surface bg-f-accent text-white disabled:opacity-60"
            >
              <Camera size={16} />
            </button>
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void changePhoto(e.target.files?.[0]).then(() => (e.target.value = ""))} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold">
              {me.firstName} {me.lastName}
            </h1>
            {me.clubName && (
              <p className="flex items-center gap-1.5 text-sm text-f-muted">
                <MapPin size={14} /> {me.clubName}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {me.functions.map((f) => (
                <span key={f} className="rounded-full bg-f-subtle px-2.5 py-1 text-xs font-semibold text-f-link">
                  {labels[f] ?? f}
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-3 text-sm font-semibold">
              <button type="button" onClick={() => input.current?.click()} disabled={photo.busy} className="text-f-link hover:underline">
                {photo.busy ? "Envoi…" : "Changer la photo"}
              </button>
              <button type="button" onClick={() => void removePhoto()} disabled={photo.busy} className="flex items-center gap-1 text-f-muted hover:text-f-danger">
                <Trash2 size={13} /> Retirer
              </button>
            </div>
            {photo.error && <p className="mt-1 text-sm text-f-danger">{photo.error}</p>}
          </div>
        </div>
      </div>

      <form onSubmit={save} className="space-y-4 rounded-3xl border border-f-border bg-f-surface p-5">
        <p className="flex items-center gap-2 text-sm text-f-muted">
          <Mail size={15} /> {me.email}
        </p>
        <label className="block">
          <FiefLabel>Présentation</FiefLabel>
          <textarea rows={3} maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} className={fiefInput} placeholder="Quelques mots sur vous et votre engagement dans le football" />
        </label>
        <label className="block">
          <FiefLabel>Téléphone</FiefLabel>
          <div className="relative">
            <Phone size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-f-faint" />
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${fiefInput} pl-10`} />
          </div>
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
          <input type="checkbox" checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} className="h-5 w-5 accent-f-accent" />
          Les autres membres peuvent voir mon téléphone
        </label>
        <p className="text-xs text-f-muted">Votre nom, votre club et vos fonctions sont gérés par l&apos;équipe FIEF : écrivez-lui pour les modifier.</p>
        <FiefButton type="submit" disabled={saved === "saving"}>
          {saved === "saving" ? "Enregistrement…" : saved === "ok" ? "Enregistré ✓" : "Enregistrer"}
        </FiefButton>
        {saved === "error" && <p className="text-sm text-f-danger">Enregistrement impossible. Réessayez.</p>}
      </form>

      <div className="rounded-3xl border border-f-border bg-f-surface p-5">
        <p className="mb-1 font-bold">Apparence</p>
        <p className="mb-3 text-sm text-f-muted">Thème clair, sombre, ou automatique (comme votre téléphone).</p>
        <ThemeChoice />
      </div>

      <PushToggle variant="row" />

      <FiefButton variant="outline" onClick={() => void logout()}>
        <LogOut size={18} /> Se déconnecter
      </FiefButton>
    </div>
  );
}
