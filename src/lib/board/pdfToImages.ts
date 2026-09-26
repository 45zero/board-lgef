"use client";

/**
 * Convertit un PDF en images JPEG (une par page, 10 max — la limite d'un carrousel Instagram),
 * dans le navigateur avec pdf.js : ni Facebook ni Instagram n'acceptent de PDF, on publie donc
 * ses pages comme une galerie de photos.
 */
export async function pdfToJpegFiles(file: File, maxPages = 10): Promise<File[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const base = file.name.replace(/\.pdf$/i, "");
  const pages: File[] = [];

  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const page = await pdf.getPage(n);
    // ~1440 px de large : net sur Instagram (1080 px) sans produire des fichiers énormes.
    const scale = 1440 / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Conversion de la page impossible."))), "image/jpeg", 0.9)
    );
    pages.push(new File([blob], `${base}-page-${n}.jpg`, { type: "image/jpeg" }));
  }

  await pdf.cleanup();
  return pages;
}
