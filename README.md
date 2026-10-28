# AssibaService

Plateforme togolaise de mise en relation entre clients et prestataires de services, avec paiement sécurisé par T-Money et Flooz.

## Organisation

- Pages du site : fichiers `.html` à la racine, styles et scripts dans `assets/`.
- API : une seule fonction Vercel, `api/index.js`, qui aiguille vers `lib/routes/*.js`.
- Base de données : PostgreSQL (Neon). Le schéma (`lib/schema.js`) est créé automatiquement au premier appel.
- Fichiers envoyés (photos, pièces d'identité) : stockés en base, jamais publics, servis par `/api/files/:id` après contrôle des droits.

## Variables d'environnement (Vercel)

| Variable | Obligatoire | Rôle |
| --- | --- | --- |
| `DATABASE_URL` | oui | Ajoutée automatiquement quand la base Neon est reliée au projet |
| `JWT_SECRET` | oui | Clé de signature des sessions (48 caractères aléatoires minimum) |
| `ADMIN_PHONE`, `ADMIN_PASSWORD` | au premier lancement | Créent le compte administrateur s'il n'en existe aucun |
| `ADMIN_EMAIL` | non | E-mail du compte administrateur |
| `PAY_TMONEY_NUMBER`, `PAY_FLOOZ_NUMBER` | conseillé | Numéros marchands affichés sur la page de paiement |
| `PAY_BENEFICIARY` | non | Nom du bénéficiaire affiché (par défaut AssibaService) |
| `PAYGATE_AUTH_TOKEN` | non | Active le paiement automatique PayGate Global ; URL de retour à déclarer chez PayGate : `/api/payments/paygate/callback` |
| `RESEND_API_KEY`, `MAIL_FROM` | non | Envoi des e-mails de mot de passe oublié |
| `SITE_URL` | non | Adresse du site utilisée dans les liens envoyés |

## Parcours d'une mission

1. Le client publie une demande et paie 2 000 FCFA de mise en relation.
2. Les prestataires validés de la catégorie font des offres.
3. Le client choisit une offre et paie le montant à AssibaService (séquestre).
4. Le prestataire intervient puis déclare la mission terminée.
5. Le client valide : le prestataire est crédité du montant moins la commission (0 % en dépannage, 5 % sinon).
6. Le prestataire demande un retrait ; l'administrateur effectue le transfert et note la référence.

En cas de problème, client ou prestataire ouvre un litige ; l'administrateur décide (paiement du prestataire ou remboursement du client).

## Routine d'administration (`admin.html`)

- **Paiements** : vérifier chaque référence dans l'historique du numéro marchand, puis confirmer ou refuser.
- **Prestataires** : contrôler l'inscription payée et la pièce d'identité, appeler la personne, puis activer.
- **Litiges**, **Retraits**, **Mots de passe** : à traiter chaque jour.

## Développement local

```bash
npm install
DATABASE_URL=postgres://user:mdp@localhost:5432/asb ADMIN_PHONE=90000000 ADMIN_PASSWORD=motdepasse node scripts/dev-server.js
# puis, dans un autre terminal :
BASE=http://localhost:3000 ADMIN_PHONE=90000000 ADMIN_PASSWORD=motdepasse node scripts/test-api.js
```
