// Accès aux modules du board (table module_access, sql/2026-09-29_module_access.sql). Types et
// règle partagés client/serveur. La règle fait foi en base (module_rule_matches / can_see_module) ;
// ruleMatches ci-dessous en est le miroir, pour l'aperçu « qui voit ce module » pendant la saisie.

import { BOARD_APPS } from "@/lib/board/tokens";

export interface ModuleRule {
  moduleId: string;
  /** Masqué — en préparation : visible seulement des administrateurs et super users, règle conservée. */
  hidden: boolean;
  everyone: boolean;
  roles: string[];
  specialtySlugs: string[];
  includeUserIds: string[];
  excludeUserIds: string[];
}

export type DirectoryPerson = { id: string; name: string; email: string | null; role: string; slugs: string[] };

/** Modules réglables : tous sauf l'accueil, toujours visible. */
export const CONFIGURABLE_MODULES = BOARD_APPS.filter((a) => a.id !== "accueil");
export const ALL_MODULE_IDS = BOARD_APPS.map((a) => a.id);

/** Modules déjà disponibles dans le board (les autres sont « à venir »). */
export const BUILT_MODULES = new Set(["accueil", "trello", "effectif", "mails", "calendrier", "weekend", "ged", "drive", "inscription", "cartographie", "frais", "audiovisuel"]);

export const defaultRule = (moduleId: string): ModuleRule => ({
  moduleId,
  hidden: false,
  everyone: true,
  roles: [],
  specialtySlugs: [],
  includeUserIds: [],
  excludeUserIds: [],
});

export const isElevated = (role: string) => role === "admin" || role === "super_user";

/** Même règle que module_rule_matches (SQL) : masqué > retirés > ajoutés > tout le monde > rôles / spécialités. */
export function ruleMatches(rule: ModuleRule, p: Pick<DirectoryPerson, "id" | "role" | "slugs">) {
  if (rule.hidden) return false;
  if (rule.excludeUserIds.includes(p.id)) return false;
  if (rule.includeUserIds.includes(p.id)) return true;
  if (rule.everyone) return true;
  return rule.roles.includes(p.role) || p.slugs.some((s) => rule.specialtySlugs.includes(s));
}

export const ROLE_CHOICES: { id: string; label: string }[] = [
  { id: "organizer", label: "Organisateurs" },
  { id: "technician", label: "Techniciens" },
  { id: "comite_directeur", label: "Comité directeur" },
  { id: "user", label: "Utilisateurs" },
];

export const GROUP_CHOICES: { slug: string; label: string; group: "Couverture match" | "Statut" }[] = [
  { slug: "tech-photo", label: "Photographes", group: "Couverture match" },
  { slug: "tech-video", label: "Vidéastes", group: "Couverture match" },
  { slug: "tech-salarie", label: "Salariés", group: "Statut" },
  { slug: "tech-reseau", label: "Réseau (frais)", group: "Statut" },
  { slug: "tech-prestataire", label: "Prestataires", group: "Statut" },
  { slug: "tech-benevole", label: "Bénévoles", group: "Statut" },
];
