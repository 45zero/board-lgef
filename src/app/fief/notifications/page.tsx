"use client";

import { MemberGate } from "@/components/fief/shell";
import { NotificationsList, PushToggle } from "@/components/fief/notifications";

// Notifications FIEF de la membre (fief_notifications) : toutes / non lues ; ouvrir la page marque comme lu.
// Sur ordinateur, la cloche de la barre du haut ouvre la même liste en fenêtre.

export default function FiefNotificationsPage() {
  return (
    <MemberGate>
      {() => (
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-extrabold">Notifications</h1>
          <PushToggle variant="row" />
          <NotificationsList />
        </div>
      )}
    </MemberGate>
  );
}
