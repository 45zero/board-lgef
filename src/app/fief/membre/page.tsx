"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, MessageCircle, Phone, Settings } from "lucide-react";
import { useFiefHref, type FiefMe } from "@/components/fief/ui";
import { MemberGate } from "@/components/fief/shell";
import { Avatar, Feed } from "@/components/fief/feed";
import { loadDirectory, useFiefFunctions, type DirectoryEntry } from "@/components/fief/directory";

// Page d'une membre (?u=<id>, sans paramètre : la mienne) : photo, nom, club, fonctions, présentation
// et toutes ses publications visibles par la personne connectée (fief_feed p_author). Sur ma page,
// « Gérer mon profil » en haut à droite ouvre les réglages (/profil) ; sur celle d'une autre,
// « Message ».

export default function FiefMemberPage() {
  return (
    <MemberGate>
      {(me) => (
        <Suspense fallback={null}>
          <MemberPage me={me} />
        </Suspense>
      )}
    </MemberGate>
  );
}

function MemberPage({ me }: { me: FiefMe }) {
  const href = useFiefHref();
  const params = useSearchParams();
  const userId = params.get("u") || me.userId;
  const mine = userId === me.userId;
  const functions = useFiefFunctions();
  const [person, setPerson] = useState<{ id: string; entry: DirectoryEntry | null } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadDirectory().then((list) => alive && setPerson({ id: userId, entry: list.find((p) => p.user_id === userId) ?? null }));
    return () => {
      alive = false;
    };
  }, [userId]);

  const entry = person?.id === userId ? person.entry : undefined;
  const label = (slug: string) => functions?.find((f) => f.slug === slug)?.label ?? slug;
  const name = entry ? `${entry.first_name} ${entry.last_name}` : mine ? `${me.firstName} ${me.lastName}` : "";

  if (entry === null && !mine)
    return <div className="mx-auto max-w-2xl rounded-2xl border border-f-border bg-f-surface p-8 text-center text-f-muted">Cette membre n&apos;est plus sur FIEF.</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="overflow-hidden rounded-2xl border border-f-border bg-f-surface">
        <div className="h-28 bg-[radial-gradient(ellipse_at_top,#1B3A73_0%,#0E2754_60%,#091B3D_100%)] sm:h-36" />
        <div className="relative px-4 pb-4 sm:px-6">
          <div className="-mt-12 flex items-end gap-4 sm:-mt-14">
            <span className="rounded-full ring-4 ring-f-surface">
              <Avatar author={{ id: userId, team: false, name }} size={96} />
            </span>
            <div className="ml-auto flex gap-2 pb-1">
              {mine ? (
                <Link href={href("/profil")} className="flex items-center gap-2 rounded-xl bg-f-subtle px-3.5 py-2 text-sm font-bold text-f-text hover:brightness-95">
                  <Settings size={16} /> Gérer mon profil
                </Link>
              ) : (
                <Link href={href(`/messages?to=${userId}`)} className="flex items-center gap-2 rounded-xl bg-f-accent px-3.5 py-2 text-sm font-bold text-white">
                  <MessageCircle size={16} /> Message
                </Link>
              )}
            </div>
          </div>
          <h1 className="mt-3 text-2xl font-extrabold">{name || "…"}</h1>
          {entry?.club_name && <p className="text-[15px] font-semibold text-f-muted">{entry.club_name}</p>}
          {!!entry?.functions?.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.functions.map((f) => (
                <span key={f} className="rounded-full bg-f-subtle px-2.5 py-1 text-xs font-bold">
                  {label(f)}
                </span>
              ))}
            </div>
          )}
          {entry?.bio && <p className="mt-3 whitespace-pre-line text-[15px]">{entry.bio}</p>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-f-muted">
            {entry?.joined_at && (
              <span className="flex items-center gap-1.5">
                <CalendarDays size={15} /> Membre depuis {new Date(entry.joined_at).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
              </span>
            )}
            {entry?.phone && (
              <a href={`tel:${entry.phone}`} className="flex items-center gap-1.5 hover:underline">
                <Phone size={15} /> {entry.phone}
              </a>
            )}
          </div>
        </div>
      </section>

      <h2 className="px-1 text-lg font-extrabold">{mine ? "Mes publications" : "Publications"}</h2>
      <Feed
        key={userId}
        me={{ id: me.userId, firstName: me.firstName }}
        authorId={userId}
        hideComposer={!mine}
        profileHref={(id) => href(`/membre?u=${id}`)}
        emptyText={mine ? "Vous n'avez encore rien publié." : "Pas encore de publication."}
      />
    </div>
  );
}
