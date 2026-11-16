import "server-only";
import { esc, siteUrl } from "@/lib/email/notificationEmails";
import { isTransactionalEmailConfigured, sendTransactionalBatch, type EmailMessage } from "@/lib/email/transactional";

// E-mails FIEF : même circuit d'envoi que le board (Brevo, sinon Resend), habillage FIEF (bleu marine,
// liseré rouge, écusson « Graines d'éducatrices »).

const NAVY = "#0E2754";
const RED = "#D7262E";

export interface FiefEmail {
  to: string;
  firstName: string | null;
  subject: string;
  paragraphs: string[];
  link?: { href: string; label: string };
  footer?: string;
}

function renderFiefEmail(opts: FiefEmail): EmailMessage {
  const crest = `${siteUrl()}/fief/crest.png`;
  const html = `<div style="background:#EEF2F8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;color:${NAVY}">
  <div style="background:${NAVY};padding:18px 24px;border-bottom:4px solid ${RED}">
    <table style="border-collapse:collapse"><tr>
      <td style="padding-right:14px"><img src="${esc(crest)}" alt="FIEF" width="44" style="display:block;width:44px;height:auto" /></td>
      <td style="color:#fff"><div style="font-size:22px;font-weight:900;font-style:italic;letter-spacing:.02em">FIEF</div><div style="font-size:11px;opacity:.8">Femmes Investies dans l'Encadrement du Football</div></td>
    </tr></table>
  </div>
  <div style="padding:24px">
    <div style="font-size:14px;color:#64748b">Bonjour${opts.firstName ? ` ${esc(opts.firstName)}` : ""},</div>
    <h1 style="font-size:20px;line-height:1.3;margin:8px 0 10px">${esc(opts.subject)}</h1>
    ${opts.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 10px;color:#1e293b">${esc(p)}</p>`).join("")}
    ${opts.link ? `<div style="margin-top:14px"><a href="${esc(opts.link.href)}" style="background:${NAVY};color:#fff;display:inline-block;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">${esc(opts.link.label)}</a></div>` : ""}
  </div>
  <div style="padding:14px 24px;background:#F8FAFC;font-size:12px;color:#64748b;line-height:1.5">
    ${esc(opts.footer ?? "FIEF — Femmes Investies dans l'Encadrement du Football, le réseau proposé par la Ligue du Grand Est de Football.")}
  </div>
</div></div>`;
  const text = [
    `Bonjour${opts.firstName ? ` ${opts.firstName}` : ""},`,
    opts.subject,
    ...opts.paragraphs,
    opts.link ? `${opts.link.label} : ${opts.link.href}` : "",
    "— FIEF, Ligue du Grand Est de Football",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { to: [opts.to], subject: opts.subject, html, text };
}

/** Un e-mail FIEF ; vrai s'il est parti. */
export async function sendFiefEmail(opts: FiefEmail) {
  return (await sendFiefEmails([opts])) > 0;
}

/** Plusieurs e-mails FIEF personnalisés, par lots ; renvoie le nombre d'e-mails partis. */
export async function sendFiefEmails(list: FiefEmail[]) {
  if (!list.length) return 0;
  if (!isTransactionalEmailConfigured()) {
    console.warn("[fief] envoi d'e-mails non configuré (Brevo / Resend) —", list.length, "e-mail(s) non envoyé(s)");
    return 0;
  }
  const { sent } = await sendTransactionalBatch(list.map(renderFiefEmail), async () => {});
  return sent;
}
