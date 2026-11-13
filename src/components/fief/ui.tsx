"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bell, CalendarDays, FileText, Home, LogOut, User } from "lucide-react";
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
    <span className={`font-black italic leading-none tracking-tight ${light ? "text-white" : "text-[#0E2754]"}`} style={{ fontSize: size }}>
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
      ? "bg-[#0E2754] text-white hover:bg-[#1B3A73]"
      : variant === "red"
        ? "bg-[#D7262E] text-white hover:bg-[#B91F26]"
        : "border-2 border-[#0E2754] bg-white text-[#0E2754] hover:bg-[#EEF2F8]";
  return (
    <button {...props} className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-bold transition disabled:opacity-60 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export const fiefInput =
  "w-full rounded-xl border border-[#DCE3EF] bg-white px-3.5 py-3 text-[15px] text-[#0E2754] outline-none placeholder:text-[#94A3B8] focus:border-[#0E2754] focus:ring-2 focus:ring-[#0E2754]/10";

export function FiefLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-[13px] font-semibold text-[#0E2754]">
      {children}
      {required && <span className="text-[#D7262E]"> *</span>}
    </span>
  );
}

/** Pages hors connexion (connexion, adhésion…) : fond bleu marine, carte blanche centrée. */
export function PublicFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const href = useFiefHref();
  return (
    <div className="min-h-dvh bg-[#091B3D] bg-[radial-gradient(ellipse_at_top,#1B3A73_0%,#091B3D_60%)] px-4 py-8 text-[#0E2754]">
      <div className={`mx-auto ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <Link href={href("/")} className="mb-6 flex items-center justify-center gap-3">
          <Crest size={44} />
          <span className="flex flex-col">
            <Wordmark size={30} />
            <span className="text-[11px] font-medium text-white/75">Femmes Investies dans l&apos;Environnement du Football</span>
          </span>
        </Link>
        <div className="rounded-3xl bg-white p-6 shadow-2xl shadow-black/30 sm:p-8">{children}</div>
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

const TABS = [
  { path: "/", label: "Accueil", icon: Home },
  { path: "/calendrier", label: "Calendrier", icon: CalendarDays },
  { path: "/documents", label: "Documents", icon: FileText },
  { path: "/profil", label: "Profil", icon: User },
];

/** Espace connecté : en-tête bleu marine (menu en haut sur ordinateur), barre d'onglets en bas sur mobile. */
export function MemberShell({ children }: { children: ReactNode }) {
  const href = useFiefHref();
  const pathname = usePathname();
  const current = pathname.replace(/^\/fief/, "") || "/";
  const { logout } = useAuth();
  return (
    <div className="min-h-dvh bg-[#F3F6FB] pb-24 text-[#0E2754] md:pb-0">
      <header className="sticky top-0 z-30 border-b-[3px] border-[#D7262E] bg-[#0E2754] text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link href={href("/")} className="flex items-center gap-2.5">
            <Crest size={34} />
            <Wordmark size={26} />
          </Link>
          <nav className="ml-8 hidden items-center gap-1 md:flex">
            {TABS.map((t) => (
              <Link
                key={t.path}
                href={href(t.path)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${current === t.path ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-white/80" title="Notifications (bientôt)">
              <Bell size={20} />
            </span>
            <button type="button" onClick={() => void logout()} className="hidden h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-white/80 hover:bg-white/10 md:flex">
              <LogOut size={16} /> Déconnexion
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#DCE3EF] bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map((t) => {
            const active = current === t.path;
            return (
              <Link key={t.path} href={href(t.path)} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${active ? "text-[#0E2754]" : "text-[#8A97AD]"}`}>
                <t.icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/** Contenu prévu dans un prochain lot (fil d'actu, calendrier, documents). */
export function ComingSoon({ icon: Icon, title, text }: { icon: typeof Home; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#C9D4E6] bg-white px-6 py-10 text-center">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF2F8] text-[#0E2754]">
        <Icon size={24} />
      </span>
      <p className="text-lg font-extrabold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-[#5B6B86]">{text}</p>
    </div>
  );
}

/** Accès membre : redirige vers l'accueil public si pas connectée, message si la fiche n'est pas active. */
export function MemberGate({ children }: { children: (me: FiefMe) => ReactNode }) {
  const { user, loading, me } = useFiefMe();
  const href = useFiefHref();
  const { logout } = useAuth();
  useEffect(() => {
    if (!loading && !user) window.location.replace(href("/"));
  }, [loading, user, href]);
  if (loading || !user) return <div className="flex min-h-dvh items-center justify-center bg-[#0E2754]"><Crest size={72} className="animate-pulse" /></div>;
  if (!me || me.status !== "active")
    return (
      <PublicFrame>
        <h1 className="text-xl font-extrabold">{me?.status === "suspended" ? "Accès suspendu" : "Pas encore membre"}</h1>
        <p className="mt-2 text-sm text-[#5B6B86]">
          {me?.status === "suspended"
            ? "Votre accès à FIEF est suspendu. Contactez l'équipe FIEF de la Ligue pour en savoir plus."
            : "Ce compte n'est pas encore membre de FIEF. Faites une demande d'adhésion : l'équipe FIEF vous répondra par e-mail."}
        </p>
        <div className="mt-5 space-y-2">
          {!me && (
            <Link href={href("/adhesion")} className="flex w-full items-center justify-center rounded-xl bg-[#0E2754] px-4 py-3 text-[15px] font-bold text-white">
              Demander une adhésion
            </Link>
          )}
          <FiefButton variant="outline" onClick={() => void logout()}>
            Se déconnecter
          </FiefButton>
        </div>
      </PublicFrame>
    );
  return <MemberShell>{children(me)}</MemberShell>;
}
