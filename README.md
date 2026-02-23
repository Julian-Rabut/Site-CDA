#  Projet RDV — Express / MySQL / EJS

Application web de gestion de rendez-vous développée avec **Node.js**, **Express**, **MySQL** et **EJS**.

---

##  Technologies utilisées

- Node.js
- Express.js
- MySQL 8+
- EJS (templates dynamiques)
- express-session (sessions)
- bcrypt (hashage des mots de passe)
- helmet (headers de sécurité)

---

##  Prérequis

- Node.js 
- MySQL 8+

Vérification :

```bash
node -v
npm -v
 Installation
1) Cloner le projet
git clone <URL_DU_REPO>
cd site_local_updated
2) Installer les dépendances
npm install
 Base de données

Créer une base de données (ex: agenda_rdv)

Importer les tables avec le script SQL :

CREATE DATABASE agenda_rdv;
USE agenda_rdv;
SOURCE sql/init.sql;
 Configuration (.env)

Copier .env si dessous et créer un .env

Compléter les valeurs (DB + SESSION_SECRET + SMTP si besoin)

Exemple :

PORT=8080

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=agenda_rdv

SESSION_SECRET=change_me

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password


 Lancer l’application
npm start
 Accès

Application : http://localhost:8080

 Scripts

Démarrer : npm start


 Sécurité 

Mots de passe hashés avec bcrypt
Sessions (cookie httpOnly, sameSite)
Helmet activé
Variables sensibles via .env

 Auteur

Projet réalisé par Julian Rabut dans le cadre du module Serveur Web / Express.