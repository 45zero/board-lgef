import "server-only";

export interface RegistrationEmailContent {
  eventTitle: string;
  eventDateLabel: string;
  eventLocation: string | null;
  message: string;
  imageUrl: string | null;
  videoUrl: string | null;
  links: { label: string; url: string }[];
  yesUrl: string;
  noUrl: string;
}

/** Email HTML "design" (table-based, compatible clients mail) — invitation à un événement avec 2 CTA de réponse. */
export function buildRegistrationEmailHtml(c: RegistrationEmailContent): string {
  const messageHtml = c.message
    .split("\n")
    .map((line) => `<p style="margin:0 0 12px;color:#27334c;font-size:15px;line-height:1.5;">${escapeHtml(line)}</p>`)
    .join("");

  const linksHtml = c.links.length
    ? `<div style="margin:16px 0;">${c.links
        .map(
          (l) =>
            `<a href="${escapeAttr(l.url)}" style="display:block;color:#12305f;font-size:14px;margin-bottom:6px;text-decoration:underline;">${escapeHtml(l.label)}</a>`
        )
        .join("")}</div>`
    : "";

  const videoHtml = c.videoUrl
    ? `<p style="margin:16px 0;"><a href="${escapeAttr(c.videoUrl)}" style="color:#12305f;font-weight:bold;text-decoration:underline;">▶ Voir la vidéo</a></p>`
    : "";

  const imageHtml = c.imageUrl
    ? `<img src="${escapeAttr(c.imageUrl)}" alt="" style="width:100%;max-width:560px;border-radius:12px;display:block;margin:0 0 20px;" />`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f2f5fb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#0b1d3c;padding:24px 28px;">
                <p style="margin:0;color:#ffffff;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;">Invitation</p>
                <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;">${escapeHtml(c.eventTitle)}</h1>
                <p style="margin:8px 0 0;color:#ffffff;font-size:14px;opacity:0.85;">
                  ${escapeHtml(c.eventDateLabel)}${c.eventLocation ? ` — ${escapeHtml(c.eventLocation)}` : ""}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                ${imageHtml}
                ${messageHtml}
                ${videoHtml}
                ${linksHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;">
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
