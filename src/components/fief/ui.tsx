"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Home } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase/client";

// Habillage FIEF (maquette du 13/11/2026) : bleu marine, liseré rouge, écusson « Graines d'éducatrices ».
// Les pages sont sous /fief ; sur fief.lgef.fr elles s'affichent sans ce préfixe (src/proxy.ts) —
// d'où useFiefHref(), qui donne le bon lien sur les deux domaines.

const noopSubscribe = () => () => {};

export function useFiefHref() {
  // Domaine lu côté navigateur (le serveur rend les liens /fief/…, corrigés à l'hydratation).
  const onFiefHost = useSyncExternalStore(noopSubscribe, () => window.location.host.startsWith("fief."), () => false);
  return (path: string) => (onFiefHost ? path || "/" : `/fief${path === "/" ? "" : path}`);
}

export function Crest({ size = 56, className = "" }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/fief/crest.png" alt="Écusson FIEF — Graines d'éducatrices" width={size} height={Math.round(size * 1.08)} className={className} style={{ width: size, height: "auto" }} />;
}

export function Wordmark({ size = 28, light = true }: { size?: number; light?: boolean }) {
  return (
    <span className={`font-black italic leading-none tracking-tight ${light ? "text-white" : "text-f-text"}`} style={{ fontSize: size }}>
      FIEF
    </span>
  );
}

/** Bouton plein (bleu marine), rouge ou contour, aux proportions de la maquette. */
export function FiefButton({
  children,
  variant = "solid",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "outline" | "red" }) {
  const styles =
    variant === "solid"
      ? "bg-f-accent text-white hover:bg-f-avatar"
      : variant === "red"
        ? "bg-[#D7262E] text-white hover:bg-[#B91F26]"
        : "border-2 border-f-accent bg-f-surface text-f-text hover:bg-f-subtle";
  return (
    <button {...props} className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-bold transition disabled:opacity-60 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export const fiefInput =
  "w-full rounded-xl border border-f-border bg-f-surface px-3.5 py-3 text-[15px] text-f-text outline-none placeholder:text-[#94A3B8] focus:border-f-accent focus:ring-2 focus:ring-f-accent/10";

export function FiefLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-[13px] font-semibold text-f-text">
      {children}
      {required && <span className="text-[#D7262E]"> *</span>}
    </span>
  );
}

/** Pages hors connexion (connexion, adhésion…) : fond bleu marine, carte blanche centrée. */
export function PublicFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const href = useFiefHref();
  return (
    <div className="min-h-dvh bg-[#091B3D] bg-[radial-gradient(ellipse_at_top,#1B3A73_0%,#091B3D_60%)] px-4 py-8 text-f-text">
      <div className={`mx-auto ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <Link href={href("/")} className="mb-6 flex items-center justify-center gap-3">
          <Crest size={44} />
          <span className="flex flex-col">
            <Wordmark size={30} />
            <span className="text-[11px] font-medium text-white/75">Femmes Investies dans l&apos;Environnement du Football</span>
          </span>
        </Link>
        <div className="rounded-3xl bg-f-surface p-6 shadow-2xl shadow-black/30 sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-white/60">Ligue du Grand Est de Football · S&apos;engager • Partager • Grandir</p>
      </div>
    </div>
  );
}

export interface FiefMe {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  clubName: string | null;
  functions: string[];
  status: "active" | "suspended" | "left";
}

/** Session + fiche membre (lecture de sa propre fiche, autorisée par la RLS). */
export function useFiefMe() {
  const { user, loading } = useAuth();
  const [state, setState] = useState<{ me: FiefMe | null; forUser: string | null }>({ me: null, forUser: null });
  useEffect(() => {
    if (loading || !user) return;
    let alive = true;
    createClient()
      .from("fief_members")
      .select("user_id, first_name, last_name, email, phone, club_name, functions, status")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setState({
          forUser: user.id,
          me: data
            ? { userId: data.user_id, firstName: data.first_name, lastName: data.last_name, email: data.email, phone: data.phone, clubName: data.club_name, functions: data.functions, status: data.status }
            : null,
        });
      });
    return () => {
      alive = false;
    };
  }, [user, loading]);
  const ready = !loading && (!user || state.forUser === user.id);
  return { user, loading: !ready, me: user ? state.me : null };
}

/** Contenu prévu dans un prochain lot (fil d'actu, calendrier, documents). */
export function ComingSoon({ icon: Icon, title, text }: { icon: typeof Home; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-f-border-strong bg-f-surface px-6 py-10 text-center">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-f-subtle text-f-text">
        <Icon size={24} />
      </span>
      <p className="text-lg font-extrabold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-f-muted">{text}</p>
    </div>
  );
}
