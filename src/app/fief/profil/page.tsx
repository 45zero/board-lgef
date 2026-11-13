"use client";

import { useEffect, useState } from "react";
import { LogOut, Mail, MapPin, Phone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { FiefButton, FiefLabel, fiefInput, MemberGate, type FiefMe } from "@/components/fief/ui";

// Profil de la membre : fiche (identité et club gérés par l'équipe FIEF), téléphone et sa visibilité,
// présentation courte, déconnexion. Écriture directe sur sa fiche (RLS + garde fief_members_guard).

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

  const initials = `${me.firstName[0] ?? ""}${me.lastName[0] ?? ""}`.toUpperCase();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-4 rounded-3xl bg-white p-5 shadow-sm">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#0E2754] text-xl font-extrabold text-white">{initials}</span>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold">
            {me.firstName} {me.lastName}
          </h1>
          {me.clubName && (
            <p className="flex items-center gap-1.5 text-sm text-[#5B6B86]">
              <MapPin size={14} /> {me.clubName}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {me.functions.map((f) => (
              <span key={f} className="rounded-full bg-[#EEF2F8] px-2.5 py-1 text-xs font-semibold text-[#1B3A73]">
                {labels[f] ?? f}
              </span>
            ))}
          </div>
        </div>
      </div>

      <form onSubmit={save} className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
        <p className="flex items-center gap-2 text-sm text-[#5B6B86]">
          <Mail size={15} /> {me.email}
        </p>
        <label className="block">
          <FiefLabel>Présentation</FiefLabel>
          <textarea rows={3} maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} className={fiefInput} placeholder="Quelques mots sur vous et votre engagement dans le football" />
        </label>
        <label className="block">
          <FiefLabel>Téléphone</FiefLabel>
          <div className="relative">
            <Phone size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${fiefInput} pl-10`} />
          </div>
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
          <input type="checkbox" checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} className="h-5 w-5 accent-[#0E2754]" />
          Les autres membres peuvent voir mon téléphone
        </label>
        <p className="text-xs text-[#5B6B86]">Votre nom, votre club et vos fonctions sont gérés par l&apos;équipe FIEF : écrivez-lui pour les modifier.</p>
        <FiefButton type="submit" disabled={saved === "saving"}>
          {saved === "saving" ? "Enregistrement…" : saved === "ok" ? "Enregistré ✓" : "Enregistrer"}
        </FiefButton>
        {saved === "error" && <p className="text-sm text-[#B91F26]">Enregistrement impossible. Réessayez.</p>}
      </form>

      <FiefButton variant="outline" onClick={() => void logout()}>
        <LogOut size={18} /> Se déconnecter
      </FiefButton>
    </div>
  );
}
