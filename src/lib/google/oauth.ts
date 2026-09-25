import "server-only";
import { google } from "googleapis";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

function redirectUri() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/oauth/google/callback`;
}

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  );
}

export function buildGoogleAuthUrl(state: string) {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    // select_account : Google propose toujours de choisir le compte (sinon il reprend celui déjà ouvert).
    // consent : garantit un refresh_token à chaque connexion.
    prompt: "select_account consent",
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const client = createOAuth2Client();
  client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const { data } = await oauth2.userinfo.get();
  return data; // { email, id (sub), name, picture, ... }
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials; // { access_token, expiry_date, ... }
}
