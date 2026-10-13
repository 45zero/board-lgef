import type { TransferAdView } from "@/lib/transfer/shared";

// Pub de LGEF Transfer : fond plein écran (derrière la carte, comme WeTransfer) ou bannière.
// Le clic passe par /api/transfer/ads/<id>/click (compté) avant d'ouvrir le lien de l'annonceur.

function Media({ ad, className }: { ad: TransferAdView; className: string }) {
  return ad.mediaType === "video" ? (
    <video src={ad.mediaUrl} autoPlay muted loop playsInline className={className} />
  ) : (
    /* eslint-disable-next-line @next/next/no-img-element -- visuel servi par notre relais Drive */
    <img src={ad.mediaUrl} alt={ad.advertiser || "Publicité"} className={className} />
  );
}

/** Bouton visible « Découvrir » : montre que la pub est cliquable (même lien compté que le visuel). */
const Cta = ({ ad, big }: { ad: TransferAdView; big?: boolean }) =>
  ad.clickUrl ? (
    <a
      href={ad.clickUrl}
      target="_blank"
      rel="noopener sponsored"
      className={`absolute z-10 flex items-center gap-1.5 rounded-full bg-white font-bold text-[#0b1d3c] shadow-lg transition hover:scale-105 ${big ? "bottom-10 right-10 px-5 py-2.5 text-sm" : "bottom-3 left-3 px-3 py-1.5 text-xs"}`}
    >
      Découvrir{ad.advertiser ? ` ${ad.advertiser}` : ""} <span aria-hidden>↗</span>
    </a>
  ) : null;

const Label = ({ ad }: { ad: TransferAdView }) => (
  <span className="pointer-events-none absolute bottom-3 right-3 rounded-chip bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white/90">
    Publicité{ad.advertiser ? ` · ${ad.advertiser}` : ""}
  </span>
);

/** Fond plein écran : à placer en premier enfant d'un conteneur `relative`. */
export function TransferWallpaper({ ad }: { ad: TransferAdView }) {
  const media = <Media ad={ad} className="h-full w-full object-cover" />;
  return (
    <div className="absolute inset-0 overflow-hidden">
      {ad.clickUrl ? (
        <a href={ad.clickUrl} target="_blank" rel="noopener sponsored" className="block h-full w-full" aria-label={`Publicité ${ad.advertiser}`.trim()}>
          {media}
        </a>
      ) : (
        media
      )}
      <Cta ad={ad} big />
      <Label ad={ad} />
    </div>
  );
}

export function TransferBanner({ ad }: { ad: TransferAdView }) {
  const media = <Media ad={ad} className="h-full w-full object-cover" />;
  return (
    <div className="relative aspect-[16/5] w-full overflow-hidden rounded-card bg-black/20">
      {ad.clickUrl ? (
        <a href={ad.clickUrl} target="_blank" rel="noopener sponsored" className="block h-full w-full" aria-label={`Publicité ${ad.advertiser}`.trim()}>
          {media}
        </a>
      ) : (
        media
      )}
      <Cta ad={ad} />
      <Label ad={ad} />
    </div>
  );
}

/** Page publique : pub en fond (grand écran) ou bannière sous la carte ; sur téléphone, toujours en bannière. */
export function TransferPageFrame({ ad, children }: { ad: TransferAdView | null; children: React.ReactNode }) {
  const wallpaper = ad?.format === "wallpaper";
  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top_left,#1d3f9e_0%,#0b1f5c_55%,#06123a_100%)]">
      {wallpaper && (
        <div className="hidden md:block">
          <TransferWallpaper ad={ad} />
        </div>
      )}
      <div className="pointer-events-none relative z-10 flex min-h-screen flex-col gap-4 p-4 md:p-10">
        <div className="pointer-events-auto w-full max-w-[420px]">{children}</div>
        {ad && (
          <div className={`pointer-events-auto w-full max-w-[420px] ${wallpaper ? "md:hidden" : ""}`}>
            <TransferBanner ad={ad} />
          </div>
        )}
        <p className="pointer-events-auto mt-auto text-[11px] text-white/60">
          LGEF Transfer — Ligue du Grand Est de Football ·{" "}
          <a href="/privacy" className="underline hover:text-white">
            Confidentialité
          </a>
        </p>
      </div>
    </div>
  );
}
