"use client";

import { useEffect, useState } from "react";
import { Sparkles, X, PanelLeft, LayoutGrid, LogOut } from "lucide-react";
import type { BoardPreferences, NavStyle, ContextPanelWidgets } from "@/hooks/board/useBoardPreferences";
import { useNotificationPreferences } from "@/hooks/board/useNotificationPreferences";
import { useUserRole } from "@/hooks/board/useUserRole";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { getBoardDriveAccountId, setBoardDriveAccount } from "@/app/actions/board-settings";
import { Toggle } from "@/components/board/Toggle";
import { useAuth } from "@/contexts/AuthContext";

/** Compte connecté : déconnexion puis retour à la page de connexion pour se connecter avec un autre compte. */
function AccountSection() {
  const { user, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);

  const handleLogout = async () => {
    setLeaving(true);
    try {
      await logout();
    } finally {
      // Rechargement complet : aucune donnée de l'ancien compte ne reste en mémoire.
      window.location.assign("/login");
    }
  };

  return (
    <div className="mt-5">
      <div className="mb-2 font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">Compte</div>
      <div className="flex items-center justify-between gap-3 rounded-btn border border-line p-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-4">Connecté en tant que</div>
          <div className="truncate text-sm font-semibold text-ink-2">{user?.email ?? "—"}</div>
        </div>
        <button
          onClick={handleLogout}
          disabled={leaving}
          className="flex shrink-0 items-center gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover disabled:opacity-50"
        >
          <LogOut size={13} />
          {leaving ? "Déconnexion…" : "Changer de compte"}
        </button>
      </div>
    </div>
  );
}

/** Réservé aux admins/super users : désigne quel compte Google connecté reçoit les médias d'événements de tout le monde. */
function DriveSettingsSection() {
  const role = useUserRole();
  const canManage = role.isAdmin || role.isSuperUser;
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof getMyConnectedAccounts>>>([]);
  const [boardAccountId, setBoardAccountIdState] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    getMyConnectedAccounts().then(setAccounts);
    getBoardDriveAccountId().then(setBoardAccountIdState);
  }, [canManage]);

  if (!canManage) return null;
  const googleAccounts = accounts.filter((a) => a.provider === "google");

  return (
    <div className="mt-5">
      <div className="mb-2 font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">Drive du board</div>
      <div className="space-y-2 rounded-btn border border-line p-3">
        <p className="text-xs text-ink-4">
          Les médias uploadés sur les événements — par n&rsquo;importe qui — partent dans ce compte Drive, dans un
          dossier « Médias ».
        </p>
        {googleAccounts.length === 0 ? (
          <a href="/api/oauth/google/start" className="text-xs font-semibold text-link hover:underline">
            Connecter un compte Google
          </a>
        ) : (
          googleAccounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-btn bg-subtle px-2.5 py-2">
              <span className="min-w-0 truncate text-sm text-ink-2">{a.email}</span>
              {boardAccountId === a.id ? (
                <span className="shrink-0 rounded-full bg-good-bg px-2 py-0.5 text-[10px] font-bold text-good">
                  Actif
                </span>
              ) : (
                <button
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await setBoardDriveAccount(a.id);
                      setBoardAccountIdState(a.id);
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="shrink-0 text-xs font-semibold text-link hover:underline disabled:opacity-50"
                >
                  Définir comme Drive du board
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const WIDGET_ROWS: { key: keyof ContextPanelWidgets; title: string; subtitle: string }[] = [
  { key: "today", title: "Aujourd'hui", subtitle: "Vos réunions du jour" },
  { key: "trello", title: "Mes cartes Trello", subtitle: "Cartes assignées à échéance proche" },
  { key: "activity", title: "Activité du Board", subtitle: "Flux inter-applications" },
  { key: "migration", title: "Avancement migration", subtitle: "Applications déjà intégrées" },
];

export function BoardSettingsModal({
  prefs,
  onUpdate,
  onUpdateWidgets,
  onClose,
}: {
  prefs: BoardPreferences;
  onUpdate: (partial: Partial<BoardPreferences>) => void;
  onUpdateWidgets: (partial: Partial<ContextPanelWidgets>) => void;
  onClose: () => void;
}) {
  const setNavStyle = (v: NavStyle) => onUpdate({ navStyle: v });
  const notif = useNotificationPreferences();

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-4 top-[76px] z-50 max-h-[calc(100vh-92px)] w-[380px] max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain rounded-panel border border-line bg-card p-5 shadow-modal">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-gradient-to-br from-navy to-red text-white">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="text-sm font-extrabold text-ink">Paramètres du Board</div>
              <div className="text-xs text-ink-4">Propres à votre compte</div>
            </div>
          </div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
            Navigation des applications
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setNavStyle("rail")}
              className={`flex w-full items-center gap-3 rounded-btn border-2 px-3 py-2.5 text-left ${
                prefs.navStyle === "rail" ? "border-red" : "border-line"
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-subtle text-ink-2">
                <PanelLeft size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">Rail latéral</span>
                <span className="block text-xs text-ink-4">Icônes à gauche, sections en pastilles</span>
              </span>
              {prefs.navStyle === "rail" && <span className="shrink-0 text-red">✓</span>}
            </button>
            <button
              onClick={() => setNavStyle("dock")}
              className={`flex w-full items-center gap-3 rounded-btn border-2 px-3 py-2.5 text-left ${
                prefs.navStyle === "dock" ? "border-red" : "border-line"
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-subtle text-ink-2">
                <LayoutGrid size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">Dock en bas</span>
                <span className="block text-xs text-ink-4">Grandes icônes en bas de l&rsquo;écran</span>
              </span>
              {prefs.navStyle === "dock" && <span className="shrink-0 text-red">✓</span>}
            </button>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">Notifications</div>
          <div className="space-y-3 rounded-btn border border-line p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-2">Notifications par e-mail</div>
                <div className="text-xs text-ink-4">Rappels et demandes envoyés aussi par e-mail</div>
              </div>
              <Toggle on={notif.notifyEmail} onClick={() => notif.setNotifyEmail(!notif.notifyEmail)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-2">Notifications push</div>
                <div className="text-xs text-ink-4">
                  Bientôt disponible — préparé pour la future application mobile
                </div>
              </div>
              <Toggle on={notif.notifyPush} onClick={() => notif.setNotifyPush(!notif.notifyPush)} />
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">Récapitulatif</div>
            <button
              onClick={() => onUpdate({ contextPanelOpen: !prefs.contextPanelOpen })}
              className="text-xs font-semibold text-link hover:underline"
            >
              {prefs.contextPanelOpen ? "Masquer la colonne" : "Afficher la colonne"}
            </button>
          </div>
          <div className="space-y-3 rounded-btn border border-line p-3">
            {WIDGET_ROWS.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink-2">{row.title}</div>
                  <div className="text-xs text-ink-4">{row.subtitle}</div>
                </div>
                <Toggle
                  on={prefs.contextPanelWidgets[row.key]}
                  onClick={() => onUpdateWidgets({ [row.key]: !prefs.contextPanelWidgets[row.key] })}
                />
              </div>
            ))}
          </div>
        </div>

        <DriveSettingsSection />

        <AccountSection />
      </div>
    </>
  );
}
