/** En-tête des pages publiques LGEF Transfer (logo fourni : public/lgeftransfer.png). */
export function TransferBrand() {
  return (
    <a href="/transfer" className="mb-4 flex items-center gap-3 text-white" aria-label="LGEF Transfer — accueil">
      {/* eslint-disable-next-line @next/next/no-img-element -- logo statique */}
      <img src="/lgeftransfer.png" alt="" className="h-16 w-auto drop-shadow-lg" />
      <span className="leading-tight">
        <span className="block text-xl font-extrabold tracking-tight">LGEF Transfer</span>
        <span className="block text-xs text-white/70">Envoyez vos fichiers, simplement.</span>
      </span>
    </a>
  );
}
