# HPO Visio

Outil de réunions vidéo et d’appels du Groupe HPO. Les comptes sont créés par invitation sur la boîte HPO Mail. Les informations de chaque personne viennent de l’annuaire HPO Mail.

**Nouveautés de la version 2**

- **Contacts :** le menu Contacts remplace « Appels ». On y trouve les collègues ayant un compte, avec leur présence en ligne, et on les appelle en vidéo. L’appelé reçoit une sonnerie à l’écran.
- **Activité :** convocations, appels manqués et **rappel 10 minutes avant chaque réunion**. Le rappel arrive dans Activité et sur la boîte HPO Mail de chaque participant convié.
- **Comptes rendus :** une fiche par réunion ou appel, avec présents, absents, durée, discussion et notes de l’organisateur. **Export Word (.docx)** à déposer dans les Docs de HPO Mail.
- **Enregistrement automatique** de chaque réunion et de chaque appel, conservé par la DSID. Il est consultable, téléchargeable et supprimable dans **Admin › Enregistrements**.

| Partie | Technologie |
|---|---|
| Front | Angular 22 (composants autonomes, signaux) |
| Back | Node.js 22 + Express 5 |
| Base de données | PostgreSQL 16 |
| Vidéo | LiveKit (serveur média SFU, open source) |
| Enregistrement | LiveKit Egress (MP4) + Redis |
| Service web | nginx (sert le front, relaie `/api` et `/rtc`) |

```
Navigateur ──HTTPS──► nginx ──/api──► Express ──► PostgreSQL
    │                   └───/rtc────► LiveKit (signalisation)
    └──────── UDP 7882 / TCP 7881 ──► LiveKit (son et image)
LiveKit ──Redis──► Egress ──MP4──► volume « recordings » ◄── Express (onglet Enregistrements)
LiveKit ──webhooks (présences, fin d’enregistrement)──► Express
Express ──► HPO Mail : SMTP (e-mails), annuaire (CSV ou LDAP), mot de passe (local, LDAP ou IMAP)
```

---

## 1. Contenu du dossier

```
hpo-visio/
├── docker-compose.yml          db, redis, livekit, egress, backend, frontend (+ mailpit en dev)
├── .env.example                Configuration à copier en .env
├── database/
│   ├── init/01-schema.sql      Tables de base, réglages de sécurité
│   ├── init/02-schema-v2.sql   Appels, Activité, séances, présences, enregistrements (sert aussi de mise à jour)
│   ├── init/03-demo.sql        Annuaire fictif + 3 salles permanentes (à retirer en production)
│   └── exemple-annuaire.csv    Modèle d'import de l'annuaire HPO Mail
├── backend/                    API Express
│   ├── src/routes/             auth, invitations, meetings, calls/contacts, notifications, reports, webhook, public, admin
│   ├── src/services/           annuaire, mots de passe, e-mails, LiveKit, planificateur, comptes rendus Word, enregistrements
│   ├── src/scripts/            db-init, import-annuaire, create-admin
│   ├── assets/logo-hpo.png     Logo des comptes rendus Word
│   └── test/                   28 tests d'intégration (base réelle)
└── frontend/                   Application Angular
    ├── src/app/pages/          connexion, invitation, accueil, activité, contacts, comptes rendus, réunion, invité, admin
    ├── src/app/room/           salle LiveKit : aperçu, vignettes, discussion, salle d'attente, bandeau d'enregistrement
    ├── src/app/core/live.ts    Activité en continu + sonnerie d'appel entrant
    └── nginx/                  Configuration nginx + en-têtes de sécurité
```

---

## 2. Démarrage rapide (Docker)

Prérequis : un serveur Linux avec Docker et Docker Compose.

```bash
cp .env.example .env
```

Dans `.env`, remplissez au minimum :

