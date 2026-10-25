# SILO VERT OUVRIERS

Application de gestion administrative du Centre Évangélique Silo — Campus de la Cité Verte, sous le nom Silo Vert Ouvriers.

## Fonctionnalités

- Inscription des ouvriers par liens courts `/i/<jeton>` individuels ou généraux, avec validation administrative avant création de la fiche officielle.
- Fiches uniques, affectations multiples, gestion des départements, comptes et permissions.
- Présences et rapports administratifs avec accès limité selon les autorisations.
- Photos conservées dans un bucket Supabase privé. Contrôles d’accès serveur; les clés privilégiées ne sont pas exposées au navigateur.
- Application installable (PWA), interface adaptée en priorité au téléphone, page Présences disponible hors ligne après une première ouverture et synchronisation différée des pointages.
- Notifications Web Push pour les nouvelles inscriptions; l’utilisateur les active depuis son compte sur chaque appareil.
- Un seul compte `super_admin` peut exister. Il est créé une fois depuis `/initial-admin`. La création de comptes secondaires est actuellement suspendue.

## Déploiement

### 1. Préparer Supabase

Le projet Supabase associé est `llwzdaqsdfcltqkncjhl`. Appliquer les migrations dans l’ordre avec Supabase CLI depuis ce dépôt :

```bash
npx supabase login
npx supabase link --project-ref llwzdaqsdfcltqkncjhl
npx supabase db push
```

La commande `link` demande le mot de passe de la base dans le terminal. Ne l’écrivez pas dans un fichier suivi par Git, une commande copiée dans un journal, ou une variable publique. Les migrations créent les treize départements, les données et les permissions de l’application. Pour mettre à jour une base déjà installée — notamment avec les demandes de correction, le pointage, les codes e-mail de réunion et le périmètre GPS — exécutez une fois [`supabase/sql-editor-update.sql`](supabase/sql-editor-update.sql) dans l’éditeur SQL. Le fichier `sql-editor-setup.sql` est réservé à une installation neuve.

Pour tout appliquer depuis le tableau de bord Supabase, ouvrez **SQL Editor**, collez le contenu de [`supabase/sql-editor-setup.sql`](supabase/sql-editor-setup.sql), puis exécutez-le une seule fois dans un projet vierge. Le script regroupe les migrations et s’arrête si `public.profiles` existe déjà. L’exécution manuelle ne met pas à jour l’historique local du CLI; pour la suite, utilisez le même SQL Editor ou réparez l’historique des migrations avant de reprendre `supabase db push`.

### 2. Relier GitHub à Vercel

Dans Vercel, importer le dépôt `henobuild32-ship-it/Silo-Gestion-`, renommer le projet `silo-vert-ouvriers` et conserver le framework détecté. L’URL de production souhaitée est `https://silo-vert-ouvriers.vercel.app`. Ajouter les variables suivantes pour les environnements souhaités :

| Variable | Valeur |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://llwzdaqsdfcltqkncjhl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clé `publishable` du projet Supabase (ou variable héritée `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SECRET_KEY` | Clé `secret` Supabase côté serveur (ou variable héritée `SUPABASE_SERVICE_ROLE_KEY`) |
| `INITIAL_ADMIN_SETUP_KEY` | Secret aléatoire d’au moins 32 caractères, à conserver pour l’installation initiale |
| `NEXT_PUBLIC_APP_URL` | URL de production de l’application Vercel, sans `/` final |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Clé publique Web Push créée localement |
| `VAPID_PRIVATE_KEY` | Clé privée Web Push (serveur uniquement, jamais `NEXT_PUBLIC_`) |
| `VAPID_SUBJECT` | Adresse `mailto:` de contact ou URL HTTPS de l’application |
| `SMTP_USER` | Adresse Gmail utilisée pour envoyer les codes de confirmation des réunions |
| `SMTP_APP_PASSWORD` | Mot de passe d’application Gmail, pas le mot de passe habituel du compte |
| `ATTENDANCE_OTP_SECRET` | Secret aléatoire serveur d’au moins 32 caractères pour protéger les codes OTP |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | Facultatifs ; par défaut Gmail SMTP sur le port 465 et l’adresse `SMTP_USER` |

Redéployer après avoir enregistré les variables. Les clés VAPID sont générées automatiquement dans le `.env` local; recopier leurs valeurs dans les variables Vercel. Il n’est pas nécessaire de configurer `DATABASE_URL` pour l’application : les requêtes utilisent l’API Supabase. La clé serveur ne doit jamais recevoir le préfixe `NEXT_PUBLIC_`.

Pour activer les confirmations de réunion, créer un mot de passe d’application depuis les paramètres du compte Gmail (la validation en deux étapes doit être active), puis définir `SMTP_USER`, `SMTP_APP_PASSWORD` et un `ATTENDANCE_OTP_SECRET` unique d’au moins 32 caractères dans Vercel. Ne pas envoyer ces secrets dans le dépôt ni dans une conversation. La confirmation exige le code envoyé à l’adresse déjà enregistrée et, pour confirmer une présence, une position GPS précise dans le rayon défini par l’administration. Un ouvrier qui refuse cette vérification et valide son identité par code est marqué absent; sans accès au code, l’administration doit inscrire l’absence manuellement.

La page des présences conserve localement, pendant 30 jours maximum, la dernière liste autorisée et les pointages en attente dans IndexedDB. Ils sont envoyés quand la connexion revient et effacés à la déconnexion. Les appels API ne sont jamais mis en cache. Les notifications Web Push nécessitent une autorisation explicite sur chaque appareil et une connexion HTTPS. Elles fonctionnent dans Safari 16+ sur macOS Ventura 13+; sur iPhone/iPad, il faut iOS/iPadOS 16.4+ et ajouter l’application à l’écran d’accueil avant d’activer les notifications.

### 3. Créer l’administrateur principal

Ouvrir `https://<votre-domaine-vercel>/initial-admin`, saisir le secret `INITIAL_ADMIN_SETUP_KEY`, puis créer le compte principal. L’opération est atomique face aux créations simultanées : l’index unique PostgreSQL interdit un second administrateur principal. Conserver le secret initial en lieu sûr; une fois le compte créé, la page ne peut pas créer un autre `super_admin`.

Après l’initialisation, la création de comptes Secrétariat et Responsables est suspendue. Les comptes existants peuvent être consultés et leurs autorisations ajustées.

## Développement local

1. Copier `.env.example` vers `.env` et remplir les clés récupérées dans Supabase.
2. Installer les dépendances avec `npm install`.
3. Lancer `npm run dev` puis ouvrir `http://localhost:3000`.

`SUPABASE_SERVICE_ROLE_KEY`, `INITIAL_ADMIN_SETUP_KEY` et les secrets de base de données ne doivent jamais être commités. Le fichier `.env.example` ne contient que des emplacements de configuration non secrets.

## Sauvegarde et rétablissement

Activer les sauvegardes PostgreSQL dans le plan Supabase utilisé et conserver les migrations de ce dépôt avec le code. Pour un rétablissement, restaurer la sauvegarde depuis Supabase, puis appliquer les migrations qui n’y figurent pas encore. Les fichiers photo résident dans le bucket privé `church-profiles` et doivent être inclus dans une procédure de sauvegarde du stockage séparée.

## Vérification locale

```bash
npm run build
```
