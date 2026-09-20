export const metadata = {
  title: "Politique de confidentialité — Board LGEF",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-shell px-6 py-12">
      <div className="mx-auto max-w-[720px] rounded-panel border border-line bg-card p-8 shadow-card">
        <div className="font-mono text-[10px] tracking-[0.12em] text-ink-4 uppercase">
          Board LGEF
        </div>
        <h1 className="mt-2 text-xl font-extrabold text-ink">
          Politique de confidentialité
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
              Board LGEF (« l&apos;application ») est un outil de travail interne à la
              Ligue Grand Est de Football, permettant à ses membres de gérer un
              calendrier d&apos;événements, des demandes de couverture média et
              l&apos;affectation de techniciens. Cette page décrit les données
              collectées et leur usage.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">2. Données collectées</h2>
            <p>Selon votre usage de l&apos;application, nous collectons :</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Votre identifiant de compte (email) et votre rôle au sein de
                l&apos;organisation.
              </li>
              <li>
                Les événements, affectations et réponses que vous créez ou
                modifiez dans l&apos;application.
              </li>
              <li>
                Si vous connectez un compte Google : votre adresse email Google,
                et, selon les autorisations accordées, l&apos;accès à votre
                Gmail (envoi/gestion de messages liés aux notifications de
                l&apos;application), à votre Google Agenda (création/mise à jour
                d&apos;événements synchronisés) et à Google Drive (fichiers liés
                à la couverture média).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">
              3. Utilisation des données
            </h2>
            <p>
              Les données sont utilisées exclusivement pour faire fonctionner
              l&apos;application : afficher le calendrier, gérer les
              affectations et couvertures, envoyer des notifications
              pertinentes, et synchroniser les événements avec votre Google
              Agenda lorsque vous l&apos;avez explicitement autorisé.
            </p>
            <p className="mt-2">
              Nous ne vendons ni ne partageons vos données avec des tiers à des
              fins commerciales ou publicitaires.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">4. Stockage et sécurité</h2>
            <p>
              Les données sont stockées dans une base de données hébergée
              (Supabase/PostgreSQL) accessible uniquement aux membres autorisés
              de l&apos;organisation. Les jetons d&apos;accès Google sont
              chiffrés et utilisés uniquement côté serveur pour les opérations
              autorisées.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">
              5. Accès aux API Google
            </h2>
            <p>
              L&apos;utilisation par Board LGEF des informations reçues des API
              Google respecte les{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Google API Services User Data Policy
              </a>
              , y compris les exigences relatives à l&apos;utilisation limitée
              (Limited Use).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">6. Vos droits</h2>
            <p>
              Vous pouvez à tout moment révoquer l&apos;accès de Board LGEF à
              votre compte Google depuis les{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                paramètres de sécurité de votre compte Google
              </a>
              . Pour toute demande d&apos;accès, de rectification ou de
              suppression de vos données, contactez-nous à l&apos;adresse
              ci-dessous.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-bold text-ink">7. Contact</h2>
            <p>
              Pour toute question relative à cette politique de
              confidentialité, contactez : lgefytb@gmail.com
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
