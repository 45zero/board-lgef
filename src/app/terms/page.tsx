export const metadata = {
  title: "Conditions d'utilisation — Board LGEF",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-shell px-6 py-12">
      <div className="mx-auto max-w-[720px] rounded-panel border border-line bg-card p-8 shadow-card">
        <div className="font-mono text-[10px] tracking-[0.12em] text-ink-4 uppercase">
          Board LGEF
        </div>
        <h1 className="mt-2 text-xl font-extrabold text-ink">
          Conditions d&apos;utilisation
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          Dernière mise à jour : {new Date().toLocaleDateString("fr-FR", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-2">
          <section>
            <h2 className="mb-2 text-base font-bold text-ink">1. Objet</h2>
            <p>
              Board LGEF est un outil de travail interne réservé aux membres
              et collaborateurs de la Ligue Grand Est de Football, destiné à la
              gestion du calendrier d&apos;événements, des demandes de
              couverture média et de l&apos;affectation de techniciens.
              L&apos;accès à l&apos;application n&apos;est pas ouvert au
              public.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">2. Accès au service</h2>
            <p>
              L&apos;accès est accordé individuellement par
              l&apos;administrateur de l&apos;application. Chaque utilisateur
              est responsable de la confidentialité de ses identifiants et de
              l&apos;usage fait de son compte.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">
              3. Connexion à un compte Google
            </h2>
            <p>
              L&apos;application propose la connexion optionnelle d&apos;un
              compte Google afin de synchroniser des événements avec Google
              Agenda, d&apos;envoyer des notifications par Gmail et de gérer
              des fichiers liés à la couverture média dans Google Drive. Cette
              connexion est facultative et peut être révoquée à tout moment
              depuis les paramètres du compte Google de l&apos;utilisateur.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">
              4. Usage acceptable
            </h2>
            <p>
              L&apos;utilisateur s&apos;engage à utiliser l&apos;application
              uniquement dans le cadre de ses missions au sein de
              l&apos;organisation, et à ne pas tenter d&apos;accéder à des
              données ou fonctionnalités qui ne lui sont pas destinées.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">
              5. Disponibilité et évolutions
            </h2>
            <p>
              L&apos;application est fournie en l&apos;état, dans le cadre
              d&apos;un usage interne. Des interruptions ou évolutions
              peuvent survenir sans préavis. Aucune garantie de disponibilité
              continue n&apos;est apportée.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">6. Contact</h2>
            <p>
              Pour toute question relative à ces conditions
              d&apos;utilisation, contactez : lgefytb@gmail.com
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
