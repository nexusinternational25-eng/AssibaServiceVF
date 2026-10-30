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

## Application Android

- Code : `android/` (une vue web plein écran sur le site, avec envoi de photos, géolocalisation, liens téléphone et WhatsApp, page hors ligne).
- Compilation : GitHub Actions (`.github/workflows/android.yml`) produit un APK aligné **non signé** dans `android/dist/`, puis le teste sur un émulateur Android 14 (capture dans `android/dist/test/`).
- Signature : sur le poste qui détient la clé, jamais dans la CI :
  `java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED -cp apksig-2.3.0.jar:android/sign SignApk android/dist/AssibaService-X-unsigned.apk downloads/AssibaService.apk assibaservice-release.jks store.pass`
- Nouvelle version : augmenter `VERSION` dans `android/src/com/assibaservice/app/BuildInfo.java` et le nombre dans `android/version-code`, pousser, signer, remplacer `downloads/AssibaService.apk`.
- **La clé de signature (`assibaservice-release.jks`) et son mot de passe ne sont pas dans le dépôt.** Sans elle, impossible de publier une mise à jour que les téléphones acceptent : gardez-en deux copies en lieu sûr.
- `/.well-known/assetlinks.json` contient l'empreinte de la clé : les liens du site s'ouvrent directement dans l'application.