| Variable | Valeur |
|---|---|
| `POSTGRES_PASSWORD` | mot de passe de la base (lettres et chiffres) |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `LIVEKIT_API_SECRET` | `openssl rand -hex 32` |
| `LIVEKIT_NODE_IP` | adresse IP du serveur, joignable par les postes (ex. `192.168.10.25`) |
| `BOOTSTRAP_ADMIN_EMAIL` | votre adresse HPO Mail (premier administrateur) |
| `BOOTSTRAP_ADMIN_PASSWORD` | votre mot de passe HPO Visio (si `AUTH_PROVIDER=local`) |
| `HPO_MAIL_DOMAINS` | domaine(s) HPO Mail autorisé(s), à vérifier |

Puis :

```bash
# Développement : les e-mails arrivent dans Mailpit (http://localhost:8025)
docker compose --profile dev up -d --build

# Production : SMTP_HOST pointe vers le serveur SMTP de HPO Mail
docker compose up -d --build
```

Le site est sur `http://localhost:8080`. Connectez-vous avec l’adresse administrateur. Un code à 6 chiffres est envoyé par e-mail, car les administrateurs ont la double authentification.

**Mise à jour d’une installation en version 1 :**

```bash
docker compose exec -T db psql -U hpo -d hpo_visio < database/init/02-schema-v2.sql
docker compose up -d --build
```

> **Caméra et micro : HTTPS obligatoire.** Les navigateurs ne les autorisent que sur `https://` ou sur `http://localhost`. Pour les autres postes, voir la section 6.

---

## 3. Développement sans Docker

```bash
# Base PostgreSQL locale
createdb hpo_visio
cd backend && cp .env.example .env      # remplir SESSION_SECRET, DATABASE_URL, BOOTSTRAP_ADMIN_*
npm install
npm run db:init -- --demo               # tables + données de démonstration (ou mise à jour v2 si la base existe)
npm run dev                             # API sur http://localhost:3000

# Serveur vidéo (binaire officiel : https://docs.livekit.io/home/self-hosting/local/)
livekit-server --dev                    # clés devkey / secret, port 7880
# (l'enregistrement en développement nécessite en plus Redis + Egress : utiliser Docker)

# Front
cd ../frontend && npm install
npm start                               # http://localhost:4200 (proxy vers l'API et LiveKit)
```

Si `SMTP_HOST` est vide, les e-mails (invitations, codes) s’affichent dans la console de l’API.

---

## 4. Brancher HPO Mail

Le branchement se règle dans `.env`, sans toucher au code. Il y a trois éléments indépendants :

### a) Envoi des e-mails (toujours nécessaire)
Renseignez `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` et `MAIL_FROM` avec le serveur SMTP de HPO Mail. Le tableau de bord Admin indique si l’envoi fonctionne.

### b) Annuaire (nom, service, fonction, site, filiale)

| `DIRECTORY_PROVIDER` | Fonctionnement | Quand le choisir |
|---|---|---|
| `db` (par défaut) | Table PostgreSQL remplie par import CSV | Marche avec n’importe quel HPO Mail |
| `ldap` | Lecture en direct dans LDAP / Active Directory | Si HPO Mail s’appuie sur un annuaire LDAP ou AD |

**Importer l’annuaire en CSV.** Séparateur `;` ou `,`. Colonnes : `email ; nom complet ; service ; fonction ; site ; filiale`. Voir `database/exemple-annuaire.csv`. Deux façons de l’importer :

- dans **Admin › Utilisateurs › Importer l’annuaire (CSV)** ;
- en ligne de commande : `npm run import:annuaire -- annuaire.csv`. Ajoutez `--complet` pour désactiver les adresses absentes du fichier.

**Synchroniser l’annuaire.** Le bouton recopie les changements de l’annuaire dans les comptes, par exemple un changement de service. C’est aussi fait automatiquement à chaque connexion.

### c) Mots de passe

| `AUTH_PROVIDER` | Mot de passe utilisé | Prérequis |
|---|---|---|
| `local` (par défaut) | Propre à HPO Visio, choisi à l’activation, réinitialisable par e-mail | aucun |
| `ldap` | Celui de HPO Mail, vérifié par LDAP | `LDAP_URL`, `LDAP_BASE_DN` (+ compte de service) |
| `imap` | Celui de HPO Mail, vérifié en se connectant à la messagerie | `IMAP_HOST` |

