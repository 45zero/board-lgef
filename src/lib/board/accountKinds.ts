// Comptes connectés (côté écran) : lesquels servent au mail, lesquels à l'agenda. Google : tous
// (connexion OAuth avec Gmail et Agenda) ; iCloud : selon ce qui a été coché à la connexion.

type Acc = { provider: string; scopes: string[] };

export const isMailAccount = (a: Acc) => a.provider === "google" || (a.provider === "icloud" && a.scopes.includes("icloud:mail"));
export const isCalendarAccount = (a: Acc) => a.provider === "google" || (a.provider === "icloud" && a.scopes.includes("icloud:calendar"));
export const providerName = (a: Acc) => (a.provider === "icloud" ? "iCloud" : "Google");
