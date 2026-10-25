# SILO GESTION ÉGLISE

Application de gestion administrative du Centre Évangélique Silo — Campus de la Cité Verte. Interface Next.js/React, PostgreSQL et Supabase, prête à être reliée à Vercel.

## Fonctionnalités

- Inscription des ouvriers par liens individuels ou généraux, avec validation administrative avant création de la fiche officielle.
- Fiches uniques, affectations multiples, gestion des départements, comptes et permissions.
- Présences, activités, rapports CSV imprimables et module financier à permissions restreintes.
- Photos conservées dans un bucket Supabase privé. Contrôles d’accès serveur; les clés privilégiées ne sont pas exposées au navigateur.
- Un seul compte `super_admin` peut exister. Il est créé une fois depuis `/initial-admin`; les comptes suivants sont secrétariat ou responsables de département.

## Déploiement

### 1. Préparer Supabase

Le projet Supabase associé est `llwzdaqsdfcltqkncjhl`. Appliquer les migrations dans l’ordre avec Supabase CLI depuis ce dépôt :

```bash
npx supabase login
npx supabase link --project-ref llwzdaqsdfcltqkncjhl
npx supabase db push
```

La commande `link` demande le mot de passe PostgreSQL dans le terminal. Ne l’écrivez pas dans un fichier suivi par Git, une commande copiée dans un journal, ou une variable `NEXT_PUBLIC_*`. Les migrations créent les treize départements, les tables, les contraintes, les fonctions transactionnelles, les politiques RLS et le bucket privé des photos.

### 2. Relier GitHub à Vercel

Dans Vercel, importer le dépôt `henobuild32-ship-it/Silo-Gestion-` et conserver le framework Next.js détecté. Ajouter les variables suivantes pour les environnements souhaités :

| Variable | Valeur |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://llwzdaqsdfcltqkncjhl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clé `publishable` du projet Supabase (ou variable héritée `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SECRET_KEY` | Clé `secret` Supabase côté serveur (ou variable héritée `SUPABASE_SERVICE_ROLE_KEY`) |
| `INITIAL_ADMIN_SETUP_KEY` | Secret aléatoire d’au moins 32 caractères, à conserver pour l’installation initiale |
| `NEXT_PUBLIC_APP_URL` | URL de production de l’application Vercel, sans `/` final |

Redéployer après avoir enregistré les variables. Il n’est pas nécessaire de configurer `DATABASE_URL` pour l’application : les requêtes utilisent l’API Supabase. La clé serveur ne doit jamais recevoir le préfixe `NEXT_PUBLIC_`.

### 3. Créer l’administrateur principal

Ouvrir `https://<votre-domaine-vercel>/initial-admin`, saisir le secret `INITIAL_ADMIN_SETUP_KEY`, puis créer le compte principal. L’opération est atomique face aux créations simultanées : l’index unique PostgreSQL interdit un second administrateur principal. Conserver le secret initial en lieu sûr; une fois le compte créé, la page ne peut pas créer un autre `super_admin`.

Depuis **Administration des comptes**, l’administrateur principal pourra créer des comptes de secrétariat et de responsables, et leur attribuer des autorisations et des départements.

## Développement local

1. Copier `.env.example` vers `.env.local` et remplir les clés récupérées dans Supabase.
2. Installer les dépendances avec `npm install`.
3. Lancer `npm run dev` puis ouvrir `http://localhost:3000`.

`SUPABASE_SERVICE_ROLE_KEY`, `INITIAL_ADMIN_SETUP_KEY` et les secrets de base de données ne doivent jamais être commités. Le fichier `.env.example` ne contient que des emplacements de configuration non secrets.

## Sauvegarde et rétablissement

Activer les sauvegardes PostgreSQL dans le plan Supabase utilisé et conserver les migrations de ce dépôt avec le code. Pour un rétablissement, restaurer la sauvegarde depuis Supabase, puis appliquer les migrations qui n’y figurent pas encore. Les fichiers photo résident dans le bucket privé `church-profiles` et doivent être inclus dans une procédure de sauvegarde du stockage séparée.

## Vérification locale

```bash
npm run build
```