**Question à poser à l’administrateur de HPO Mail :** « Le serveur propose-t-il LDAP ou Active Directory ? Sinon, IMAP ? » La réponse donne la bonne combinaison :

- **LDAP disponible :** `DIRECTORY_PROVIDER=ldap` et `AUTH_PROVIDER=ldap`.
- **IMAP seulement :** `DIRECTORY_PROVIDER=db` (import CSV) et `AUTH_PROVIDER=imap`.
- **Aucun des deux :** `DIRECTORY_PROVIDER=db` et `AUTH_PROVIDER=local`.

---

## 5. Parcours

1. **L’administrateur invite.** Dans Admin › Utilisateurs › Inviter des utilisateurs, il choisit les adresses, le rôle (Utilisateur, Organisateur ou Administrateur) et la durée du lien (48 h, 72 h ou 7 jours). Avant l’envoi, l’API refuse :
   - les domaines non autorisés ;
   - les adresses absentes de l’annuaire ;
   - les personnes qui ont déjà un compte.
2. **E-mail.** La personne reçoit « Activez votre compte HPO Visio » sur sa boîte HPO Mail. Le lien est unique et à usage unique. Seule son empreinte SHA-256 est stockée en base.
3. **Activation.** La page affiche les informations de l’annuaire. La personne confirme avec son mot de passe HPO Mail, ou en choisit un en mode `local`. Le compte est créé et elle est connectée.
4. **Suivi.** L’administrateur peut **renvoyer** une invitation (l’ancien lien cesse de fonctionner) ou la **révoquer**. Le lien affiche un message clair s’il est expiré, déjà utilisé, remplacé ou révoqué.
5. **Réunions.** Les organisateurs créent des réunions, immédiates ou planifiées. Les personnes conviées reçoivent un e-mail et une notification dans Activité. Chaque réunion a un code `hpo-123-456`. Les salles permanentes sont gérées dans Admin › Réunions.
6. **Invités externes.** Ils rejoignent avec le lien `/rejoindre/<code>`, puis passent par la salle d’attente. L’organisateur reçoit une alerte sonore et les admet ou les refuse.
7. **Rappel 10 minutes avant.** Le planificateur de l’API tourne toutes les 15 secondes. Pour chaque réunion planifiée, l’organisateur et chaque collaborateur convié reçoivent :
   - une notification dans **Activité** (cloche avec pastille) ;
   - un e-mail « Rappel : … commence dans 10 minutes » sur leur boîte HPO Mail, avec le bouton Rejoindre.
8. **Appels (menu Contacts).** On clique « Appeler » sur un collègue.
   - L’appelé voit une fenêtre de sonnerie sur n’importe quelle page. Il peut répondre ou refuser.
   - Sans réponse au bout de 45 s, il reçoit un « appel manqué » dans Activité et par e-mail.
   - Raccrocher termine l’appel pour les deux.
9. **Dans la salle :**
   - micro, caméra, partage d’écran ;
   - liste des participants et discussion (enregistrée en base) ;
   - « Terminer pour tous » pour l’organisateur, « Retirer » pour les invités ;
   - bandeau rouge **Enregistrement** : les participants sont avertis avant d’entrer et pendant la réunion.
10. **Comptes rendus.** Après chaque réunion ou appel, une fiche est créée automatiquement. Elle reprend :
   - date, horaires et durée ;
   - présents (heure d’arrivée, de départ et temps de présence) et absents parmi les conviés ;
   - ordre du jour et discussion.

   L’organisateur ajoute le résumé, les décisions et les actions. **Exporter en Word** produit un .docx à l’en-tête HPO, prêt à déposer dans les Docs de HPO Mail. Chaque personne voit les comptes rendus des réunions auxquelles elle était conviée ou présente ; la DSID les voit tous.
