# Projet RDV — Plateforme de gestion de rendez-vous

Application web de gestion de rendez-vous développée avec **Node.js**, **Express.js**, **MySQL** et **EJS**.

Le projet permet à une praticienne de gérer ses créneaux, rendez-vous et clients à travers un espace sécurisé, tout en proposant aux clients une réservation en ligne.

---

# Fonctionnalités principales

## Partie client

- Création de compte client
- Connexion sécurisée
- Consultation des types de séance
- Consultation des créneaux disponibles
- Réservation de rendez-vous
- Espace client personnel
- Annulation de rendez-vous
- Réinitialisation du mot de passe
- Emails de confirmation

## Partie praticienne

- Connexion à l’espace professionnel
- Dashboard de gestion
- Calendrier interactif FullCalendar
- Création de créneaux
- Déplacement de rendez-vous
- Blocage de journées
- Duplication de journées
- Gestion des types de séance
- Gestion des clients
- Modification du profil public

---

# Technologies utilisées

## Backend

- Node.js
- Express.js
- MySQL 8+
- express-session
- bcrypt
- helmet
- express-rate-limit
- express-validator

## Frontend

- EJS
- CSS
- JavaScript
- FullCalendar

## Services

- Resend (emails)
- Railway (hébergement)
- OVH (DNS / sous-domaines)

## Tests

- Jest
- Supertest

---

# Architecture du projet

```txt
Site_cda/
│
├── config/
├── docs/
├── jobs/
├── middlewares/
├── routes/
├── services/
├── sql/
├── tests/
├── utils/
├── views/
│
├── app.js
├── server.js
├── package.json
└── README.md
Sécurité mise en place
Mots de passe hashés avec bcrypt
Sessions sécurisées (httpOnly / sameSite)
Helmet activé
Protection anti brute-force avec express-rate-limit
Requêtes SQL paramétrées
Validation des formulaires avec express-validator
Variables sensibles stockées dans .env
Prérequis
Node.js
MySQL 8+

Vérification :

node -v
npm -v
Installation
1. Cloner le projet
git clone <URL_DU_REPO>
cd Site_cda
2. Installer les dépendances
npm install
Base de données

Créer une base :

CREATE DATABASE agenda_rdv;

Importer ensuite le script SQL du projet :

USE agenda_rdv;
SOURCE sql/init.sql;
Configuration .env

Créer un fichier .env à la racine du projet :

PORT=8080
NODE_ENV=development

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=agenda_rdv

SESSION_SECRET=change_me

RESEND_API_KEY=
MAIL_FROM=

DISABLE_MAIL=false
Lancement du projet
Développement
npm run dev
Production
npm start
Accès

Application locale :

http://localhost:8080
Scripts disponibles
Lancer le serveur
npm start
Lancer en développement
npm run dev
Lancer les tests
npm test
Couverture de tests
npm run test:coverage
Tests réalisés

Les tests automatisés vérifient notamment :

accès dashboard protégé ;
accès calendrier protégé ;
réservation sans connexion refusée ;
création créneau protégée ;
validation email ;
validation mot de passe ;
gestion des erreurs.
Déploiement

Le projet est déployé sur Railway avec :

application Node.js ;
base MySQL ;
HTTPS automatique ;
variables d’environnement ;
gestion DNS OVH.
Documentation technique

Le dossier docs/ contient :

diagrammes d’architecture ;
diagrammes UML ;
MCD ;
plan de tests ;
documentation API ;
documentation sécurité.


Projet réalisé par Julian Rabut dans le cadre du titre RNCP CDA — Concepteur Développeur d’Applications.