"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Corps de message Gmail. Beaucoup de mails n'ont qu'une partie HTML : on la rend dans une iframe
 * sandboxée, SANS `allow-scripts` — aucun script du mail ne s'exécute, et c'est ce qui rend sûr
 * `allow-same-origin`, nécessaire uniquement pour mesurer la hauteur du contenu. L'iframe prend
 * ainsi toute la hauteur du mail (pas de cadre ni de défilement interne : c'est la page qui défile),
 * avec un style qui adapte images et tableaux à la largeur de l'écran.
 */
const FIT_STYLES = `<meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"><style>
html,body{margin:0;padding:0;background:#fff}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1f2937;word-wrap:break-word;overflow-wrap:anywhere}
img,video{max-width:100%!important;height:auto!important}
table{max-width:100%!important}
pre{white-space:pre-wrap}
</style>`;

export function EmailBody({ bodyText, bodyHtml }: { bodyText: string; bodyHtml: string; className?: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 40));
  }, []);

  // Les images du mail arrivent après le chargement : on réajuste la hauteur quand le contenu grandit.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !bodyHtml) return;
    let observer: ResizeObserver | null = null;
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (body && "ResizeObserver" in window) {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [bodyHtml, measure]);

  if (bodyHtml) {
    return (
      <iframe
        ref={frameRef}
        srcDoc={FIT_STYLES + bodyHtml}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        title="Contenu du message"
        scrolling="no"
        style={{ height }}
        className="block w-full border-0 bg-white"
      />
    );
  }
  if (bodyText) {
    return <div className="whitespace-pre-wrap text-sm text-ink-2">{bodyText}</div>;
  }
  return <div className="text-sm text-ink-4">(message vide)</div>;
}
