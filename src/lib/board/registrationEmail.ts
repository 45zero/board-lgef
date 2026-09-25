import "server-only";

export type BlockAlign = "left" | "center" | "right";

type BlockBase = { id: string; align?: BlockAlign };

export type EmailBlock =
  | (BlockBase & { type: "text"; content: string })
  | (BlockBase & { type: "image"; url: string })
  | (BlockBase & { type: "date" })
  | (BlockBase & { type: "banner"; url: string })
  | (BlockBase & { type: "map"; label: string; address: string })
  | (BlockBase & { type: "video"; url: string })
  | (BlockBase & { type: "pdf"; url: string; filename: string })
  | (BlockBase & { type: "signature"; name: string; title: string; imageUrl: string | null })
  | (BlockBase & { type: "buttons" });

export interface RegistrationEmailContent {
  eventTitle: string;
  eventDateLabel: string;
  eventLocation: string | null;
  logoUrl: string;
  blocks: EmailBlock[];
  mapsApiKey: string | null;
  yesUrl: string;
  noUrl: string;
}

/** Contenu (sans marge propre — la marge/l'alignement sont appliqués par le conteneur du bloc). */
function renderBlock(block: EmailBlock, c: RegistrationEmailContent): string {
  switch (block.type) {
    case "text":
      return block.content
        .split("\n")
        .map((line) => `<p style="margin:0 0 8px;color:#27334c;font-size:15px;line-height:1.5;">${escapeHtml(line)}</p>`)
        .join("");

    case "date":
      return `<p style="margin:0;color:#0b1d3c;font-size:16px;font-weight:bold;">📅 ${escapeHtml(c.eventDateLabel)}${c.eventLocation ? ` — ${escapeHtml(c.eventLocation)}` : ""}</p>`;

    case "image":
      return block.url
        ? `<img src="${escapeAttr(block.url)}" alt="" style="max-width:504px;border-radius:12px;display:inline-block;" />`
        : "";

    case "banner":
      return block.url
        ? `<img src="${escapeAttr(block.url)}" alt="" style="max-width:504px;display:inline-block;border-radius:8px;" />`
        : "";

    case "map": {
      if (!block.address) return "";
      const mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(block.address)}`;
      const staticMapImg = c.mapsApiKey
        ? `<img
            src="https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(block.address)}&zoom=16&size=560x220&scale=2&markers=color:red%7C${encodeURIComponent(block.address)}&key=${c.mapsApiKey}"
            alt="Carte — ${escapeHtml(block.address)}"
            style="max-width:504px;border-radius:12px;display:inline-block;border:1px solid #eaeff7;"
          />`
        : `<div style="max-width:504px;border-radius:12px;border:1px solid #eaeff7;background:#f7f9fd;padding:28px 16px;text-align:center;display:inline-block;">
            <span style="font-size:22px;">📍</span>
            <p style="margin:8px 0 0;color:#12305f;font-weight:bold;font-size:13px;">Ouvrir l&rsquo;itinéraire dans Google Maps</p>
          </div>`;
      return `<div>
          <p style="margin:0 0 8px;color:#27334c;font-size:14px;font-weight:bold;">📍 ${escapeHtml(block.label || "Emplacement")}</p>
          <a href="${mapsSearchUrl}" style="text-decoration:none;">${staticMapImg}</a>
          <p style="margin:6px 0 0;color:#79859a;font-size:12px;">${escapeHtml(block.address)} — touchez la carte pour l&rsquo;itinéraire</p>
        </div>`;
    }

    case "video":
      return block.url
        ? `<a href="${escapeAttr(block.url)}" style="text-decoration:none;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:320px;max-width:504px;background:#0b1d3c;border-radius:12px;display:inline-table;">
              <tr>
                <td align="center" style="padding:36px 20px;">
                  <span style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:999px;background:#ffffff;color:#0b1d3c;font-size:20px;">▶</span>
                  <p style="margin:10px 0 0;color:#ffffff;font-weight:bold;font-size:14px;">Voir la vidéo</p>
                </td>
              </tr>
            </table>
          </a>`
        : "";

    case "pdf":
      return block.url
        ? `<a href="${escapeAttr(block.url)}" style="display:inline-flex;align-items:center;gap:8px;background:#f7f9fd;border:1px solid #eaeff7;border-radius:10px;padding:12px 14px;color:#12305f;font-weight:bold;font-size:13px;text-decoration:none;">
            📄 ${escapeHtml(block.filename || "Document joint")}
          </a>`
        : "";

    case "signature":
      return block.name || block.imageUrl
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;">
            <tr>
              ${block.imageUrl ? `<td style="padding-right:14px;"><img src="${escapeAttr(block.imageUrl)}" alt="Signature" style="height:54px;display:block;" /></td>` : ""}
              <td>
                ${block.name ? `<p style="margin:0;color:#0b1d3c;font-weight:bold;font-size:14px;">${escapeHtml(block.name)}</p>` : ""}
                ${block.title ? `<p style="margin:2px 0 0;color:#79859a;font-size:12px;">${escapeHtml(block.title)}</p>` : ""}
              </td>
            </tr>
          </table>`
        : "";

    case "buttons":
      return buttonsHtml(c);
  }
}

function buttonsHtml(c: RegistrationEmailContent): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;">
    <tr>
      <td style="padding-right:10px;">
        <a href="${escapeAttr(c.yesUrl)}" style="display:inline-block;background:#146447;color:#ffffff;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:10px;text-decoration:none;">
          ✓ Je participe
        </a>
      </td>
      <td>
        <a href="${escapeAttr(c.noUrl)}" style="display:inline-block;background:#eaeff7;color:#27334c;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:10px;text-decoration:none;">
          Je n&rsquo;y participerai pas
        </a>
      </td>
    </tr>
  </table>`;
}

/** Email HTML "design" (table-based, compatible clients mail) — blocs rendus dans l'ordre choisi, chacun avec son propre alignement. */
export function buildRegistrationEmailHtml(c: RegistrationEmailContent): string {
  const hasButtons = c.blocks.some((b) => b.type === "buttons");
  const blocks = hasButtons ? c.blocks : [...c.blocks, { id: "auto-buttons", type: "buttons" as const }];
  const bodyHtml = blocks
    .map((b) => {
      const inner = renderBlock(b, c);
      if (!inner) return "";
      return `<div style="text-align:${b.align ?? "left"};margin:0 0 20px;">${inner}</div>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f2f5fb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#0b1d3c;padding:20px 28px;">
                <img src="${escapeAttr(c.logoUrl)}" alt="LGEF" style="height:40px;display:block;margin:0 0 14px;" />
                <p style="margin:0;color:#ffffff;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;">Invitation</p>
                <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;">${escapeHtml(c.eventTitle)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background:#f7f9fd;">
                <p style="margin:0;color:#79859a;font-size:11px;">Board LGEF — réponse en un clic, aucune connexion requise.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
