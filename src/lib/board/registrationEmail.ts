import "server-only";

export interface RegistrationEmailContent {
  eventTitle: string;
  eventDateLabel: string;
  eventLocation: string | null;
  message: string;
  logoUrl: string;
  invitationCardUrl: string | null;
  bannerUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  pdfUrl: string | null;
  pdfFilename: string | null;
  parkingLabel: string | null;
  parkingAddress: string | null;
  mapsApiKey: string | null;
  links: { label: string; url: string }[];
  signatoryName: string | null;
  signatoryTitle: string | null;
  signatureImageUrl: string | null;
  yesUrl: string;
  noUrl: string;
}

/** Email HTML "design" (table-based, compatible clients mail) — invitation à un événement avec 2 CTA de réponse. */
export function buildRegistrationEmailHtml(c: RegistrationEmailContent): string {
  const messageHtml = c.message
    .split("\n")
    .map((line) => `<p style="margin:0 0 12px;color:#27334c;font-size:15px;line-height:1.5;">${escapeHtml(line)}</p>`)
    .join("");

  const invitationCardHtml = c.invitationCardUrl
    ? `<img src="${escapeAttr(c.invitationCardUrl)}" alt="Carton d'invitation" style="width:100%;max-width:504px;border-radius:12px;display:block;margin:0 0 20px;" />`
    : "";

  const imageHtml = c.imageUrl
    ? `<img src="${escapeAttr(c.imageUrl)}" alt="" style="width:100%;max-width:504px;border-radius:12px;display:block;margin:0 0 20px;" />`
    : "";

  const bannerHtml = c.bannerUrl
    ? `<img src="${escapeAttr(c.bannerUrl)}" alt="" style="width:100%;max-width:504px;display:block;margin:0 0 20px;border-radius:8px;" />`
    : "";

  const parkingHtml =
    c.parkingAddress && c.mapsApiKey
      ? `<div style="margin:0 0 20px;">
          <p style="margin:0 0 8px;color:#27334c;font-size:14px;font-weight:bold;">📍 ${escapeHtml(c.parkingLabel || "Stationnement")}</p>
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.parkingAddress)}" style="display:block;">
            <img
              src="https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(c.parkingAddress)}&zoom=16&size=560x220&scale=2&markers=color:red%7C${encodeURIComponent(c.parkingAddress)}&key=${c.mapsApiKey}"
              alt="Carte — ${escapeHtml(c.parkingAddress)}"
              style="width:100%;max-width:504px;border-radius:12px;display:block;border:1px solid #eaeff7;"
            />
          </a>
          <p style="margin:6px 0 0;color:#79859a;font-size:12px;">${escapeHtml(c.parkingAddress)} — touchez la carte pour l&rsquo;itinéraire</p>
        </div>`
      : "";

  const videoHtml = c.videoUrl
    ? `<a href="${escapeAttr(c.videoUrl)}" style="display:block;text-decoration:none;margin:0 0 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1d3c;border-radius:12px;">
          <tr>
            <td align="center" style="padding:36px 20px;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:999px;background:#ffffff;color:#0b1d3c;font-size:20px;">▶</span>
              <p style="margin:10px 0 0;color:#ffffff;font-weight:bold;font-size:14px;">Voir la vidéo</p>
            </td>
          </tr>
        </table>
      </a>`
    : "";

  const pdfHtml = c.pdfUrl
    ? `<a href="${escapeAttr(c.pdfUrl)}" style="display:flex;align-items:center;gap:8px;background:#f7f9fd;border:1px solid #eaeff7;border-radius:10px;padding:12px 14px;margin:0 0 20px;color:#12305f;font-weight:bold;font-size:13px;text-decoration:none;">
        📄 ${escapeHtml(c.pdfFilename || "Document joint")}
      </a>`
    : "";

  const linksHtml = c.links.length
    ? `<div style="margin:0 0 20px;">${c.links
        .map(
          (l) =>
            `<a href="${escapeAttr(l.url)}" style="display:block;color:#12305f;font-size:14px;margin-bottom:6px;text-decoration:underline;">${escapeHtml(l.label)}</a>`
        )
        .join("")}</div>`
    : "";

  const signatureHtml =
    c.signatoryName || c.signatureImageUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px;">
          <tr>
            ${
              c.signatureImageUrl
                ? `<td style="padding-right:14px;"><img src="${escapeAttr(c.signatureImageUrl)}" alt="Signature" style="height:54px;display:block;" /></td>`
                : ""
            }
            <td>
              ${c.signatoryName ? `<p style="margin:0;color:#0b1d3c;font-weight:bold;font-size:14px;">${escapeHtml(c.signatoryName)}</p>` : ""}
              ${c.signatoryTitle ? `<p style="margin:2px 0 0;color:#79859a;font-size:12px;">${escapeHtml(c.signatoryTitle)}</p>` : ""}
            </td>
          </tr>
        </table>`
      : "";

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
                <p style="margin:8px 0 0;color:#ffffff;font-size:14px;opacity:0.85;">
                  ${escapeHtml(c.eventDateLabel)}${c.eventLocation ? ` — ${escapeHtml(c.eventLocation)}` : ""}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                ${invitationCardHtml}
                ${bannerHtml}
                ${imageHtml}
                ${messageHtml}
                ${parkingHtml}
                ${videoHtml}
                ${pdfHtml}
                ${linksHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
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
                </table>
                ${signatureHtml}
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
