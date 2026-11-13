"use client";

import Link from "next/link";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, FileText, Newspaper, UserPlus, LogIn, Users, Bell, Smartphone } from "lucide-react";
import { Crest, useFiefHref, useFiefMe, Wordmark, type FiefMe } from "@/components/fief/ui";
import { AdsAside, MemberGate, StoriesRow } from "@/components/fief/shell";
import { Feed } from "@/components/fief/feed";

// Accueil FIEF : écran de bienvenue (pas connectée) ou espace membre (connectée et validée).

export default function FiefHomePage() {
  const { user, loading } = useFiefMe();
  if (loading) return <div className="flex min-h-dvh items-center justify-center bg-[#0E2754]"><Crest size={72} className="animate-pulse" /></div>;
  if (!user) return <Welcome />;
  return (
    <MemberGate>
      {(me) => (
        <Suspense fallback={null}>
          <MemberHome me={me} />
        </Suspense>
      )}
    </MemberGate>
  );
}

function Welcome() {
  const href = useFiefHref();
  const features = [
    { icon: Newspaper, title: "Un fil d'actualités", text: "pour partager et valoriser" },
    { icon: CalendarDays, title: "Un calendrier", text: "avec les événements FIEF" },
    { icon: FileText, title: "Des documents", text: "à consulter et télécharger" },
    { icon: Bell, title: "Des notifications", text: "push et e-mail" },
    { icon: Users, title: "Un réseau", text: "de femmes engagées dans le football" },
    { icon: Smartphone, title: "Une application", text: "simple, installable sur votre téléphone" },
  ];
  return (
    <div className="min-h-dvh bg-[#091B3D] text-white">
      <div className="relative overflow-hidden bg-[radial-gradient(ellipse_at_top,#1B3A73_0%,#0E2754_45%,#091B3D_100%)]">
        <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-24 h-40 w-[140%] -rotate-6 bg-[#D7262E]/90" style={{ clipPath: "ellipse(60% 18% at 50% 50%)" }} />
        <div className="relative mx-auto flex max-w-5xl flex-col items-center px-5 pb-16 pt-12 md:flex-row md:items-center md:gap-14 md:pb-24 md:pt-20">
          <Crest size={190} className="drop-shadow-2xl md:order-2 md:w-[260px]" />
          <div className="mt-8 text-center md:mt-0 md:text-left">
            <Wordmark size={64} />
            <p className="mt-2 text-lg font-semibold italic text-white/90">Femmes Investies dans l&apos;Environnement du Football</p>
            <p className="mt-4 inline-block -skew-x-6 rounded-lg bg-[#D7262E] px-4 py-2 text-lg font-bold italic shadow-lg">
              L&apos;espace des femmes du football du Grand Est
            </p>
            <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 md:mx-0">
              <Link href={href("/connexion")} className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-[15px] font-bold text-[#0E2754] shadow-lg hover:bg-[#EEF2F8]">
                <LogIn size={18} /> Se connecter
              </Link>
              <Link href={href("/adhesion")} className="flex items-center justify-center gap-2 rounded-xl border-2 border-white/80 px-4 py-3.5 text-[15px] font-bold text-white hover:bg-white/10">
                <UserPlus size={18} /> Demander une adhésion
              </Link>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-[#F3F6FB] px-5 py-12 text-[#0E2754]">
        <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0E2754] text-white">
                <f.icon size={22} />
              </span>
              <span>
                <span className="block font-extrabold">{f.title}</span>
                <span className="text-sm text-[#5B6B86]">{f.text}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-sm font-semibold italic text-[#5B6B86]">S&apos;engager • Partager • Grandir — Ligue du Grand Est de Football</p>
      </div>
    </div>
  );
}

function MemberHome({ me }: { me: FiefMe }) {
  const href = useFiefHref();
  const params = useSearchParams();
  const focus = params.get("post");
  const publish = params.get("publier") === "1";
  const openComposer = () => {
    const el = document.getElementById("fief-composer");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  };
  // Bouton « + » de la barre mobile (?publier=1) : zone de publication ouverte d'emblée.
  useEffect(() => {
    if (publish) window.setTimeout(openComposer, 300);
  }, [publish]);

  return (
    <div className="flex justify-center gap-8">
      <div className="w-full max-w-[680px] space-y-4">
        <StoriesRow me={me} onPublish={openComposer} />
        <Feed me={{ id: me.userId, firstName: me.firstName }} focusPostId={focus} messageHref={(id) => href(`/messages?to=${id}`)} />
      </div>
      <AdsAside />
    </div>
  );
}