11. **Enregistrements (Admin › Enregistrements).** Chaque réunion et chaque appel est enregistré automatiquement en MP4 : vidéo en mosaïque et son. Les administrateurs DSID peuvent :
   - filtrer par réunions ou appels ;
   - lire l’enregistrement dans le navigateur ;
   - le télécharger ;
   - le supprimer.

   Chaque téléchargement et chaque suppression est inscrit au journal. Les fichiers sont supprimés automatiquement après la durée de conservation choisie dans Sécurité (30 jours, 90 jours ou 1 an). L’enregistrement automatique peut être désactivé dans Sécurité.

---

## 6. Mise en production

1. **HTTPS.** Placez un certificat devant nginx, ou derrière le reverse proxy de la DSID. Ensuite :
   - `APP_URL=https://visio.hpo-groupe.com` ;
   - `COOKIE_SECURE=true`.
2. **Pare-feu :**
   - 443 (site) ;
   - **7881/TCP et 7882/UDP** (son et image vers LiveKit).
3. **`LIVEKIT_NODE_IP`** = adresse du serveur vue par les postes. Mettez l’IP publique si des invités viennent d’Internet.
4. **Invités sur Internet derrière des pare-feux stricts :** activez le TURN intégré de LiveKit (ajoutez une section `turn` dans `LIVEKIT_CONFIG` de `docker-compose.yml`). Il faut un nom de domaine et un certificat.
5. **Données de démonstration :** supprimez `database/init/03-demo.sql` **avant** le premier lancement, ou videz les tables `directory_entries` et `meetings`. Importez ensuite le vrai annuaire.
6. **Images LiveKit :** remplacez `livekit/livekit-server:latest` et `livekit/egress:latest` par des versions précises et testées.
7. **Sauvegardes :**
   - base : `docker compose exec db pg_dump -U hpo hpo_visio > sauvegarde.sql` (à planifier chaque nuit) ;
   - volume `recordings` (enregistrements MP4).
8. **Espace disque des enregistrements :** une heure de réunion en mosaïque représente environ 300 à 600 Mo. Placez le volume `recordings` sur un disque dimensionné en conséquence et ajustez la durée de conservation.
9. **Service Egress :**
   - Il a besoin de `cap_add: SYS_ADMIN`, car il utilise un navigateur intégré pour composer la vidéo.
   - Comptez environ 2 cœurs CPU par enregistrement simultané.
   - Les webhooks LiveKit → API sont déjà configurés dans `docker-compose.yml` (présences et fin d’enregistrement). Sans eux, les comptes rendus n’ont pas de présents et les enregistrements n’apparaissent pas.
10. **Consentement :** les participants sont avertis de l’enregistrement (page d’entrée, bandeau, sonnerie, e-mail de rappel). Faites valider le principe et la durée de conservation par la direction et le service juridique.
11. **LiveKit sur un autre domaine :** si `LIVEKIT_PUBLIC_URL` pointe vers un autre domaine, ajoutez son origine `https://…` à `connect-src` dans `frontend/nginx/security-headers.inc`.

---

## 7. Sécurité intégrée

- **Session :** cookie `HttpOnly`, `SameSite=Strict`, `Secure` en production, avec contrôle de l’origine des requêtes (anti-CSRF).
- **Comptes désactivés :** un compte désactivé est coupé immédiatement, car il est vérifié à chaque requête.
- **Double authentification :**
  - code à 6 chiffres par e-mail, valable 10 min, 5 essais ;
  - obligatoire pour les administrateurs, et pour tous depuis l’extérieur si la règle est activée.
- **Échecs de connexion :**
  - blocage après 8 échecs en 15 min sur une adresse ;
  - limitation de débit sur la connexion, l’activation et les demandes d’invités.
- **Jetons :** invitations, réinitialisations et accès invités sont aléatoires (256 bits) et stockés uniquement sous forme d’empreinte.
- **Mots de passe :** mode `local` uniquement, hachés en bcrypt (coût 12). Règle : 10 caractères minimum, avec lettres et chiffres.
- **Jeton invité :** limité à une seule réunion, valable 8 h.
- **Journal :** connexions, échecs, invitations, rôles, réglages, admissions d’invités. Export CSV.
- **En-têtes HTTP :** Content-Security-Policy stricte (aucun script en ligne), `X-Frame-Options`, `Permissions-Policy`.
- **Données :** police et images embarquées, aucun appel à des services externes.
- **Webhooks LiveKit :** signés avec la clé API ; un appel non signé est rejeté.
- **Enregistrements :** réservés aux administrateurs, servis sans possibilité de sortir du dossier des enregistrements. Un appel n’est visible que par ses deux participants et la DSID.

