"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

/** Bas de la liste des mails : charge la page suivante dès qu'il devient visible (bouton en secours). */
export function LoadMoreMails({ loading, onLoad }: { loading: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);
  // Relancé à la fin de chaque chargement : si le bas de liste est encore visible, la page suivante suit.
  useEffect(() => {
    const el = ref.current;
    if (!el || loading) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onLoadRef.current(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loading]);
  return (
    <div ref={ref} className="flex justify-center p-3">
      {loading ? (
        <Loader2 size={18} className="animate-spin text-ink-4" />
      ) : (
        <button onClick={onLoad} className="rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover">
          Charger plus
        </button>
      )}
    </div>
  );
}