---

## 8. API (résumé)

| Méthode | Adresse | Rôle |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/verify`, `/api/auth/logout` | Connexion (+ code) |
| GET | `/api/auth/me`, `/api/auth/config` | Session, mode de mot de passe |
| POST | `/api/auth/forgot`, `/api/auth/reset` | Mot de passe oublié (mode local) |
| GET / POST | `/api/invitations/:jeton`, `…/accept` | Page d’activation |
| GET / POST | `/api/meetings`, `/api/meetings/:code` | Mes réunions, créer, détails |
| POST | `/api/meetings/:code/join`, `…/end` | Jeton LiveKit, terminer |
| GET / POST | `/api/meetings/:code/guests`, `…/guests/:id/admit\|deny\|remove` | Salle d’attente |
| GET / POST | `/api/meetings/:code/messages` | Discussion |
| GET / POST | `/api/public/meetings/:code`, `…/guests`, `/api/public/guests/:id` | Parcours invité |
| GET / POST | `/api/notifications`, `…/summary`, `…/read-all`, `…/:id/read` | Activité, appel entrant, présence |
| GET | `/api/contacts` | Collègues (présence en ligne) |
| POST | `/api/calls`, `/api/calls/:code/decline\|cancel` | Appeler, refuser, annuler |
| GET / PUT | `/api/reports`, `/api/reports/:id` | Comptes rendus, notes de l’organisateur |
| GET | `/api/reports/:id/docx` | Export Word |
| POST | `/api/livekit/webhook` | Événements LiveKit (signés) |
| GET / DELETE | `/api/admin/recordings`, `…/:id/file`, `…/:id` | Enregistrements (DSID) |
| * | `/api/admin/stats\|users\|invitations\|rooms\|settings\|logs\|directory/*` | Administration |

---

## 9. Tests

```bash
createdb hpo_visio_test && psql -d hpo_visio_test -f database/init/01-schema.sql -f database/init/02-demo.sql
cd backend && TEST_DATABASE_URL=postgres://…/hpo_visio_test npm test
```

Les 28 tests (fichiers `api.test.js` et `v2.test.js`) couvrent :

- la connexion avec code ;
- les invitations : contrôles, renvoi, révocation, activation, lien réutilisé ;
- les rôles et les garde-fous ;
- les réunions : jeton LiveKit, salle d’attente, discussion invité ;
- les règles de sécurité et la fin de réunion ;
- l’import CSV et la synchronisation ;
- le journal et l’export ;
- le mot de passe oublié ;
- le compte désactivé, le blocage après échecs et le refus des origines étrangères ;
- les contacts et la présence ;
- la convocation et le rappel 10 min (une seule fois, Activité + e-mail) ;
- les appels refusés, manqués et décrochés, et la confidentialité des appels ;
- les webhooks signés, les séances et les présences ;
- l’enregistrement : fin, lecture avec reprise, téléchargement, suppression, chemin piégé refusé, purge après la durée de conservation ;
- le compte rendu et ses droits, et l’export Word vérifié (contenu, logo).

⚠ La base de test est vidée à chaque lancement.

---

## 10. Limites connues et suites possibles

- **Enregistrements :** ils sont en mosaïque (`RECORDING_LAYOUT=speaker` pour mettre l’orateur en grand). Il n’y a pas encore de transcription automatique de la parole.
- **Comptes rendus :** le résumé, les décisions et les actions sont rédigés par l’organisateur. Une génération automatique demanderait la transcription.
- **Double authentification :** le code part par e-mail. L’envoi par SMS demande un fournisseur SMS.
- **Présence « en cours » :** elle est lue en direct dans LiveKit. Des webhooks LiveKit permettraient de tenir un historique précis des présences.
- **Messagerie hors réunion et calendrier :** pas encore développés.
